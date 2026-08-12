/** Головний сценарій: голосове повідомлення → чистий текст. */

import { type Env, numberVar } from "./env";
import { OpenRouterError, cleanTranscript } from "./openrouter";
import { buildWhisperHint } from "./prompts";
import { loadSettings } from "./settings";
import { TranscriptionError, transcribe } from "./stt";
import {
  DOWNLOAD_LIMIT,
  MESSAGE_LIMIT,
  type TelegramClient,
  TelegramError,
  type TgMessage,
  extractAudio,
} from "./telegram";
import * as texts from "./texts";

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
      await tg.editMessage(chatId, status.message_id, texts.STATUS_CLEANING);
    }
    cleaned = await cleanTranscript(env, transcript, user);
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
