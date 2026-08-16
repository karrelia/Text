/** Персональні налаштування користувача у Workers KV. */

import {
  type Env,
  type SttProvider,
  defaultProvider,
  defaultSttModel,
  isSttProvider,
} from "./env";
import { DEFAULT_STYLE, STYLES } from "./prompts";

export interface UserSettings {
  llmModel: string;
  visionModel: string;
  sttProvider: SttProvider;
  sttModel: string;
  style: string;
  glossary: string;
  extraPrompt: string;
  /** Розпізнавати прохання нагадати без команди /remind. */
  autoRemind: boolean;
}

/** Те, що реально лежить у KV: лише явно змінені користувачем поля. */
type StoredSettings = Partial<UserSettings>;

export function defaultsFor(env: Env): UserSettings {
  const provider = defaultProvider(env);
  return {
    llmModel: env.LLM_MODEL || "google/gemini-2.5-flash",
    visionModel: env.VISION_MODEL || "google/gemini-2.5-flash",
    sttProvider: provider,
    sttModel: defaultSttModel(env, provider),
    style: DEFAULT_STYLE,
    glossary: "",
    extraPrompt: "",
    autoRemind: true,
  };
}

function sanitize(stored: StoredSettings, defaults: UserSettings): UserSettings {
  const provider =
    stored.sttProvider && isSttProvider(stored.sttProvider)
      ? stored.sttProvider
      : defaults.sttProvider;
  const style = stored.style && stored.style in STYLES ? stored.style : defaults.style;

  return {
    llmModel: stored.llmModel || defaults.llmModel,
    visionModel: stored.visionModel || defaults.visionModel,
    sttProvider: provider,
    sttModel: stored.sttModel || defaults.sttModel,
    style,
    glossary: stored.glossary ?? defaults.glossary,
    extraPrompt: stored.extraPrompt ?? defaults.extraPrompt,
    // ?? а не ||: false — це осмислений вибір, а не «порожньо».
    autoRemind: stored.autoRemind ?? defaults.autoRemind,
  };
}

const key = (userId: number) => `user:${userId}`;

export async function loadSettings(env: Env, userId: number): Promise<UserSettings> {
  const stored = await env.SETTINGS.get<StoredSettings>(key(userId), "json");
  return sanitize(stored ?? {}, defaultsFor(env));
}

/**
 * Записує лише передані поля. Те, чого користувач не чіпав, лишається
 * незаданим і надалі береться з wrangler.toml — так нову типову модель
 * достатньо змінити в конфізі.
 */
export async function updateSettings(
  env: Env,
  userId: number,
  patch: StoredSettings,
): Promise<void> {
  const stored = (await env.SETTINGS.get<StoredSettings>(key(userId), "json")) ?? {};
  await env.SETTINGS.put(key(userId), JSON.stringify({ ...stored, ...patch }));
}

export async function resetSettings(env: Env, userId: number): Promise<void> {
  await env.SETTINGS.delete(key(userId));
}

/**
 * Остання розшифровка користувача. Потрібна, щоб `/remind` без тексту
 * підхоплював щойно надиктоване — відповідати на повідомлення в Telegram
 * незручно, а це найчастіший сценарій.
 */
const LAST_TTL_SECONDS = 86_400;

export async function saveLastTranscript(
  env: Env,
  userId: number,
  text: string,
): Promise<void> {
  if (!text.trim()) return;
  await env.SETTINGS.put(`last:${userId}`, text.trim(), {
    expirationTtl: LAST_TTL_SECONDS,
  });
}

export async function loadLastTranscript(env: Env, userId: number): Promise<string> {
  return (await env.SETTINGS.get(`last:${userId}`)) ?? "";
}

/**
 * Останній прогін: що саме обробляли і чим. Потрібен, щоб перепрогнати той
 * самий запис іншою моделлю чи стилем — file_id у Telegram лишається
 * дійсним, тож аудіо й знімок можна завантажити повторно.
 */
export interface LastJob {
  kind: "voice" | "photo" | "text";
  /** Для «text» порожній: джерело лежить у `transcript`, файлу немає. */
  fileId: string;
  /** Решта сторінок альбому. Порожньо — знімок один. */
  fileIds?: string[];
  fileName?: string;
  mimeType?: string;
  caption?: string;
  /** Сирий результат розпізнавання — дозволяє не платити за STT удруге. */
  transcript?: string;
  /**
   * Вказівка на цей запис: «зроби списком», «пиши англійською». Живе разом
   * із записом і не чіпає налаштувань — наступне голосове почнеться з чистого
   * аркуша.
   */
  note?: string;
}

export async function saveLastJob(
  env: Env,
  userId: number,
  job: LastJob,
): Promise<void> {
  await env.SETTINGS.put(`job:${userId}`, JSON.stringify(job), {
    expirationTtl: LAST_TTL_SECONDS,
  });
}

export async function loadLastJob(env: Env, userId: number): Promise<LastJob | null> {
  const job = await env.SETTINGS.get<LastJob>(`job:${userId}`, "json");
  if (!job) return null;

  // Текстовому прогону нема чого перезавантажувати — джерело зберігається
  // разом із ним. Аудіо й знімок без file_id перепрогнати неможливо.
  if (job.kind === "text") return job.transcript?.trim() ? job : null;
  if ((job.kind !== "voice" && job.kind !== "photo") || !job.fileId) return null;
  return job;
}

/**
 * Очікування власної вказівки: людина натиснула «Своя вказівка», і наступне
 * її повідомлення — це вказівка, а не нова нотатка чи прохання нагадати.
 *
 * Живе п'ять хвилин: забуте очікування з'їло б випадкове повідомлення, а
 * набрати одну фразу довше п'яти хвилин ніхто не буде.
 */
const ASK_TTL_SECONDS = 300;
const askKey = (userId: number) => `ask:${userId}`;

export async function askForNote(env: Env, userId: number): Promise<void> {
  await env.SETTINGS.put(askKey(userId), "1", { expirationTtl: ASK_TTL_SECONDS });
}

/** Повертає true один раз — далі очікування знято. */
export async function takeNoteRequest(env: Env, userId: number): Promise<boolean> {
  if (!(await env.SETTINGS.get(askKey(userId)))) return false;
  await env.SETTINGS.delete(askKey(userId));
  return true;
}

export async function clearNoteRequest(env: Env, userId: number): Promise<void> {
  await env.SETTINGS.delete(askKey(userId));
}

/** Останній зчитаний із фото документ — джерело для вивантаження в таблицю. */
export async function saveLastDocument(
  env: Env,
  userId: number,
  text: string,
): Promise<void> {
  if (!text.trim()) return;
  await env.SETTINGS.put(`doc:${userId}`, text.trim(), {
    expirationTtl: LAST_TTL_SECONDS,
  });
}

export async function loadLastDocument(env: Env, userId: number): Promise<string> {
  return (await env.SETTINGS.get(`doc:${userId}`)) ?? "";
}

/**
 * Витрати за добу. Загальна сума є в OpenRouter, але «скільки з'їв оцей
 * запис» і «скільки набігло сьогодні» видно лише звідси — а саме ці два
 * числа й показують, чи варта обрана модель своїх грошей.
 *
 * Ключ — локальна дата користувача, щоб «сьогодні» збігалося з тим, що
 * людина вважає сьогоднішнім днем. Живе сорок днів.
 */
const SPEND_TTL_SECONDS = 3_456_000;
const spendKey = (userId: number, day: string) => `spend:${userId}:${day}`;

export async function addSpending(
  env: Env,
  userId: number,
  day: string,
  amount: number,
): Promise<number> {
  if (!(amount > 0)) return await spentToday(env, userId, day);
  const total = (await spentToday(env, userId, day)) + amount;
  await env.SETTINGS.put(spendKey(userId, day), total.toFixed(6), {
    expirationTtl: SPEND_TTL_SECONDS,
  });
  return total;
}

export async function spentToday(
  env: Env,
  userId: number,
  day: string,
): Promise<number> {
  const raw = await env.SETTINGS.get(spendKey(userId, day));
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Яке меню команд уже опубліковане в Telegram.
 *
 * Bot API зберігає перелік у себе, тож нові команди з'являються в списку
 * лише після setMyCommands — сам по собі deploy його не оновлює. Тримаємо
 * зліпок опублікованого, щоб смикати Telegram рівно тоді, коли перелік
 * справді змінився, а не на кожне повідомлення.
 */
const MENU_KEY = "meta:commands";

export async function menuPublished(env: Env, fingerprint: string): Promise<boolean> {
  return (await env.SETTINGS.get(MENU_KEY)) === fingerprint;
}

export async function rememberMenu(env: Env, fingerprint: string): Promise<void> {
  await env.SETTINGS.put(MENU_KEY, fingerprint);
}

/**
 * Захист від повторної обробки: Telegram перешле оновлення знову, якщо ми
 * не встигли відповісти вчасно. Повертає true, якщо це дублікат.
 */
export async function seenUpdate(env: Env, updateId: number): Promise<boolean> {
  const marker = `update:${updateId}`;
  if (await env.SETTINGS.get(marker)) return true;
  await env.SETTINGS.put(marker, "1", { expirationTtl: 600 });
  return false;
}
