/** Обробка натискань на інлайн-кнопки. */

import { type Env, PROVIDER_TITLES, apiKeyFor, defaultSttModel, isSttProvider } from "../env";
import { PREFIX } from "../keyboards";
import { deleteReminder, keyFromTail } from "../reminders";
import { OpenRouterError, toCsv } from "../openrouter";
import { loadLastDocument } from "../settings";
import { STYLES } from "../prompts";
import { loadSettings, updateSettings } from "../settings";
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
