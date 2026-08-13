/** Прив'язки та змінні оточення Worker'а. */

export interface Env {
  SETTINGS: KVNamespace;

  // Секрети (wrangler secret put)
  TELEGRAM_BOT_TOKEN: string;
  OPENROUTER_API_KEY: string;
  GROQ_API_KEY?: string;
  OPENAI_API_KEY?: string;
  WEBHOOK_SECRET?: string;

  // Змінні з wrangler.toml
  ALLOWED_USER_IDS?: string;
  STT_PROVIDER?: string;
  GROQ_WHISPER_MODEL?: string;
  OPENAI_WHISPER_MODEL?: string;
  LLM_MODEL?: string;
  VISION_MODEL?: string;
  TIMEZONE?: string;
  LLM_TEMPERATURE?: string;
  MAX_AUDIO_SECONDS?: string;
  OPENROUTER_APP_URL?: string;
  OPENROUTER_APP_TITLE?: string;
}

export type SttProvider = "groq" | "openai";

export const STT_PROVIDERS: readonly SttProvider[] = ["groq", "openai"] as const;

export const PROVIDER_TITLES: Record<SttProvider, string> = {
  groq: "Whisper (Groq)",
  openai: "Whisper (OpenAI)",
};

export function isSttProvider(value: string): value is SttProvider {
  return (STT_PROVIDERS as readonly string[]).includes(value);
}

export function allowedUserIds(env: Env): Set<number> {
  const raw = env.ALLOWED_USER_IDS ?? "";
  const ids = raw
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isFinite(id));
  return new Set(ids);
}

export function apiKeyFor(env: Env, provider: SttProvider): string {
  return (provider === "groq" ? env.GROQ_API_KEY : env.OPENAI_API_KEY) ?? "";
}

export function defaultSttModel(env: Env, provider: SttProvider): string {
  return provider === "groq"
    ? env.GROQ_WHISPER_MODEL || "whisper-large-v3"
    : env.OPENAI_WHISPER_MODEL || "whisper-1";
}

export function defaultProvider(env: Env): SttProvider {
  const value = (env.STT_PROVIDER ?? "groq").trim().toLowerCase();
  return isSttProvider(value) ? value : "groq";
}

export function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}
