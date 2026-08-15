/** Обробка натискань на інлайн-кнопки. */

import { type Env, PROVIDER_TITLES, apiKeyFor, defaultSttModel, isSttProvider } from "../env";
import {
  PREFIX,
  PRESET_LLM_MODELS,
  PRESET_VISION_MODELS,
  modelsKeyboard,
  stylesKeyboard,
  tweaksKeyboard,
} from "../keyboards";
import { OpenRouterError, searchModels, toCsv } from "../openrouter";
import { type RedoOptions, rerun } from "../pipeline";
import { PHOTO_TWEAKS, STYLES, TWEAKS, VOICE_TWEAKS } from "../prompts";
import { nextAfter } from "../recurrence";
import {
  deleteReminder,
  keyFromTail,
  loadReminder,
  saveReminder,
  stashDeleted,
  takeDeleted,
} from "../reminders";
import { DEFAULT_TIMEZONE, formatLocal } from "../timezone";
import { renderReminderList } from "./commands";
import {
  askForNote,
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

  if (data.startsWith(PREFIX.redoNote)) {
    const tweak = TWEAKS[data.slice(PREFIX.redoNote.length)];
    if (!tweak) {
      await tg.answerCallback(query.id, texts.STALE_CHOICE, true);
      return;
    }
    await redo(env, tg, query, userId, chatId, {}, { note: tweak.text });
    return;
  }

  if (data.startsWith(PREFIX.redoAsk)) {
    await askOwnNote(env, tg, query, userId, chatId);
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
    await removeReminder(env, tg, query, userId, data.slice(PREFIX.reminderDelete.length));
    return;
  }

  if (data.startsWith(PREFIX.reminderUndo)) {
    await restoreReminder(env, tg, query, userId);
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

// ── Нагадування ──────────────────────────────────────────────────────────────

/**
 * Прибирає нагадування і одразу перемальовує решту списку, лишаючи кнопку
 * «Повернути». Прибрати не те — звична помилка, а нагадування нема звідки
 * відновити: людина вже не пам'ятає, на котру годину воно було.
 */
async function removeReminder(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
  userId: number,
  tail: string,
): Promise<void> {
  // Ключ складаємо з id того, хто натиснув — чуже нагадування прибрати не вийде.
  const key = keyFromTail(userId, tail);
  const doomed = await loadReminder(env, key);
  if (doomed) await stashDeleted(env, doomed);
  await deleteReminder(env, key);
  await tg.answerCallback(query.id, "Прибрано");
  await redrawReminders(env, tg, query, userId, texts.REMINDER_DELETED);
}

async function restoreReminder(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
  userId: number,
): Promise<void> {
  const stashed = await takeDeleted(env, userId);
  if (!stashed) {
    await tg.answerCallback(query.id, texts.REMINDER_UNDO_EXPIRED, true);
    return;
  }

  // Час міг уже минути, поки роздумували, — тоді ставимо наступне за повтором,
  // а одноразове нагадуємо негайно, бо іншого «коли» в нього немає.
  const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;
  const dueAt =
    stashed.dueAt > Date.now()
      ? stashed.dueAt
      : (stashed.repeat && nextAfter(stashed.dueAt, stashed.repeat, timeZone, Date.now())) ||
        Date.now();

  await saveReminder(env, userId, stashed.chatId, stashed.text, dueAt, stashed.repeat);
  await tg.answerCallback(
    query.id,
    texts.REMINDER_RESTORED(formatLocal(new Date(dueAt), timeZone)),
  );
  await redrawReminders(env, tg, query, userId, texts.REMINDERS_EMPTY);
}

/** Перемальовує список у тому самому повідомленні. */
async function redrawReminders(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
  userId: number,
  whenEmpty: string,
): Promise<void> {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (chatId === undefined || messageId === undefined) return;

  const view = await renderReminderList(env, userId, texts.REMINDER_UNDO_BUTTON);
  await tg.editMessage(chatId, messageId, view?.text ?? whenEmpty, {
    html: true,
    keyboard: view?.keyboard ?? {
      inline_keyboard: [
        [{ text: texts.REMINDER_UNDO_BUTTON, callback_data: PREFIX.reminderUndo }],
      ],
    },
  });
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

  if (kind === "p") {
    // Знімку пропонуємо своє: списком і таблицею тут доречні, а «стисло»
    // на зчитаному документі означало б викинути частину прочитаного.
    const keys = job.kind === "photo" ? PHOTO_TWEAKS : VOICE_TWEAKS;
    await tg.sendMessage(chatId, texts.REDO_PICK_TWEAK, {
      keyboard: tweaksKeyboard(keys, texts.REDO_OWN_NOTE_BUTTON),
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
 * Чи прийшло натискання з окремого повідомлення-переліку. Кнопки під самим
 * результатом (як «Перерозпізнати») сюди не належать — їх прибирати не можна.
 */
const PICKERS = [PREFIX.redoModel, PREFIX.redoStyle, PREFIX.redoVision, PREFIX.redoNote];
const isPicker = (data: string) => PICKERS.some((prefix) => data.startsWith(prefix));

/**
 * Просить написати вказівку своїми словами. Наступне текстове повідомлення
 * стане нею — про це знає маршрутизатор оновлень.
 */
async function askOwnNote(
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

  if (!(await loadLastJob(env, userId))) {
    await tg.answerCallback(query.id, texts.REDO_NOTHING, true);
    return;
  }

  await askForNote(env, userId);
  await tg.answerCallback(query.id);
  await tg.sendMessage(chatId, texts.REDO_ASK_NOTE);
}

/**
 * Зберігає вибір і одразу переганяє той самий запис.
 *
 * Модель і стиль лишаються надалі — це вибір, а не примха на один раз.
 * Вказівка ж навпаки: вона живе разом із записом, у налаштування не
 * потрапляє й на наступному голосовому не спливе.
 */
async function redo(
  env: Env,
  tg: TelegramClient,
  query: TgCallbackQuery,
  userId: number,
  chatId: number | undefined,
  patch: Parameters<typeof updateSettings>[2],
  options: RedoOptions = {},
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

  // Перелік своє відпрацював. Лишати його в чаті — засмічувати переписку
  // мертвими кнопками, які з часом почнуть суперечити налаштуванням.
  const picker = query.message?.message_id;
  if (picker !== undefined && isPicker(query.data ?? "")) {
    await tg.deleteMessage(chatId, picker);
  }

  await rerun(env, tg, chatId, userId, job, options);
}
