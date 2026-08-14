/** Нагадування: розбір фрази, зберігання в KV та вибірка тих, що настали. */

import type { Env } from "./env";
import { OpenRouterError, complete, stripWrapper } from "./openrouter";
import { buildReminderPrompt } from "./prompts";
import type { UserSettings } from "./settings";
import { DEFAULT_TIMEZONE, formatLocal, localNow, zonedToUtc } from "./timezone";

export class ReminderError extends Error {}

export interface Reminder {
  key: string;
  userId: number;
  chatId: number;
  text: string;
  dueAt: number;
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
const TRIGGER_WORDS = new Set([
  "нагадай",
  "нагадайте",
  "нагадати",
  "нагадування",
  "нагадуй",
  "нагадаєш",
  "нагадаєте",
  "напомни",
  "напомніть",
  "напоминание",
]);

// «не забудь» і «не забути» — різні корені на письмі, треба обидва.
const TRIGGER_PHRASES = [/не\s+забу[дт]/iu];

/**
 * Чи схоже сказане на прохання нагадати. Навмисно дешева перевірка без
 * звернення до моделі: вона виконується на кожному повідомленні, а зайвий
 * виклик LLM коштував би грошей і секунди затримки на кожній розшифровці.
 */
export function looksLikeReminder(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (TRIGGER_PHRASES.some((phrase) => phrase.test(trimmed))) return true;

  // \b не працює з кирилицею (він рахує лише латиницю), тому ріжемо на слова.
  for (const word of trimmed.toLowerCase().split(/[^\p{L}]+/u)) {
    if (TRIGGER_WORDS.has(word)) return true;
  }
  return false;
}

// ── Розбір фрази ─────────────────────────────────────────────────────────────

interface ParsedReminder {
  when: string;
  what: string;
}

export function parseReminderReply(raw: string): ParsedReminder {
  const cleaned = stripWrapper(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ReminderError("Не вдалося зрозуміти, коли нагадати.");
  }

  let payload: { when?: string; what?: string; error?: string };
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ReminderError("Не вдалося зрозуміти, коли нагадати.");
  }

  if (payload.error) throw new ReminderError(payload.error);
  if (!payload.when || !payload.what) {
    throw new ReminderError("Не вдалося зрозуміти, коли нагадати і про що.");
  }
  return { when: payload.when, what: payload.what };
}

export async function planReminder(
  env: Env,
  user: UserSettings,
  text: string,
  now: Date = new Date(),
): Promise<{ dueAt: number; what: string }> {
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
  return { dueAt: due.getTime(), what: parsed.what };
}

// ── Сховище ──────────────────────────────────────────────────────────────────

export async function saveReminder(
  env: Env,
  userId: number,
  chatId: number,
  text: string,
  dueAt: number,
): Promise<string> {
  const salt = Math.random().toString(36).slice(2, 8);
  const key = reminderKey(userId, dueAt, salt);
  await env.SETTINGS.put(key, JSON.stringify({ chatId, text }), {
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
    const value = await env.SETTINGS.get<{ chatId: number; text: string }>(
      entry.name,
      "json",
    );
    if (!value) continue;
    reminders.push({
      key: entry.name,
      userId,
      chatId: value.chatId,
      text: value.text,
      dueAt: meta.dueAt,
    });
  }

  return reminders.sort((a, b) => a.dueAt - b.dueAt);
}

export async function deleteReminder(env: Env, key: string): Promise<void> {
  await env.SETTINGS.delete(key);
}

/** Нагадування, час яких настав. Ключі відсортовані, тож беремо з початку. */
export async function dueReminders(env: Env, now: number): Promise<Reminder[]> {
  const listed = await env.SETTINGS.list({ prefix: "rem:", limit: 1000 });
  const due: Reminder[] = [];

  for (const entry of listed.keys) {
    const meta = parseKey(entry.name);
    if (!meta || meta.dueAt > now) continue;

    const value = await env.SETTINGS.get<{ chatId: number; text: string }>(
      entry.name,
      "json",
    );
    if (!value) continue;
    due.push({
      key: entry.name,
      userId: meta.userId,
      chatId: value.chatId,
      text: value.text,
      dueAt: meta.dueAt,
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
): Promise<{ key: string; dueAt: number; what: string }> {
  const existing = await listReminders(env, userId);
  if (existing.length >= MAX_PER_USER) {
    throw new ReminderError(
      `Уже назбиралось ${MAX_PER_USER} нагадувань. Прибери зайві через /reminders.`,
    );
  }

  const { dueAt, what } = await planReminder(env, user, text);
  const key = await saveReminder(env, userId, chatId, what, dueAt);
  return { key, dueAt, what };
}
