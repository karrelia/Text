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
 * Захист від повторної обробки: Telegram перешле оновлення знову, якщо ми
 * не встигли відповісти вчасно. Повертає true, якщо це дублікат.
 */
export async function seenUpdate(env: Env, updateId: number): Promise<boolean> {
  const marker = `update:${updateId}`;
  if (await env.SETTINGS.get(marker)) return true;
  await env.SETTINGS.put(marker, "1", { expirationTtl: 600 });
  return false;
}
