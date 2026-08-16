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
  reminderUndo: "ru:",
  /** Відкласти те, що щойно спрацювало: "sn:<хвилини>". */
  snooze: "sn:",
  snoozeDone: "sd:",
  minutesTasks: "mt:",
  historyOpen: "ho:",
  templateFill: "tf:",
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

/**
 * Кнопки під розшифровкою: перепрогнати іншою моделлю, стилем або наново.
 * Під протоколом додається ще одна — зібрати нагадування з доручень.
 */
export function voiceResultKeyboard(tasksLabel = "", templateLabel = ""): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [
    [
      { text: "🔁 Інша модель", callback_data: `${PREFIX.redoOpen}m` },
      { text: "✍️ Інший стиль", callback_data: `${PREFIX.redoOpen}s` },
    ],
    [
      { text: "💬 Вказівка", callback_data: `${PREFIX.redoOpen}p` },
      { text: "🎧 Перерозпізнати", callback_data: PREFIX.redoStt },
    ],
  ];
  if (templateLabel) {
    rows.push([{ text: templateLabel, callback_data: `${PREFIX.redoOpen}t` }]);
  }
  if (tasksLabel) {
    rows.unshift([{ text: tasksLabel, callback_data: PREFIX.minutesTasks }]);
  }
  return { inline_keyboard: rows };
}

/**
 * Перелік своїх бланків. Ідентифікатор роблять із назви, тож довгі назви
 * у кнопку не влазять — такі просто не показуємо, їх видно в /template.
 */
export function templatesKeyboard(
  templates: { id: string; title: string }[],
): InlineKeyboard {
  return {
    inline_keyboard: templates
      .map((template) => ({ template, data: PREFIX.templateFill + template.id }))
      .filter((item) => fits(item.data))
      .map((item) => [{ text: `📄 ${item.template.title}`, callback_data: item.data }]),
  };
}

/** Кнопки під знайденим у пошуку: розгорнути запис повністю. */
export function historyKeyboard(stamps: string[]): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [];
  for (let index = 0; index < stamps.length; index += 4) {
    rows.push(
      stamps.slice(index, index + 4).map((stamp, offset) => ({
        text: `${index + offset + 1}`,
        callback_data: PREFIX.historyOpen + stamp,
      })),
    );
  }
  return { inline_keyboard: rows };
}

/** Кнопки під зчитаним знімком. */
export function photoResultKeyboard(csvLabel: string, templateLabel = ""): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [
    [
      { text: "🔁 Інша модель", callback_data: `${PREFIX.redoOpen}v` },
      { text: "💬 Вказівка", callback_data: `${PREFIX.redoOpen}p` },
    ],
    [{ text: csvLabel, callback_data: `${PREFIX.csv}last` }],
  ];
  if (templateLabel) {
    rows.push([{ text: templateLabel, callback_data: `${PREFIX.redoOpen}t` }]);
  }
  return { inline_keyboard: rows };
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

/** Сама лише кнопка «повернути» — під прибраним голосом нагадуванням. */
export function undoKeyboard(label: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: label, callback_data: PREFIX.reminderUndo }]] };
}

/** Кнопка «прибрати» під щойно створеним нагадуванням. */
export function reminderKeyboard(tail: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "🗑 Прибрати", callback_data: PREFIX.reminderDelete + tail }],
    ],
  };
}

/**
 * Кнопки під нагадуванням, що спрацювало.
 *
 * Текст у callback_data не помістився б (ліміт 64 байти), тож несемо лише
 * відстрочку у хвилинах і короткий ідентифікатор — сам текст лежить у KV.
 * Ідентифікатор потрібен саме тому, що о дев'ятій може спрацювати кілька
 * нагадувань, і «+1 год» під першим має відкласти саме перше.
 */
export const SNOOZE_STEPS = [
  { minutes: 60, title: "+1 год" },
  { minutes: 180, title: "+3 год" },
  { minutes: 1440, title: "Завтра" },
] as const;

export function snoozeKeyboard(doneLabel: string, id: string): InlineKeyboard {
  return {
    inline_keyboard: [
      SNOOZE_STEPS.map((step) => ({
        text: step.title,
        callback_data: `${PREFIX.snooze}${step.minutes}:${id}`,
      })),
      [{ text: doneLabel, callback_data: PREFIX.snoozeDone }],
    ],
  };
}

/**
 * Кнопки до списку нагадувань: по одній на запис, підписані номером із
 * тексту. Самі рядки списку кнопками не роблимо — тицяння в них колись
 * знищувало нагадування замість того, щоб показати його повністю.
 */
export function remindersKeyboard(
  tails: string[],
  undoLabel?: string,
): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [];
  for (let index = 0; index < tails.length; index += 4) {
    rows.push(
      tails.slice(index, index + 4).map((tail, offset) => ({
        text: `🗑 ${index + offset + 1}`,
        callback_data: PREFIX.reminderDelete + tail,
      })),
    );
  }
  if (undoLabel) {
    rows.push([{ text: undoLabel, callback_data: PREFIX.reminderUndo }]);
  }
  return { inline_keyboard: rows };
}
