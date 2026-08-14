/**
 * Інлайн-клавіатури.
 *
 * У Workers немає спільної пам'яті між запитами, тож callback_data несе
 * значення напряму. Ліміт Telegram — 64 байти, довші варіанти просто не
 * показуємо кнопкою (їх можна задати точним ідентифікатором у команді).
 */

import { type Env, PROVIDER_TITLES, STT_PROVIDERS, apiKeyFor } from "./env";
import { STYLES } from "./prompts";
import type { InlineKeyboard } from "./telegram";

export const CALLBACK_LIMIT = 64;

export const PREFIX = {
  model: "m:",
  vision: "v:",
  style: "s:",
  provider: "p:",
  reminderDelete: "rd:",
  csv: "csv:",
} as const;

export const PRESET_LLM_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "meta-llama/llama-3.3-70b-instruct",
  "qwen/qwen3-235b-a22b",
];

function fits(data: string): boolean {
  return new TextEncoder().encode(data).length <= CALLBACK_LIMIT;
}

export const PRESET_VISION_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5-mini",
];

export function modelsKeyboard(
  models: string[],
  current: string,
  prefix: string = PREFIX.model,
): InlineKeyboard {
  const rows = models
    .map((id) => ({ id, data: prefix + id }))
    .filter((item) => fits(item.data))
    .map((item) => [
      { text: `${item.id === current ? "✅ " : ""}${item.id}`, callback_data: item.data },
    ]);
  return { inline_keyboard: rows };
}

export function providersKeyboard(env: Env, current: string): InlineKeyboard {
  return {
    inline_keyboard: STT_PROVIDERS.map((provider) => [
      {
        text:
          (provider === current ? "✅ " : "") +
          PROVIDER_TITLES[provider] +
          (apiKeyFor(env, provider) ? "" : " 🔒"),
        callback_data: PREFIX.provider + provider,
      },
    ]),
  };
}

export function stylesKeyboard(current: string): InlineKeyboard {
  return {
    inline_keyboard: Object.entries(STYLES).map(([key, style]) => [
      {
        text: `${key === current ? "✅ " : ""}${style.title}`,
        callback_data: PREFIX.style + key,
      },
    ]),
  };
}

/** Кнопка «прибрати» під щойно створеним нагадуванням. */
export function reminderKeyboard(tail: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "🗑 Прибрати", callback_data: PREFIX.reminderDelete + tail }],
    ],
  };
}

/** Кнопка «у таблицю» під зчитаним документом. */
export function csvKeyboard(label: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: label, callback_data: `${PREFIX.csv}last` }]] };
}
