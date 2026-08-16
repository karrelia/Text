/** Головні сценарії: голосове → чистий текст, фото → зчитаний текст. */

import { GATHER_MS, type AlbumPage, addPage, gather } from "./album";
import { type Env, numberVar } from "./env";
import { remember } from "./history";
import {
  photoResultKeyboard,
  reminderKeyboard,
  remindersKeyboard,
  undoKeyboard,
  voiceResultKeyboard,
} from "./keyboards";
import { OpenRouterError, processTranscript, takeLastCost } from "./openrouter";
import { buildWhisperHint, styleForNote, styleKind } from "./prompts";
import {
  type ManageIntent,
  ReminderError,
  createReminder,
  deleteReminder,
  keyTail,
  listReminders,
  manageIntent,
  planChange,
  reminderIntent,
  saveReminder,
  stashDeleted,
} from "./reminders";
import {
  type LastJob,
  type UserSettings,
  addSpending,
  clearNoteRequest,
  loadSettings,
  saveLastDocument,
  saveLastJob,
  saveLastTranscript,
} from "./settings";
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
import { DEFAULT_TIMEZONE, formatLocal, localDay } from "./timezone";
import { hasTemplates } from "./templates";
import { type PhotoInput, readPhoto } from "./vision";

// ── Голосове ─────────────────────────────────────────────────────────────────

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

  // Новий запис — чистий аркуш: недописана вказівка від попереднього не
  // повинна з'їсти наступне текстове повідомлення.
  await clearNoteRequest(env, userId);

  await runVoice(env, tg, chatId, userId, {
    kind: "voice",
    fileId: audio.file_id,
    fileName: audio.file_name ?? "",
  });
}

/**
 * Прогін голосового: розпізнавання (за потреби) і обробка тексту.
 *
 * `job.transcript` дозволяє перепрогнати лише обробку — коли змінилася
 * модель редагування чи стиль, розпізнавати вдруге нема сенсу: це зайві
 * гроші й секунди, а результат STT той самий.
 */
export async function runVoice(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  job: LastJob,
): Promise<void> {
  const reusing = Boolean(job.transcript?.trim());
  const note = job.note ?? "";
  const status = await tg.sendMessage(
    chatId,
    reusing ? texts.STATUS_CLEANING : texts.STATUS_TRANSCRIBING,
  );
  await tg.sendChatAction(chatId).catch(() => undefined);

  let cleaned: string;
  let spoken = "";
  let transcript = job.transcript ?? "";
  let chosenStyle = "";

  try {
    const user = await loadSettings(env, userId);
    const style = styleForNote(user.style, note);
    chosenStyle = style;

    if (!reusing) {
      const file = await tg.downloadFile(job.fileId);
      transcript = await transcribe(
        env,
        user.sttProvider,
        user.sttModel,
        file.body,
        job.fileName || file.name,
        buildWhisperHint(user.glossary),
      );
    }

    if (!transcript.trim()) {
      await tg.editMessage(chatId, status.message_id, texts.EMPTY_RESULT);
      return;
    }

    if (style !== "raw") {
      const waiting =
        styleKind(style) === "generate"
          ? texts.STATUS_GENERATING
          : texts.STATUS_CLEANING;
      await tg.editMessage(chatId, status.message_id, waiting);
    }
    cleaned = await processTranscript(env, transcript, user, note);

    // Для генеративних режимів вивід — це промт, а не сказане, тож і для
    // пам'яті, і для нагадувань беремо саме мовлення.
    spoken = styleKind(style) === "generate" ? transcript : cleaned;
    await saveLastTranscript(env, userId, spoken);
    await saveLastJob(env, userId, { ...job, transcript });
    await remember(env, userId, {
      kind: "voice",
      text: spoken,
      sourceId: job.fileId,
    });
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
  await sendWhole(tg, chatId, cleaned, parts.length, "rozshyfrovka");

  const minutes = styleKind(chosenStyle) === "minutes";
  await tg.sendMessage(chatId, texts.REDO_HINT(note, await countCost(env, userId)), {
    html: true,
    keyboard: voiceResultKeyboard(
      minutes ? texts.MINUTES_TASKS_BUTTON : "",
      // Кнопку показуємо лише тим, у кого бланки є: решті вона щоразу
      // відкривала б порожній перелік.
      (await hasTemplates(env, userId)) ? texts.TEMPLATE_BUTTON : "",
    ),
  });

  // У протоколі кнопка збирає всі доручення разом, тож звичайний розбір
  // однієї фрази тут лише заважав би: слово «нагадати» посеред наради
  // створило б випадкове нагадування замість справжніх завдань.
  if (!minutes) await maybeRemind(env, tg, chatId, userId, spoken);
}

// ── Фото ─────────────────────────────────────────────────────────────────────

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

  await clearNoteRequest(env, userId);

  const job: LastJob = {
    kind: "photo",
    fileId: photo.file_id,
    mimeType: photo.mime_type ?? "image/jpeg",
    caption: message.caption ?? "",
  };

  // Альбом приходить окремими оновленнями — зачекаємо решту сторінок і
  // прочитаємо документ цілком.
  if (message.media_group_id) {
    const page: AlbumPage = {
      fileId: photo.file_id,
      mimeType: job.mimeType!,
      caption: message.caption ?? "",
      messageId: message.message_id,
    };
    await addPage(env, userId, message.media_group_id, page);
    const album = await gather(
      env,
      userId,
      message.media_group_id,
      photo.file_id,
      numberVar(env.ALBUM_WAIT_MS, GATHER_MS),
    );
    if (!album) return;

    const pages = album.slice(0, MAX_ALBUM_PAGES);
    await runPhoto(env, tg, chatId, userId, {
      ...job,
      fileId: pages[0]!.fileId,
      fileIds: pages.map((item) => item.fileId),
      mimeType: pages[0]!.mimeType,
      // Підпис Telegram чіпляє лише до одного знімка альбому — беремо той,
      // що є, байдуже якої зі сторінок він стосувався.
      caption: pages.find((item) => item.caption.trim())?.caption ?? "",
    });
    return;
  }

  await runPhoto(env, tg, chatId, userId, job);
}

/**
 * Стеля на сторінки в одному прогоні. Кожен знімок роздувається в base64
 * і летить у тілі запиту; десяток — уже мегабайти, а процесорного часу на
 * вільному тарифі 10 мс.
 */
const MAX_ALBUM_PAGES = 10;

/** Прогін знімка. Перечитати іншою моделлю можна тим самим викликом. */
export async function runPhoto(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  job: LastJob,
): Promise<void> {
  const status = await tg.sendMessage(chatId, texts.STATUS_READING_PHOTO);
  await tg.sendChatAction(chatId).catch(() => undefined);

  let text: string;
  try {
    const user = await loadSettings(env, userId);
    const fileIds = job.fileIds?.length ? job.fileIds : [job.fileId];
    const images: PhotoInput[] = [];
    for (const fileId of fileIds) {
      const file = await tg.downloadFile(fileId);
      images.push({ body: file.body, mimeType: job.mimeType || "image/jpeg" });
    }

    // Підпис під фото і вказівка — те саме за призначенням, тож ідуть разом:
    // «лише показники» з підпису лишається чинним і після «зроби таблицею».
    text = await readPhoto(
      env,
      images,
      user,
      [job.caption, job.note].filter((part) => part?.trim()).join("\n"),
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
  await sendWhole(tg, chatId, text, parts.length, "dokument");

  // Зчитане лишається під рукою: одна кнопка перечитає іншою моделлю,
  // друга перенесе в таблицю для Excel.
  await saveLastDocument(env, userId, text);
  await saveLastJob(env, userId, job);
  await remember(env, userId, { kind: "photo", text, sourceId: job.fileId });
  await tg.sendMessage(chatId, texts.REDO_HINT(job.note ?? "", await countCost(env, userId)), {
    html: true,
    keyboard: photoResultKeyboard(
      texts.CSV_BUTTON,
      (await hasTemplates(env, userId)) ? texts.TEMPLATE_BUTTON : "",
    ),
  });
}

/**
 * Скільки коштував щойно зроблений виклик і скільки набігло за добу.
 *
 * Розпізнавання через Groq сюди не входить — у нього своя тарифікація й
 * окремий безкоштовний ліміт, а вигадувати число ми не будемо. Якщо
 * OpenRouter вартості не повернув (буває для окремих постачальників),
 * підпису просто не буде.
 */
async function countCost(env: Env, userId: number): Promise<texts.Spending | undefined> {
  const now = takeLastCost();
  if (now === null) return undefined;
  const day = localDay(new Date(), env.TIMEZONE || DEFAULT_TIMEZONE);
  const today = await addSpending(env, userId, day, now);
  return { now, today };
}

/**
 * Довгий текст додатково кладемо файлом.
 *
 * Щойно відповідь не вміщається в одне повідомлення, Telegram ріже її на
 * бульбашки — і скопіювати результат цілим стає марудно: на телефоні це
 * виділення через межі повідомлень. Файл вирішує це одним дотиком, тож
 * надсилаємо його рівно тоді, коли розрив стався.
 */
async function sendWhole(
  tg: TelegramClient,
  chatId: number,
  text: string,
  parts: number,
  prefix: string,
): Promise<void> {
  if (parts < 2) return;
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await tg.sendDocument(
      chatId,
      `${prefix}-${stamp}.txt`,
      text,
      texts.WHOLE_FILE_CAPTION,
      false,
      "text/plain",
    );
  } catch (error) {
    // Текст людина вже отримала — через невдалий файл нічого не ламаємо.
    console.log("Не вдалося надіслати текст файлом", error);
  }
}

// ── Повторний прогін ─────────────────────────────────────────────────────────

export interface RedoOptions {
  /** Вказівка на цей прогін. Порожній рядок знімає попередню. */
  note?: string;
  /** Розпізнати аудіо наново, а не брати збережений транскрипт. */
  fresh?: boolean;
}

/**
 * Переганяє збережений запис ще раз. Викликається і з кнопки, і з написаної
 * від руки вказівки — тому бере вже завантажений `job`, а не читає його
 * вдруге.
 */
export async function rerun(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  job: LastJob,
  options: RedoOptions = {},
): Promise<void> {
  const next: LastJob = {
    ...job,
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.fresh ? { transcript: "" } : {}),
  };

  if (next.kind === "photo") {
    await runPhoto(env, tg, chatId, userId, next);
    return;
  }
  await runVoice(env, tg, chatId, userId, next);
}

// ── Нагадування без команди ──────────────────────────────────────────────────

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
  const manage = manageIntent(text);
  const intent = manage === "none" ? reminderIntent(text) : "none";
  if (manage === "none" && intent === "none") return false;

  const user = await loadSettings(env, userId);
  // Один вимикач на все, що бот робить із нагадуваннями без команди:
  // і створення, і зміну. Інакше «без команди» означало б різне для
  // двох сусідніх дій.
  if (!user.autoRemind) return false;

  if (manage !== "none") {
    return await manageByVoice(env, tg, chatId, userId, text, manage, user);
  }

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

/**
 * «Прибери нагадування про показники», «перенеси нараду на четвер».
 *
 * Список підбираємо самі, а моделі даємо його пронумерованим і питаємо лише
 * номер: так вона не може вигадати нагадування, якого немає, а ми прибираємо
 * рівно те, що показали б людині в /reminders.
 */
async function manageByVoice(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  text: string,
  intent: Exclude<ManageIntent, "none">,
  user: UserSettings,
): Promise<boolean> {
  const reminders = await listReminders(env, userId);
  const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;

  if (reminders.length === 0) {
    await tg.sendMessage(chatId, texts.MANAGE_EMPTY);
    return true;
  }

  if (intent === "list") {
    await tg.sendMessage(
      chatId,
      texts.renderReminders(
        reminders.map((reminder) => ({
          when: formatLocal(new Date(reminder.dueAt), timeZone),
          text: reminder.text,
          ...(reminder.repeat ? { repeat: reminder.repeat } : {}),
        })),
      ),
      {
        html: true,
        keyboard: remindersKeyboard(reminders.map((reminder) => keyTail(reminder.key))),
      },
    );
    return true;
  }

  try {
    const change = await planChange(env, user, text, reminders);
    const target = reminders[change.index]!;

    if (change.action === "delete") {
      // Той самий відкат, що й у кнопки зі списку: голосом промахнутись
      // легше, ніж пальцем.
      await stashDeleted(env, target);
      await deleteReminder(env, target.key);
      await tg.sendMessage(chatId, texts.MANAGE_DELETED(target.text), {
        html: true,
        keyboard: undoKeyboard(texts.REMINDER_UNDO_BUTTON),
      });
      return true;
    }

    const was = formatLocal(new Date(target.dueAt), timeZone);
    await deleteReminder(env, target.key);
    const key = await saveReminder(
      env,
      userId,
      chatId,
      target.text,
      change.dueAt!,
      target.repeat,
    );
    await tg.sendMessage(
      chatId,
      texts.MANAGE_MOVED(target.text, was, formatLocal(new Date(change.dueAt!), timeZone)),
      { html: true, keyboard: reminderKeyboard(keyTail(key)) },
    );
    return true;
  } catch (error) {
    if (error instanceof ReminderError) {
      await tg.sendMessage(chatId, texts.MANAGE_FAILED(error.message), { html: true });
      return true;
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
