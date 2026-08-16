/**
 * Історія надиктованого й зчитаного, з пошуком.
 *
 * Головна складність — знайти запис, не читаючи всі. У KV немає ані
 * повнотекстового пошуку, ані запиту за вмістом: значення можна тільки
 * дістати по одному, а сотня читань на кожен пошук — це і повільно, і
 * марно витрачені операції.
 *
 * Тому слова кладемо в **ключ**. `list()` віддає імена ключів одним
 * викликом, і фільтрувати по них можна без жодного читання: значення
 * дістаємо лише для тих кількох записів, що збіглися.
 *
 * Ціна такого рішення — ключ обмежений 512 байтами, тож у покажчик
 * потрапляють не всі слова запису, а стільки, скільки вміститься (це
 * приблизно сотня різних слів). Для нотатки це весь текст, для години
 * наради — початок. Знайти по слову з середини довгого запису не вийде.
 */

import type { Env } from "./env";

/** Скільки днів тримаємо записи. */
const HISTORY_TTL_SECONDS = 90 * 86_400;

/** Стеля на ключ у KV — 512 байтів. Лишаємо запас на службову частину. */
const KEY_BUDGET = 460;

/** Скільки записів показуємо у відповідь. */
export const PAGE = 8;

export interface HistoryItem {
  key: string;
  at: number;
  kind: "voice" | "photo" | "text";
  text: string;
}

interface StoredItem {
  at: number;
  kind: "voice" | "photo" | "text";
  text: string;
}

const prefixFor = (userId: number) => `hist:${userId}:`;

/**
 * Слова для покажчика: нормалізовані, без повторів, коротші за чотири
 * літери відкинуті. Порядок збережений — початок запису інформативніший
 * за кінець, і саме він має вціліти при обрізанні.
 */
export function indexWords(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];

  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 4 || seen.has(raw)) continue;
    seen.add(raw);
    words.push(raw);
  }

  return words;
}

function digest(text: string, budget: number): string {
  const encoder = new TextEncoder();
  const kept: string[] = [];
  let used = 0;

  for (const word of indexWords(text)) {
    const cost = encoder.encode(word).length + (kept.length > 0 ? 1 : 0);
    if (used + cost > budget) break;
    used += cost;
    kept.push(word);
  }

  return kept.join("-");
}

/**
 * Ключ: `hist:<userId>:<секунди, доповнені нулями>:<покажчик слів>`.
 *
 * Час на початку дає сортування за датою задарма — той самий прийом, що
 * й у нагадуваннях: KV віддає ключі лексикографічно.
 */
export function historyKey(userId: number, at: number, text: string): string {
  const head = `${prefixFor(userId)}${String(Math.floor(at / 1000)).padStart(12, "0")}:`;
  return head + digest(text, KEY_BUDGET - new TextEncoder().encode(head).length);
}

/**
 * Кладе запис в історію. `sourceId` — file_id знімка чи голосового: доки
 * він відомий, повторний прогін тим самим записом переписує ту саму
 * позицію, а не плодить копії кожного разу, коли ви змінили модель.
 */
export async function remember(
  env: Env,
  userId: number,
  item: { kind: "voice" | "photo" | "text"; text: string; sourceId?: string },
  at: number = Date.now(),
): Promise<void> {
  const text = item.text.trim();
  if (!text) return;

  const pointer = item.sourceId ? `histof:${userId}:${item.sourceId}` : "";
  const previous = pointer ? await env.SETTINGS.get(pointer) : null;
  if (previous) await env.SETTINGS.delete(previous);

  const key = historyKey(userId, at, text);
  const value: StoredItem = { at, kind: item.kind, text };
  await env.SETTINGS.put(key, JSON.stringify(value), {
    expirationTtl: HISTORY_TTL_SECONDS,
  });

  if (pointer) {
    // Покажчик живе добу — рівно стільки, скільки можна перепрогнати запис.
    await env.SETTINGS.put(pointer, key, { expirationTtl: 86_400 });
  }
}

async function load(env: Env, keys: string[]): Promise<HistoryItem[]> {
  const items: HistoryItem[] = [];
  for (const key of keys) {
    const stored = await env.SETTINGS.get<StoredItem>(key, "json");
    if (stored?.text) {
      items.push({ key, at: stored.at, kind: stored.kind, text: stored.text });
    }
  }
  return items;
}

/** Останні записи, найновіші згори. */
export async function recent(env: Env, userId: number, limit = PAGE): Promise<HistoryItem[]> {
  const listed = await env.SETTINGS.list({ prefix: prefixFor(userId), limit: 1000 });
  const keys = listed.keys
    .map((entry) => entry.name)
    .reverse()
    .slice(0, limit);
  return load(env, keys);
}

/**
 * Пошук за словами. Збіг — коли кожне слово запиту трапляється в покажчику
 * як підрядок: так «Гаркушенц» знаходить і «гаркушенцях», і «гаркушенці»,
 * що для української з її відмінками важливіше за точний збіг.
 */
export async function search(
  env: Env,
  userId: number,
  query: string,
  limit = PAGE,
): Promise<HistoryItem[]> {
  const needles = indexWords(query);
  if (needles.length === 0) return [];

  const listed = await env.SETTINGS.list({ prefix: prefixFor(userId), limit: 1000 });
  const prefixLength = prefixFor(userId).length;

  const matched = listed.keys
    .map((entry) => entry.name)
    .filter((name) => {
      const words = name.slice(prefixLength).replace(/^\d+:/, "");
      return needles.every((needle) => words.includes(needle));
    })
    .reverse()
    .slice(0, limit);

  return load(env, matched);
}

export async function loadOne(env: Env, key: string): Promise<HistoryItem | null> {
  const stored = await env.SETTINGS.get<StoredItem>(key, "json");
  if (!stored?.text) return null;
  return { key, at: stored.at, kind: stored.kind, text: stored.text };
}

/**
 * Хвіст ключа для кнопки. Повний ключ у callback_data не влазить —
 * там 64 байти, а покажчик слів довгий, — тож несемо лише час, якого
 * досить, щоб знайти запис серед своїх.
 */
export function stampOf(key: string): string {
  return /:(\d{12}):/.exec(key)?.[1] ?? "";
}

export async function findByStamp(
  env: Env,
  userId: number,
  stamp: string,
): Promise<HistoryItem | null> {
  if (!/^\d{12}$/.test(stamp)) return null;
  const listed = await env.SETTINGS.list({
    prefix: `${prefixFor(userId)}${stamp}:`,
    limit: 1,
  });
  const key = listed.keys[0]?.name;
  return key ? loadOne(env, key) : null;
}
