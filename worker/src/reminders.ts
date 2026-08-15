/** Нагадування: розбір фрази, зберігання в KV та вибірка тих, що настали. */

import type { Env } from "./env";
import { OpenRouterError, complete, stripWrapper } from "./openrouter";
import { buildReminderPrompt } from "./prompts";
import type { UserSettings } from "./settings";
import { type Repeat, parseRepeat } from "./recurrence";
import { DEFAULT_TIMEZONE, formatLocal, localNow, zonedToUtc } from "./timezone";

export class ReminderError extends Error {}

export interface Reminder {
  key: string;
  userId: number;
  chatId: number;
  text: string;
  dueAt: number;
  /** Порожньо — одноразове нагадування. */
  repeat?: Repeat;
}

interface StoredReminder {
  chatId: number;
  text: string;
  repeat?: unknown;
}

/** Скільки нагадувань може висіти на одного користувача. */
export const MAX_PER_USER = 50;

/**
 * Ключ: `rem:<userId>:<секунди, доповнені нулями>:<випадковий хвіст>`.
 *
 * KV віддає ключі в лексикографічному порядку, тож доповнення нулями дає
 * сортування за часом «безкоштовно»: і список користувача, і вибірка тих,
 * що настали, читаються одним проходом.
 */
export function reminderKey(userId: number, dueAt: number, salt: string): string {
  const seconds = Math.floor(dueAt / 1000);
  return `rem:${userId}:${String(seconds).padStart(12, "0")}:${salt}`;
}

export function parseKey(key: string): { userId: number; dueAt: number } | null {
  const match = /^rem:(\d+):(\d{12}):/.exec(key);
  if (!match) return null;
  return { userId: Number(match[1]), dueAt: Number(match[2]) * 1000 };
}

/** Хвіст ключа — те, що вміщається в callback_data кнопки «видалити». */
export function keyTail(key: string): string {
  return key.replace(/^rem:\d+:/, "");
}

export function keyFromTail(userId: number, tail: string): string {
  return `rem:${userId}:${tail}`;
}

// ── Розпізнавання наміру ─────────────────────────────────────────────────────

/**
 * Слова, після яких людина майже завжди просить нагадати. Свідомо без
 * минулого часу («нагадав», «напомнив») — то розповідь, а не прохання.
 */
const STRONG_WORDS = new Set([
  "нагадай",
  "нагадайте",
  "нагадуй",
  "нагадуйте",
  "нагадаєш",
  "нагадаєте",
  "напомни",
  "напомніть",
]);

const WEAK_WORDS = new Set(["нагадати", "нагадування", "напоминание"]);

/** Дієслова, після яких «нагадування» стає прямим проханням. */
const IMPERATIVES = new Set([
  "додай",
  "додайте",
  "постав",
  "поставте",
  "створи",
  "створіть",
  "зроби",
  "зробіть",
  "запиши",
  "запишіть",
]);

// «не забудь» і «не забути» — різні корені на письмі, треба обидва.
const STRONG_PHRASES = [/не\s+забу[дт]/iu];

/** Наскільки впевнено сказане є проханням нагадати. */
export type ReminderIntent = "strong" | "weak" | "none";

/**
 * Навмисно дешева перевірка без звернення до моделі: вона виконується на
 * кожному повідомленні, а зайвий виклик LLM коштував би грошей і секунди
 * затримки на кожній розшифровці.
 *
 * Сила наміру визначає, чи мовчати при невдачі. «Нагадай…» чи «додай
 * нагадування…» — пряме прохання, і про помилку треба сказати. Просто слово
 * «нагадування» посеред нотатки — привід спробувати, але не сварити людину,
 * якщо часу в тексті не виявилось.
 */
export function reminderIntent(text: string): ReminderIntent {
  const trimmed = text.trim();
  if (!trimmed) return "none";

  if (STRONG_PHRASES.some((phrase) => phrase.test(trimmed))) return "strong";

  // \b не працює з кирилицею (він рахує лише латиницю), тому ріжемо на слова.
  const words = trimmed.toLowerCase().split(/[^\p{L}]+/u);
  let weak = false;

  for (const [index, word] of words.entries()) {
    if (STRONG_WORDS.has(word)) return "strong";
    if (!WEAK_WORDS.has(word)) continue;
    // «Додай нагадування» — таке саме пряме прохання, як «нагадай».
    if (words.slice(Math.max(0, index - 2), index).some((prev) => IMPERATIVES.has(prev))) {
      return "strong";
    }
    weak = true;
  }

  return weak ? "weak" : "none";
}

export function looksLikeReminder(text: string): boolean {
  return reminderIntent(text) !== "none";
}

// ── Розбір фрази ─────────────────────────────────────────────────────────────

interface ParsedReminder {
  when: string;
  what: string;
  repeat?: Repeat;
}

export function parseReminderReply(raw: string): ParsedReminder {
  const cleaned = stripWrapper(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ReminderError("Не вдалося зрозуміти, коли нагадати.");
  }

  let payload: { when?: string; what?: string; repeat?: unknown; error?: string };
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ReminderError("Не вдалося зрозуміти, коли нагадати.");
  }

  if (payload.error) throw new ReminderError(payload.error);
  if (!payload.when || !payload.what) {
    throw new ReminderError("Не вдалося зрозуміти, коли нагадати і про що.");
  }
  return {
    when: payload.when,
    what: payload.what,
    // Невідоме значення трактуємо як «без повтору», а не як помилку.
    ...((): { repeat?: Repeat } => {
      const repeat = parseRepeat(payload.repeat);
      return repeat ? { repeat } : {};
    })(),
  };
}

export async function planReminder(
  env: Env,
  user: UserSettings,
  text: string,
  now: Date = new Date(),
): Promise<{ dueAt: number; what: string; repeat?: Repeat }> {
  const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;
  const { stamp, weekday } = localNow(now, timeZone);

  let raw: string;
  try {
    raw = await complete(
      env,
      user.llmModel,
      [
        { role: "system", content: buildReminderPrompt(stamp, weekday) },
        { role: "user", content: `<request>\n${text}\n</request>` },
      ],
      0,
    );
  } catch (error) {
    throw error instanceof OpenRouterError ? new ReminderError(error.message) : error;
  }

  const parsed = parseReminderReply(raw);
  const due = zonedToUtc(parsed.when, timeZone);
  if (!due) {
    throw new ReminderError(`Незрозуміла дата: ${parsed.when}`);
  }
  if (due.getTime() <= now.getTime()) {
    throw new ReminderError(
      `Цей час уже минув: ${formatLocal(due, timeZone)}. Уточни, коли саме нагадати.`,
    );
  }
  return {
    dueAt: due.getTime(),
    what: parsed.what,
    ...(parsed.repeat ? { repeat: parsed.repeat } : {}),
  };
}

// ── Сховище ──────────────────────────────────────────────────────────────────

export async function saveReminder(
  env: Env,
  userId: number,
  chatId: number,
  text: string,
  dueAt: number,
  repeat?: Repeat,
): Promise<string> {
  const salt = Math.random().toString(36).slice(2, 8);
  const key = reminderKey(userId, dueAt, salt);
  const value: StoredReminder = { chatId, text, ...(repeat ? { repeat } : {}) };
  await env.SETTINGS.put(key, JSON.stringify(value), {
    // Прибираємо себе через добу після спрацювання, щоб KV не заростав.
    expirationTtl: Math.max(60, Math.ceil((dueAt - Date.now()) / 1000) + 86_400),
  });
  return key;
}

export async function listReminders(env: Env, userId: number): Promise<Reminder[]> {
  const listed = await env.SETTINGS.list({ prefix: `rem:${userId}:`, limit: MAX_PER_USER });
  const reminders: Reminder[] = [];

  for (const entry of listed.keys) {
    const meta = parseKey(entry.name);
    if (!meta) continue;
    const value = await env.SETTINGS.get<StoredReminder>(entry.name, "json");
    if (!value) continue;
    reminders.push({
      key: entry.name,
      userId,
      chatId: value.chatId,
      text: value.text,
      dueAt: meta.dueAt,
      ...((): { repeat?: Repeat } => {
        const repeat = parseRepeat(value.repeat);
        return repeat ? { repeat } : {};
      })(),
    });
  }

  return reminders.sort((a, b) => a.dueAt - b.dueAt);
}

export async function loadReminder(env: Env, key: string): Promise<Reminder | null> {
  const meta = parseKey(key);
  if (!meta) return null;
  const value = await env.SETTINGS.get<StoredReminder>(key, "json");
  if (!value) return null;
  const repeat = parseRepeat(value.repeat);
  return {
    key,
    userId: meta.userId,
    chatId: value.chatId,
    text: value.text,
    dueAt: meta.dueAt,
    ...(repeat ? { repeat } : {}),
  };
}

export async function deleteReminder(env: Env, key: string): Promise<void> {
  await env.SETTINGS.delete(key);
}

/**
 * Щойно прибране нагадування — щоб випадковий дотик можна було відкотити.
 *
 * Живе п'ять хвилин: помилку помічають одразу, а тримати довше означало б
 * пропонувати «повернути» те, що людина свідомо прибрала чверть години тому.
 */
export interface DeletedReminder {
  chatId: number;
  text: string;
  dueAt: number;
  repeat?: Repeat;
}

const UNDO_TTL_SECONDS = 300;
const undoKey = (userId: number) => `undo:${userId}`;

export async function stashDeleted(env: Env, reminder: Reminder): Promise<void> {
  const value: DeletedReminder = {
    chatId: reminder.chatId,
    text: reminder.text,
    dueAt: reminder.dueAt,
    ...(reminder.repeat ? { repeat: reminder.repeat } : {}),
  };
  await env.SETTINGS.put(undoKey(reminder.userId), JSON.stringify(value), {
    expirationTtl: UNDO_TTL_SECONDS,
  });
}

/**
 * Те, що щойно спрацювало, — щоб кнопка «відкласти» знала, про що йшлося.
 *
 * У callback_data текст не влазить (64 байти), тож несемо там лише короткий
 * ідентифікатор, а сам текст лежить тут добу.
 */
const FIRED_TTL_SECONDS = 86_400;
const firedKey = (userId: number, id: string) => `fire:${userId}:${id}`;

/** Хвіст ключа нагадування — достатньо короткий для кнопки. */
export function firedId(key: string): string {
  return key.split(":").pop() ?? "";
}

export async function rememberFired(
  env: Env,
  userId: number,
  id: string,
  text: string,
): Promise<void> {
  await env.SETTINGS.put(firedKey(userId, id), text, {
    expirationTtl: FIRED_TTL_SECONDS,
  });
}

export async function loadFired(
  env: Env,
  userId: number,
  id: string,
): Promise<string> {
  return (await env.SETTINGS.get(firedKey(userId, id))) ?? "";
}

export async function takeDeleted(
  env: Env,
  userId: number,
): Promise<DeletedReminder | null> {
  const value = await env.SETTINGS.get<DeletedReminder>(undoKey(userId), "json");
  if (!value?.text || typeof value.dueAt !== "number") return null;
  await env.SETTINGS.delete(undoKey(userId));
  return value;
}

/** Нагадування, час яких настав. Ключі відсортовані, тож беремо з початку. */
export async function dueReminders(env: Env, now: number): Promise<Reminder[]> {
  const listed = await env.SETTINGS.list({ prefix: "rem:", limit: 1000 });
  const due: Reminder[] = [];

  for (const entry of listed.keys) {
    const meta = parseKey(entry.name);
    if (!meta || meta.dueAt > now) continue;

    const value = await env.SETTINGS.get<StoredReminder>(entry.name, "json");
    if (!value) continue;
    due.push({
      key: entry.name,
      userId: meta.userId,
      chatId: value.chatId,
      text: value.text,
      dueAt: meta.dueAt,
      ...((): { repeat?: Repeat } => {
        const repeat = parseRepeat(value.repeat);
        return repeat ? { repeat } : {};
      })(),
    });
  }

  return due;
}

/** Розібрати фразу й одразу зберегти. Кидає ReminderError, якщо не вийшло. */
export async function createReminder(
  env: Env,
  user: UserSettings,
  userId: number,
  chatId: number,
  text: string,
): Promise<{ key: string; dueAt: number; what: string; repeat?: Repeat }> {
  const existing = await listReminders(env, userId);
  if (existing.length >= MAX_PER_USER) {
    throw new ReminderError(
      `Уже назбиралось ${MAX_PER_USER} нагадувань. Прибери зайві через /reminders.`,
    );
  }

  const { dueAt, what, repeat } = await planReminder(env, user, text);
  const key = await saveReminder(env, userId, chatId, what, dueAt, repeat);
  return { key, dueAt, what, ...(repeat ? { repeat } : {}) };
}
