/** Клієнт OpenRouter: редагування тексту та каталог моделей. */

import { type Env, numberVar } from "./env";
import {
  CSV_SYSTEM,
  buildSystemPrompt,
  buildUserMessage,
  styleForNote,
  temperatureFor,
} from "./prompts";
import type { UserSettings } from "./settings";

export class OpenRouterError extends Error {}

export interface ModelInfo {
  id: string;
  name: string;
  modalities: readonly string[];
}

const BASE_URL = "https://openrouter.ai/api/v1";
const RETRIABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

function headers(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "content-type": "application/json",
    "http-referer": env.OPENROUTER_APP_URL || "",
    "x-title": env.OPENROUTER_APP_TITLE || "Voice2Text UA Bot",
  };
}

interface Completion {
  choices?: { message?: { content?: string | { text?: string }[] }; finish_reason?: string }[];
  error?: { message?: string };
  usage?: { cost?: number };
}

/**
 * Вартість останнього виклику в доларах, або null, коли OpenRouter її не
 * повернув. Модуль без стану був би чистішим, але тягнути число крізь усі
 * шари заради підпису під повідомленням — задорога: `complete` викликається
 * з чотирьох місць, і кожному довелося б змінити сигнатуру.
 */
let lastCost: number | null = null;

export function takeLastCost(): number | null {
  const cost = lastCost;
  lastCost = null;
  return cost;
}

export async function complete(
  env: Env,
  model: string,
  messages: unknown[],
  temperature: number,
): Promise<string> {
  let lastError = "";
  lastCost = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: headers(env),
        // usage.include просить OpenRouter повернути вартість виклику разом
        // з відповіддю — інакше довелося б окремим запитом ходити по
        // залишок і рахувати різницю.
        body: JSON.stringify({
          model,
          messages,
          temperature,
          usage: { include: true },
        }),
      });
    } catch (error) {
      lastError = String(error);
      await backoff(attempt);
      continue;
    }

    if (RETRIABLE.has(response.status)) {
      lastError = `OpenRouter повернув ${response.status}`;
      await backoff(attempt);
      continue;
    }

    const data = (await response.json().catch(() => ({}))) as Completion;

    if (!response.ok || data.error) {
      throw new OpenRouterError(
        data.error?.message ?? `OpenRouter ${response.status}`,
      );
    }

    const choice = data.choices?.[0];
    if (!choice) throw new OpenRouterError(`Модель ${model} повернула порожню відповідь.`);

    const raw = choice.message?.content;
    const text = Array.isArray(raw)
      ? raw.map((part) => part.text ?? "").join("")
      : (raw ?? "");

    if (!text.trim()) {
      throw new OpenRouterError(
        `Модель ${model} не повернула тексту (finish_reason=${choice.finish_reason}).`,
      );
    }

    if (typeof data.usage?.cost === "number") lastCost = data.usage.cost;
    return text;
  }

  throw new OpenRouterError(`OpenRouter недоступний: ${lastError}`);
}

function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
}

// ── Редагування ──────────────────────────────────────────────────────────────

const FENCE = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/;
const PREAMBLE_WORDS = [
  "текст",
  "розшифров",
  "транскрип",
  "версі",
  "результат",
  "варіант",
  "ось",
  "here",
  "transcript",
];

/** Прибирає markdown-огорожу, зайві лапки та службову преамбулу моделі. */
export function stripWrapper(text: string): string {
  let cleaned = text.trim();

  const fence = FENCE.exec(cleaned);
  if (fence?.[1]) cleaned = fence[1].trim();

  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (cleaned.length > 1 && first && last && '"«“'.includes(first) && '"»”'.includes(last)) {
    const inner = cleaned.slice(1, -1);
    if (!inner.includes('"') && !inner.includes("«")) cleaned = inner.trim();
  }

  const breakAt = cleaned.indexOf("\n");
  if (breakAt > 0) {
    const head = cleaned.slice(0, breakAt).trim();
    if (head.endsWith(":") && head.length <= 80) {
      const lowered = head.toLowerCase();
      if (PREAMBLE_WORDS.some((word) => lowered.includes(word))) {
        cleaned = cleaned.slice(breakAt + 1).trim();
      }
    }
  }

  return cleaned;
}

/**
 * `note` — вказівка на один прогін («зроби списком», «пиши англійською»).
 * Вона не зберігається в налаштуваннях і живе рівно стільки, скільки сам
 * запис під рукою.
 */
export async function processTranscript(
  env: Env,
  transcript: string,
  user: UserSettings,
  note = "",
): Promise<string> {
  const trimmed = transcript.trim();
  if (!trimmed) return "";

  const style = styleForNote(user.style, note);
  if (style === "raw") return trimmed;

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(style, user.glossary, user.extraPrompt, note),
    },
    { role: "user", content: buildUserMessage(style, trimmed) },
  ];

  const result = await complete(
    env,
    user.llmModel,
    messages,
    temperatureFor(style, numberVar(env.LLM_TEMPERATURE, 0.2)),
  );
  return stripWrapper(result) || trimmed;
}

// ── Каталог моделей ──────────────────────────────────────────────────────────

let catalogCache: { models: ModelInfo[]; at: number } | null = null;
const CATALOG_TTL_MS = 3_600_000;

export async function listModels(env: Env): Promise<ModelInfo[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.models;
  }

  try {
    const response = await fetch(`${BASE_URL}/models`, { headers: headers(env) });
    if (!response.ok) return catalogCache?.models ?? [];

    const payload = (await response.json()) as {
      data?: { id?: string; name?: string; architecture?: { input_modalities?: string[] } }[];
    };
    const models = (payload.data ?? [])
      .filter((item): item is { id: string } => Boolean(item.id))
      .map((item) => ({
        id: item.id,
        name: (item as { name?: string }).name ?? item.id,
        modalities:
          (item as { architecture?: { input_modalities?: string[] } }).architecture
            ?.input_modalities ?? [],
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    catalogCache = { models, at: Date.now() };
    return models;
  } catch {
    return catalogCache?.models ?? [];
  }
}

export async function searchModels(
  env: Env,
  query: string,
  options: { imageOnly?: boolean; limit?: number } = {},
): Promise<ModelInfo[]> {
  const limit = options.limit ?? 12;
  let models = await listModels(env);
  if (options.imageOnly) {
    models = models.filter((model) => model.modalities.includes("image"));
  }
  const needle = query.trim().toLowerCase();
  if (!needle) return models.slice(0, limit);

  return models
    .filter(
      (model) =>
        model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const aStarts = a.id.toLowerCase().startsWith(needle) ? 0 : 1;
      const bStarts = b.id.toLowerCase().startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

/** true/false, або null якщо каталог недоступний і перевірити нічим. */
export async function modelExists(env: Env, modelId: string): Promise<boolean | null> {
  const models = await listModels(env);
  if (models.length === 0) return null;
  return models.some((model) => model.id === modelId);
}

// ── Витрати ──────────────────────────────────────────────────────────────────

export interface Credits {
  spent: number;
  granted: number;
}

/**
 * Скільки витрачено й скільки покладено. OpenRouter має два різні
 * ендпоінти залежно від віку акаунта, тож пробуємо новий і відкочуємось
 * на старий.
 */
export async function fetchCredits(env: Env): Promise<Credits> {
  const credits = await tryCredits(env);
  if (credits) return credits;

  const key = await tryAuthKey(env);
  if (key) return key;

  throw new OpenRouterError("OpenRouter не віддав дані про витрати.");
}

async function tryCredits(env: Env): Promise<Credits | null> {
  try {
    const response = await fetch(`${BASE_URL}/credits`, { headers: headers(env) });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const granted = payload.data?.total_credits;
    const spent = payload.data?.total_usage;
    if (typeof granted !== "number" || typeof spent !== "number") return null;
    return { spent, granted };
  } catch {
    return null;
  }
}

async function tryAuthKey(env: Env): Promise<Credits | null> {
  try {
    const response = await fetch(`${BASE_URL}/auth/key`, { headers: headers(env) });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: { usage?: number; limit?: number | null };
    };
    const spent = payload.data?.usage;
    if (typeof spent !== "number") return null;
    const limit = payload.data?.limit;
    return { spent, granted: typeof limit === "number" ? limit : 0 };
  } catch {
    return null;
  }
}

// ── Таблиця для Excel ────────────────────────────────────────────────────────

export async function toCsv(env: Env, text: string, model: string): Promise<string> {
  const result = await complete(
    env,
    model,
    [
      { role: "system", content: CSV_SYSTEM },
      { role: "user", content: `<document>\n${text}\n</document>` },
    ],
    0,
  );
  return stripWrapper(result).trim();
}
