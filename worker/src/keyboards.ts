/**
 * Інлайн-клавіатури.
 *
 * У Workers немає спільної пам'яті між запитами, тож callback_data несе
 * значення напряму. Ліміт Telegram — 64 байти, довші варіанти просто не
 * показуємо кнопкою (їх можна задати точним ідентифікатором у команді).
 */

import { type Env, PROVIDER_TITLES, STT_PROVIDERS, apiKeyFor } from "./env";
import { STYLES, TWEAKS } from "./prompts";
import type { InlineKeyboard } from "./telegram";

export const CALLBACK_LIMIT = 64;

export const PREFIX = {
  model: "m:",
  vision: "v:",
  style: "s:",
  provider: "p:",
  reminderDelete: "rd:",
  csv: "csv:",
  /**
   * Відкрити перелік для повторного прогону: "m" — модель, "s" — стиль,
   * "v" — модель для фото, "p" — вказівка.
   */
  redoOpen: "ro:",
  redoModel: "rm:",
  redoStyle: "rs:",
  redoVision: "rv:",
  redoStt: "rt:",
  redoNote: "rn:",
  redoAsk: "ra:",
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

export function stylesKeyboard(
  current: string,
  prefix: string = PREFIX.style,
): InlineKeyboard {
  return {
    inline_keyboard: Object.entries(STYLES).map(([key, style]) => [
      {
        text: `${key === current ? "✅ " : ""}${style.title}`,
        callback_data: prefix + key,
      },
    ]),
  };
}

/** Кнопки під розшифровкою: перепрогнати іншою моделлю, стилем або наново. */
export function voiceResultKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "🔁 Інша модель", callback_data: `${PREFIX.redoOpen}m` },
        { text: "✍️ Інший стиль", callback_data: `${PREFIX.redoOpen}s` },
      ],
      [
        { text: "💬 Вказівка", callback_data: `${PREFIX.redoOpen}p` },
        { text: "🎧 Перерозпізнати", callback_data: PREFIX.redoStt },
      ],
    ],
  };
}

/** Кнопки під зчитаним знімком. */
export function photoResultKeyboard(csvLabel: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "🔁 Інша модель", callback_data: `${PREFIX.redoOpen}v` },
        { text: "💬 Вказівка", callback_data: `${PREFIX.redoOpen}p` },
      ],
      [{ text: csvLabel, callback_data: `${PREFIX.csv}last` }],
    ],
  };
}

/**
 * Готові вказівки плюс «своя». Останню кнопку прибрати не можна: перелік
 * ніколи не вгадає всього, а саме заради довільної фрази це й робилось.
 */
export function tweaksKeyboard(keys: string[], ownLabel: string): InlineKeyboard {
  const rows = keys
    .filter((key) => TWEAKS[key])
    .map((key) => [{ text: TWEAKS[key]!.title, callback_data: PREFIX.redoNote + key }]);
  return { inline_keyboard: [...rows, [{ text: ownLabel, callback_data: PREFIX.redoAsk }]] };
}

/** Кнопка «прибрати» під щойно створеним нагадуванням. */
export function reminderKeyboard(tail: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "🗑 Прибрати", callback_data: PREFIX.reminderDelete + tail }],
    ],
  };
}
