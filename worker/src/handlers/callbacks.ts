/** Обробка натискань на інлайн-кнопки. */

import { type Env, PROVIDER_TITLES, apiKeyFor, defaultSttModel, isSttProvider } from "../env";
import {
  PREFIX,
  PRESET_LLM_MODELS,
  PRESET_VISION_MODELS,
  modelsKeyboard,
  stylesKeyboard,
} from "../keyboards";
import { OpenRouterError, searchModels, toCsv } from "../openrouter";
import { runPhoto, runVoice } from "../pipeline";
import { STYLES } from "../prompts";
import { deleteReminder, keyFromTail } from "../reminders";
import {
  loadLastDocument,
  loadLastJob,
  loadSettings,
  updateSettings,
} from "../settings";
import type { TelegramClient, TgCallbackQuery } from "../telegram";
import * as texts from "../texts";

export async function handleCallback(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
): Promise<void> {
  const data = query.data ?? "";
  const userId = query.from.id;
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  const edit = async (text: string) => {
    if (chatId && messageId) {
      await tg.editMessage(chatId, messageId, text, { html: true });
    }
  };

  if (data.startsWith(PREFIX.model)) {
    const model = data.slice(PREFIX.model.length);
    await updateSettings(env, userId, { llmModel: model });
    await tg.answerCallback(query.id, "Збережено");
    await edit(`${texts.SETTINGS_SAVED} Модель: <code>${texts.escapeHtml(model)}</code>`);
    return;
  }

  if (data.startsWith(PREFIX.redoOpen)) {
    await openRedoPicker(env, tg, query, userId, chatId, data.slice(PREFIX.redoOpen.length));
    return;
  }

  if (data.startsWith(PREFIX.redoModel)) {
    await redo(env, tg, query, userId, chatId, {
      llmModel: data.slice(PREFIX.redoModel.length),
    });
    return;
  }

  if (data.startsWith(PREFIX.redoStyle)) {
    const style = data.slice(PREFIX.redoStyle.length);
    if (!(style in STYLES)) {
      await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
      return;
    }
    await redo(env, tg, query, userId, chatId, { style });
    return;
  }

  if (data.startsWith(PREFIX.redoVision)) {
    await redo(env, tg, query, userId, chatId, {
      visionModel: data.slice(PREFIX.redoVision.length),
    });
    return;
  }

  if (data.startsWith(PREFIX.redoStt)) {
    // Наново з аудіо: рушій розпізнавання міг змінитись, тож збережений
    // транскрипт більше не відповідає налаштуванням.
    await redo(env, tg, query, userId, chatId, {}, { fresh: true });
    return;
  }

  if (data.startsWith(PREFIX.csv)) {
    await handleCsv(env, tg, query, userId, chatId);
    return;
  }

  if (data.startsWith(PREFIX.vision)) {
    const model = data.slice(PREFIX.vision.length);
    await updateSettings(env, userId, { visionModel: model });
    await tg.answerCallback(query.id, "Збережено");
    await edit(
      `${texts.SETTINGS_SAVED} Модель для фото: <code>${texts.escapeHtml(model)}</code>`,
    );
    return;
  }

  if (data.startsWith(PREFIX.reminderDelete)) {
    const tail = data.slice(PREFIX.reminderDelete.length);
    // Ключ складаємо з id того, хто натиснув — чуже нагадування прибрати не вийде.
    await deleteReminder(env, keyFromTail(userId, tail));
    await tg.answerCallback(query.id, "Прибрано");
    await edit(texts.REMINDER_DELETED);
    return;
  }

  if (data.startsWith(PREFIX.style)) {
    const key = data.slice(PREFIX.style.length);
    const style = STYLES[key];
    if (!style) {
      await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
      return;
    }
    await updateSettings(env, userId, { style: key });
    await tg.answerCallback(query.id, "Збережено");
    await edit(`${texts.SETTINGS_SAVED}\n\n✍️ ${style.title} — ${style.hint}`);
    return;
  }

  if (data.startsWith(PREFIX.provider)) {
    const provider = data.slice(PREFIX.provider.length);
    if (!isSttProvider(provider)) {
      await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
      return;
    }
    if (!apiKeyFor(env, provider)) {
      await tg.answerCallback(query.id, texts.STT_NO_KEY, true);
      return;
    }

    // Модель прив'язана до провайдера, тож скидаємо її разом із ним.
    await updateSettings(env, userId, {
      sttProvider: provider,
      sttModel: defaultSttModel(env, provider),
    });
    const user = await loadSettings(env, userId);
    await tg.answerCallback(query.id, "Збережено");
    await edit(
      `${texts.SETTINGS_SAVED}\n\n🎧 ${PROVIDER_TITLES[provider]}\n` +
        `   модель: <code>${texts.escapeHtml(user.sttModel)}</code>`,
    );
    return;
  }

  await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
}

/** Переносить останній зчитаний документ у CSV і надсилає файлом. */
async function handleCsv(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
  userId: number,
  chatId: number | undefined,
): Promise<void> {
  if (chatId === undefined) {
    await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
    return;
  }

  const document = await loadLastDocument(env, userId);
  if (!document) {
    await tg.answerCallback(query.id, texts.CSV_NOTHING, true);
    return;
  }

  await tg.answerCallback(query.id, texts.CSV_BUILDING);

  try {
    const user = await loadSettings(env, userId);
    const csv = await toCsv(env, document, user.llmModel);
    const stamp = new Date().toISOString().slice(0, 10);
    // BOM обов'язковий: без нього Excel показує кирилицю кракозябрами.
    await tg.sendDocument(chatId, `document-${stamp}.csv`, csv, texts.CSV_CAPTION, true);
  } catch (error) {
    const reason = error instanceof OpenRouterError ? error.message : String(error);
    await tg.sendMessage(chatId, texts.CSV_FAILED(reason), { html: true });
  }
}

// ── Повторний прогін ─────────────────────────────────────────────────────────

/** Показує перелік моделей або стилів, вибір з якого одразу переробляє запис. */
async function openRedoPicker(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
  userId: number,
  chatId: number | undefined,
  kind: string,
): Promise<void> {
  if (chatId === undefined) {
    await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
    return;
  }

  const job = await loadLastJob(env, userId);
  if (!job) {
    await tg.answerCallback(query.id, texts.REDO_NOTHING, true);
    return;
  }

  const user = await loadSettings(env, userId);
  await tg.answerCallback(query.id);

  if (kind === "s") {
    await tg.sendMessage(chatId, texts.REDO_PICK_STYLE, {
      keyboard: stylesKeyboard(user.style, PREFIX.redoStyle),
    });
    return;
  }

  if (kind === "v") {
    const found = await searchModels(env, "", { imageOnly: true, limit: 8 });
    const models = found.length > 0 ? found.map((m) => m.id) : PRESET_VISION_MODELS;
    await tg.sendMessage(chatId, texts.REDO_PICK_VISION, {
      keyboard: modelsKeyboard(models, user.visionModel, PREFIX.redoVision),
    });
    return;
  }

  await tg.sendMessage(chatId, texts.REDO_PICK_MODEL, {
    keyboard: modelsKeyboard(PRESET_LLM_MODELS, user.llmModel, PREFIX.redoModel),
  });
}

/**
 * Зберігає вибір і одразу переганяє той самий запис.
 *
 * Для голосового транскрипт беремо збережений — розпізнавати вдруге нема
 * сенсу, поки не змінився рушій STT. Кнопка «Перерозпізнати» просить
 * свіжий прогін явно.
 */
async function redo(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
  userId: number,
  chatId: number | undefined,
  patch: Parameters<typeof updateSettings>[2],
  options: { fresh?: boolean } = {},
): Promise<void> {
  if (chatId === undefined) {
    await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
    return;
  }

  const job = await loadLastJob(env, userId);
  if (!job) {
    await tg.answerCallback(query.id, texts.REDO_NOTHING, true);
    return;
  }

  if (options.fresh && job.kind !== "voice") {
    await tg.answerCallback(query.id, texts.REDO_NO_AUDIO, true);
    return;
  }

  if (Object.keys(patch).length > 0) {
    await updateSettings(env, userId, patch);
  }
  await tg.answerCallback(query.id, texts.REDO_RUNNING);

  if (job.kind === "photo") {
    await runPhoto(env, tg, chatId, userId, job);
    return;
  }

  await runVoice(env, tg, chatId, userId, {
    ...job,
    ...(options.fresh ? { transcript: "" } : {}),
  });
}
