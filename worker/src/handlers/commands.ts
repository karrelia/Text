/** Обробка текстових команд. */

import { type Env, PROVIDER_TITLES } from "../env";
import { PRESET_LLM_MODELS, modelsKeyboard, providersKeyboard, stylesKeyboard } from "../keyboards";
import { modelExists, searchModels } from "../openrouter";
import { STYLES, selectHintTerms } from "../prompts";
import { loadSettings, resetSettings, updateSettings } from "../settings";
import type { TelegramClient, TgMessage } from "../telegram";
import * as texts from "../texts";

export const COMMANDS = [
  { command: "settings", description: "Поточні налаштування" },
  { command: "model", description: "Модель обробки тексту" },
  { command: "style", description: "Стиль обробки" },
  { command: "stt", description: "Рушій розпізнавання мови" },
  { command: "glossary", description: "Імена й терміни" },
  { command: "prompt", description: "Додаткові побажання" },
  { command: "reset", description: "Скинути налаштування" },
  { command: "help", description: "Довідка" },
];

/** Розбирає "/model claude" та "/model@my_bot claude". */
export function parseCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

export async function handleCommand(
  env: Env,
  tg: TelegramClient,
  message: TgMessage,
  userId: number,
  name: string,
  args: string,
): Promise<void> {
  const chatId = message.chat.id;
  const html = { html: true } as const;

  switch (name) {
    case "start":
      await tg.sendMessage(chatId, texts.START, html);
      return;

    case "help":
      await tg.sendMessage(chatId, texts.HELP, html);
      return;

    case "settings": {
      const user = await loadSettings(env, userId);
      await tg.sendMessage(chatId, texts.renderSettings(user), html);
      return;
    }

    case "reset": {
      await resetSettings(env, userId);
      const user = await loadSettings(env, userId);
      await tg.sendMessage(
        chatId,
        `${texts.RESET_DONE}\n\n${texts.renderSettings(user)}`,
        html,
      );
      return;
    }

    case "model":
      await handleModel(env, tg, chatId, userId, args);
      return;

    case "style": {
      const user = await loadSettings(env, userId);
      const style = STYLES[user.style] ?? STYLES.clean!;
      await tg.sendMessage(chatId, texts.STYLE_PICK(style.title), {
        html: true,
        keyboard: stylesKeyboard(user.style),
      });
      return;
    }

    case "stt": {
      const user = await loadSettings(env, userId);
      await tg.sendMessage(chatId, texts.STT_PICK(PROVIDER_TITLES[user.sttProvider]), {
        html: true,
        keyboard: providersKeyboard(env, user.sttProvider),
      });
      return;
    }

    case "glossary":
      await handleTextSetting(env, tg, chatId, userId, "glossary", args, texts.GLOSSARY_HELP);
      return;

    case "prompt":
      await handleTextSetting(env, tg, chatId, userId, "extraPrompt", args, texts.PROMPT_HELP);
      return;

    default:
      await tg.sendMessage(chatId, texts.HELP, html);
  }
}

async function handleModel(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  query: string,
): Promise<void> {
  const user = await loadSettings(env, userId);

  if (!query) {
    await tg.sendMessage(chatId, texts.MODEL_HELP(user.llmModel), {
      html: true,
      keyboard: modelsKeyboard(PRESET_LLM_MODELS, user.llmModel),
    });
    return;
  }

  // Схоже на точний ідентифікатор — ставимо одразу.
  if (query.includes("/") && !query.includes(" ")) {
    if ((await modelExists(env, query)) === false) {
      await tg.sendMessage(chatId, texts.MODEL_UNKNOWN(query), { html: true });
      return;
    }
    await updateSettings(env, userId, { llmModel: query });
    await tg.sendMessage(
      chatId,
      `${texts.SETTINGS_SAVED} Модель: <code>${texts.escapeHtml(query)}</code>`,
      { html: true },
    );
    return;
  }

  const matches = await searchModels(env, query);
  if (matches.length === 0) {
    await tg.sendMessage(chatId, texts.NO_MATCHES(query), { html: true });
    return;
  }

  await tg.sendMessage(chatId, `Знайшов за запитом «${texts.escapeHtml(query)}»:`, {
    html: true,
    keyboard: modelsKeyboard(
      matches.map((model) => model.id),
      user.llmModel,
    ),
  });
}

async function handleTextSetting(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  field: "glossary" | "extraPrompt",
  value: string,
  help: (current: string) => string,
): Promise<void> {
  if (!value) {
    const user = await loadSettings(env, userId);
    const current = user[field].trim();
    await tg.sendMessage(
      chatId,
      help(current ? `<code>${texts.escapeHtml(current)}</code>` : "—"),
      { html: true },
    );
    return;
  }

  if (value === "-") {
    await updateSettings(env, userId, { [field]: "" });
    await tg.sendMessage(chatId, "🧹 Очищено.");
    return;
  }

  await updateSettings(env, userId, { [field]: value });

  let note = "";
  if (field === "glossary") {
    const { kept, total } = selectHintTerms(value);
    note =
      kept.length < total
        ? "\n\n" + texts.GLOSSARY_TRUNCATED(kept.length, total)
        : "\n\n" + texts.GLOSSARY_FULL(total);
  }

  await tg.sendMessage(
    chatId,
    `${texts.SETTINGS_SAVED}\n\n<code>${texts.escapeHtml(value)}</code>${note}`,
    { html: true },
  );
}
