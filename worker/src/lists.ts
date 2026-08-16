/**
 * Списки без часу: покупки, справи, «не забути взяти».
 *
 * Нагадування вимагають «коли». Половина побутових справ його не має —
 * «купити лампочку», «подзвонити в банк», — і досі такі прохання або
 * мовчки зникали, або впирались у «не бачу часу».
 *
 * Пункти зберігаються окремими ключами, а не спільним списком: два
 * голосові підряд обробляються різними запитами одночасно, і читання з
 * дописуванням затирало б одне одного. Той самий висновок, що й з
 * альбомами знімків.
 */

import type { Env } from "./env";
import { OpenRouterError, complete, stripWrapper } from "./openrouter";
import { buildListPrompt } from "./prompts";
import type { UserSettings } from "./settings";

export class ListError extends Error {}

export const MAX_ITEMS = 100;

/** Скільки списків може завести одна людина. */
export const MAX_LISTS = 10;

const LIST_TTL_SECONDS = 180 * 86_400;

export interface ListItem {
  key: string;
  text: string;
  at: number;
}

const prefixFor = (userId: number, list: string) => `list:${userId}:${list}:`;
const allPrefix = (userId: number) => `list:${userId}:`;

/**
 * Назва списку → ідентифікатор. Відмінки зводимо до називного вручну:
 * «в покупки», «у покупках», «з покупок» — це той самий список, а
 * морфологічного аналізатора в Workers немає й не буде.
 */
const ALIASES: Record<string, string> = {
  покупки: "покупки",
  покупок: "покупки",
  покупках: "покупки",
  покупкам: "покупки",
  закупи: "покупки",
  закупів: "покупки",
  продукти: "покупки",
  продуктів: "покупки",
  магазин: "покупки",
  справи: "справи",
  справ: "справи",
  справах: "справи",
  справам: "справи",
  задачі: "справи",
  задач: "справи",
  завдання: "справи",
  todo: "справи",
  ідеї: "ідеї",
  ідей: "ідеї",
  ідеях: "ідеї",
};

export const DEFAULT_LIST = "справи";

export function listId(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return ALIASES[cleaned] ?? cleaned;
}

/** Назва для показу: у називному відмінку й з великої літери. */
export function listTitle(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const itemKey = (userId: number, list: string, at: number, salt: string) =>
  `${prefixFor(userId, list)}${String(at).padStart(14, "0")}:${salt}`;

export async function addItems(
  env: Env,
  userId: number,
  list: string,
  items: string[],
): Promise<string[]> {
  const existing = await loadList(env, userId, list);
  const known = new Set(existing.map((item) => item.text.toLowerCase()));
  const added: string[] = [];

  for (const raw of items) {
    const text = raw.trim();
    if (!text || known.has(text.toLowerCase())) continue;
    if (existing.length + added.length >= MAX_ITEMS) break;

    known.add(text.toLowerCase());
    // Час плюс порядковий номер: «молоко і хліб» лягають в одну
    // мілісекунду, і без зсуву порядок у списку визначала б випадкова
    // сіль — тобто щоразу інший.
    const at = Date.now() + added.length;
    added.push(text);
    const salt = Math.random().toString(36).slice(2, 8);
    await env.SETTINGS.put(itemKey(userId, list, at, salt), text, {
      expirationTtl: LIST_TTL_SECONDS,
    });
  }

  return added;
}

export async function loadList(
  env: Env,
  userId: number,
  list: string,
): Promise<ListItem[]> {
  const prefix = prefixFor(userId, list);
  const listed = await env.SETTINGS.list({ prefix, limit: MAX_ITEMS });
  const items: ListItem[] = [];

  for (const entry of listed.keys) {
    const text = await env.SETTINGS.get(entry.name);
    if (!text) continue;
    const at = Number(entry.name.slice(prefix.length).split(":")[0]) || 0;
    items.push({ key: entry.name, text, at });
  }

  return items;
}

/**
 * Викреслює пункти за назвою. Збіг за підрядком: людина каже «купив
 * молоко», а в списку записано «молоко 2 л».
 */
export async function removeItems(
  env: Env,
  userId: number,
  list: string,
  names: string[],
): Promise<string[]> {
  const items = await loadList(env, userId, list);
  const removed: string[] = [];

  for (const name of names) {
    const needle = name.trim().toLowerCase();
    if (!needle) continue;
    const hit = items.find(
      (item) =>
        !removed.includes(item.text) &&
        (item.text.toLowerCase().includes(needle) ||
          needle.includes(item.text.toLowerCase())),
    );
    if (!hit) continue;
    await env.SETTINGS.delete(hit.key);
    removed.push(hit.text);
  }

  return removed;
}

export async function clearList(env: Env, userId: number, list: string): Promise<number> {
  const items = await loadList(env, userId, list);
  for (const item of items) {
    await env.SETTINGS.delete(item.key);
  }
  return items.length;
}

/**
 * Чи йдеться про списки. Дешева перевірка без моделі: вона виконується на
 * кожному повідомленні.
 *
 * Обов'язково має прозвучати назва списку — «покупки», «справи», «ідеї».
 * Без неї «купив молоко» неможливо відрізнити від звичайної нотатки, а
 * викреслювати щось за здогадкою — найгірше, що можна зробити зі списком.
 * Для найчастішого випадку є кнопки під самим списком.
 */
const LIST_WORDS = new RegExp(`(^|[^\\p{L}])(${Object.keys(ALIASES).join("|")})([^\\p{L}]|$)`, "iu");

export function mentionsList(text: string): boolean {
  return LIST_WORDS.test(text.trim());
}

/** Хвіст ключа для кнопки: назва списку, час і сіль. */
export function itemTail(key: string): string {
  return key.replace(/^list:\d+:/, "");
}

export function keyFromItemTail(userId: number, tail: string): string {
  return `list:${userId}:${tail}`;
}

export async function removeByKey(env: Env, key: string): Promise<string> {
  const text = await env.SETTINGS.get(key);
  if (!text) return "";
  await env.SETTINGS.delete(key);
  return text;
}

export interface ListAction {
  action: "add" | "done" | "show" | "clear";
  list: string;
  items: string[];
}

export function parseListReply(raw: string): ListAction {
  const cleaned = stripWrapper(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ListError("Не зрозумів, що зробити зі списком.");
  }

  let payload: { action?: string; list?: string; items?: unknown; error?: string };
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ListError("Не зрозумів, що зробити зі списком.");
  }

  if (payload.error) throw new ListError(payload.error);
  const action = payload.action ?? "";
  if (!["add", "done", "show", "clear"].includes(action)) {
    throw new ListError("Не зрозумів, що зробити зі списком.");
  }

  const items = Array.isArray(payload.items)
    ? payload.items
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim())
    : [];

  if ((action === "add" || action === "done") && items.length === 0) {
    throw new ListError("Не розчув, що саме записати.");
  }

  return {
    action: action as ListAction["action"],
    list: listId(payload.list || DEFAULT_LIST) || DEFAULT_LIST,
    items,
  };
}

export async function planList(
  env: Env,
  user: UserSettings,
  text: string,
  known: string[],
): Promise<ListAction> {
  let raw: string;
  try {
    raw = await complete(
      env,
      user.llmModel,
      [
        { role: "system", content: buildListPrompt(known) },
        { role: "user", content: `<request>\n${text}\n</request>` },
      ],
      0,
    );
  } catch (error) {
    throw error instanceof OpenRouterError ? new ListError(error.message) : error;
  }

  return parseListReply(raw);
}

/** Які списки взагалі є. Без читання значень — самі імена ключів. */
export async function listNames(env: Env, userId: number): Promise<string[]> {
  const prefix = allPrefix(userId);
  const listed = await env.SETTINGS.list({ prefix, limit: MAX_ITEMS * MAX_LISTS });
  const names = new Set<string>();

  for (const entry of listed.keys) {
    const name = entry.name.slice(prefix.length).split(":")[0];
    if (name) names.add(name);
  }

  return [...names].sort();
}
