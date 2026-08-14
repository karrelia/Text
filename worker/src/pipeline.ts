/** Головні сценарії: голосове → чистий текст, фото → зчитаний текст. */

import { type Env, numberVar } from "./env";
import { OpenRouterError, processTranscript } from "./openrouter";
import { buildWhisperHint, styleKind } from "./prompts";
import {
  ReminderError,
  createReminder,
  keyTail,
  reminderIntent,
} from "./reminders";
import { loadSettings, saveLastDocument, saveLastTranscript } from "./settings";
import { TranscriptionError, transcribe } from "./stt";
import {
  DOWNLOAD_LIMIT,
  MESSAGE_LIMIT,
  type TelegramClient,
  TelegramError,
  type TgMessage,
  extractAudio,
  extractPhoto,
} from "./telegram";
import * as texts from "./texts";
import { csvKeyboard, reminderKeyboard } from "./keyboards";
import { DEFAULT_TIMEZONE, formatLocal } from "./timezone";
import { readPhoto } from "./vision";

export async function handleAudioMessage(
  env: Env,
  tg: TelegramClient,
  message: TgMessage,
  userId: number,
): Promise<void> {
  const chatId = message.chat.id;
  const audio = extractAudio(message);
  if (!audio) {
    await tg.sendMessage(chatId, texts.NOT_AUDIO);
    return;
  }

  const limit = numberVar(env.MAX_AUDIO_SECONDS, 5400);
  if (limit > 0 && audio.duration && audio.duration > limit) {
    await tg.sendMessage(
      chatId,
      texts.ERROR_TOO_LONG(Math.round(audio.duration / 60), Math.round(limit / 60)),
    );
    return;
  }

  if (audio.file_size && audio.file_size > DOWNLOAD_LIMIT) {
    await tg.sendMessage(chatId, texts.ERROR_TOO_BIG);
    return;
  }

  const status = await tg.sendMessage(chatId, texts.STATUS_TRANSCRIBING);
  await tg.sendChatAction(chatId).catch(() => undefined);

  let cleaned: string;
  let spoken = "";
  try {
    const user = await loadSettings(env, userId);
    const file = await tg.downloadFile(audio.file_id);

    const transcript = await transcribe(
      env,
      user.sttProvider,
      user.sttModel,
      file.body,
      audio.file_name || file.name,
      buildWhisperHint(user.glossary),
    );

    if (!transcript.trim()) {
      await tg.editMessage(chatId, status.message_id, texts.EMPTY_RESULT);
      return;
    }

    if (user.style !== "raw") {
      const waiting =
        styleKind(user.style) === "generate"
          ? texts.STATUS_GENERATING
          : texts.STATUS_CLEANING;
      await tg.editMessage(chatId, status.message_id, waiting);
    }
    cleaned = await processTranscript(env, transcript, user);

    // Для генеративних режимів вивід — це промт, а не сказане, тож і для
    // пам'яті, і для нагадувань беремо саме мовлення.
    spoken = styleKind(user.style) === "generate" ? transcript : cleaned;
    await saveLastTranscript(env, userId, spoken);
  } catch (error) {
    await tg.editMessage(chatId, status.message_id, describe(error), { html: true });
    return;
  }

  const parts = texts.splitForTelegram(cleaned, MESSAGE_LIMIT);
  if (parts.length === 0) {
    await tg.editMessage(chatId, status.message_id, texts.EMPTY_RESULT);
    return;
  }

  await tg.editMessage(chatId, status.message_id, parts[0]!);
  for (const part of parts.slice(1)) {
    await tg.sendMessage(chatId, part);
  }

  await maybeRemind(env, tg, chatId, userId, spoken);
}

/**
 * Створює нагадування, якщо сказане на нього схоже.
 *
 * Про невдачу мовчимо лише тоді, коли намір був слабкий: людина надиктувала
 * нотатку, у якій просто трапилось слово «нагадування». Якщо ж прохання було
 * прямим («нагадай…», «додай нагадування…»), мовчання — найгірша відповідь:
 * людина чекає, а нічого не сталося й незрозуміло чому.
 */
export async function maybeRemind(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  text: string,
): Promise<boolean> {
  const intent = reminderIntent(text);
  if (intent === "none") return false;

  const user = await loadSettings(env, userId);
  if (!user.autoRemind) return false;

  try {
    const { key, dueAt, what, repeat } = await createReminder(
      env,
      user,
      userId,
      chatId,
      text,
    );
    await tg.sendMessage(
      chatId,
      texts.REMIND_AUTO(
        what,
        formatLocal(new Date(dueAt), env.TIMEZONE || DEFAULT_TIMEZONE),
        repeat,
      ),
      { html: true, keyboard: reminderKeyboard(keyTail(key)) },
    );
    return true;
  } catch (error) {
    if (error instanceof ReminderError) {
      if (intent === "strong") {
        await tg.sendMessage(chatId, texts.REMIND_AUTO_FAILED(error.message), {
          html: true,
        });
        return true;
      }
      console.log("Схоже на нагадування, але без часу:", error.message);
      return false;
    }
    throw error;
  }
}

function describe(error: unknown): string {
  if (error instanceof TelegramError && /too big/i.test(error.message)) {
    return texts.ERROR_TOO_BIG;
  }
  if (
    error instanceof TranscriptionError ||
    error instanceof OpenRouterError ||
    error instanceof TelegramError
  ) {
    return texts.ERROR_GENERIC(error.message);
  }
  console.error("Несподівана помилка обробки запису", error);
  return texts.ERROR_GENERIC(String(error));
}

/** Фото → текст. Підпис під знімком стає окремою вказівкою моделі. */
export async function handlePhotoMessage(
  env: Env,
  tg: TelegramClient,
  message: TgMessage,
  userId: number,
): Promise<void> {
  const chatId = message.chat.id;
  const photo = extractPhoto(message);
  if (!photo) return;

  if (photo.file_size && photo.file_size > DOWNLOAD_LIMIT) {
    await tg.sendMessage(chatId, texts.ERROR_TOO_BIG);
    return;
  }

  const status = await tg.sendMessage(chatId, texts.STATUS_READING_PHOTO);
  await tg.sendChatAction(chatId).catch(() => undefined);

  let text: string;
  try {
    const user = await loadSettings(env, userId);
    const file = await tg.downloadFile(photo.file_id);
    text = await readPhoto(
      env,
      file.body,
      photo.mime_type || "image/jpeg",
      user,
      message.caption ?? "",
    );
  } catch (error) {
    await tg.editMessage(chatId, status.message_id, describe(error), { html: true });
    return;
  }

  const parts = texts.splitForTelegram(text, MESSAGE_LIMIT);
  if (parts.length === 0) {
    await tg.editMessage(chatId, status.message_id, texts.EMPTY_PHOTO);
    return;
  }

  await tg.editMessage(chatId, status.message_id, parts[0]!);
  for (const part of parts.slice(1)) {
    await tg.sendMessage(chatId, part);
  }

  // Зчитане лишається під рукою: кнопка перенесе його в таблицю для Excel.
  await saveLastDocument(env, userId, text);
  await tg.sendMessage(chatId, texts.CSV_HINT, {
    keyboard: csvKeyboard(texts.CSV_BUTTON),
  });
}
