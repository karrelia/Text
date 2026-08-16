/**
 * Точка входу Worker'а.
 *
 * Обробку робимо синхронно, до відповіді Telegram: у Workers немає ліміту
 * на тривалість HTTP-запиту, поки клієнт під'єднаний, а waitUntil() дав би
 * лише 30 секунд і різав би довгі записи. Від повторів, які Telegram шле
 * при затримці, захищає дедуплікація за update_id.
 */

import { type Env, allowedUserIds } from "./env";
import { handleCallback } from "./handlers/callbacks";
import { COMMANDS, handleCommand, parseCommand } from "./handlers/commands";
import {
  handleAudioMessage,
  handleLongText,
  handlePhotoMessage,
  maybeRemind,
  rerun,
} from "./pipeline";
import { READ_THRESHOLD } from "./reading";
import {
  ageOn,
  birthdaysOn,
  greetedToday,
  isGreetingTime,
  todayIn,
} from "./daily";
import { snoozeKeyboard } from "./keyboards";
import {
  deleteReminder,
  dueReminders,
  firedId,
  rememberFired,
  saveReminder,
} from "./reminders";
import { nextAfter } from "./recurrence";
import { DEFAULT_TIMEZONE, formatLocal, localParts } from "./timezone";
import {
  loadLastJob,
  menuPublished,
  rememberMenu,
  seenUpdate,
  takeNoteRequest,
} from "./settings";
import {
  TelegramClient,
  type TgUpdate,
  extractAudio,
  extractPhoto,
} from "./telegram";
import * as texts from "./texts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/setup") {
      return handleSetup(request, env, url);
    }

    if (request.method !== "POST") {
      return new Response("Voice2Text UA bot is running.", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (
      env.WEBHOOK_SECRET &&
      request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }

    let update: TgUpdate;
    try {
      update = (await request.json()) as TgUpdate;
    } catch {
      return new Response("bad request", { status: 400 });
    }

    try {
      await handleUpdate(env, update);
    } catch (error) {
      // Відповідаємо 200 у будь-якому разі: інакше Telegram шле оновлення
      // по колу, і кожна спроба коштує грошей на API.
      console.error("Помилка обробки оновлення", error);
    }

    return new Response("ok");
  },

  /** Cron: раз на хвилину розсилає нагадування, час яких настав. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await sendDueReminders(env);
    await sendBirthdays(env);
  },
} satisfies ExportedHandler<Env>;

export async function sendDueReminders(env: Env): Promise<number> {
  const due = await dueReminders(env, Date.now());
  if (due.length === 0) return 0;

  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  let sent = 0;

  const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;

  for (const reminder of due) {
    // Наступну дату рахуємо до надсилання: якщо запис повторюваний, він має
    // відродитись навіть коли повідомлення не пройде.
    const next = reminder.repeat
      ? nextAfter(reminder.dueAt, reminder.repeat, timeZone, Date.now())
      : null;

    try {
      const text =
        reminder.repeat && next
          ? texts.REMINDER_FIRES_REPEAT(
              reminder.text,
              formatLocal(new Date(next), timeZone),
              reminder.repeat,
            )
          : texts.REMINDER_FIRES(reminder.text);

      // Прийшло невчасно — за кермом, на нараді. Без кнопок єдиний вихід
      // був створювати нагадування заново, диктуючи той самий текст.
      const id = firedId(reminder.key);
      await rememberFired(env, reminder.userId, id, reminder.text);
      await tg.sendMessage(reminder.chatId, text, {
        html: true,
        keyboard: snoozeKeyboard(texts.SNOOZE_DONE_BUTTON, id),
      });
      sent += 1;
    } catch (error) {
      // Не змогли надіслати — лишаємо запис, спробуємо за хвилину.
      console.error("Не вдалося надіслати нагадування", reminder.key, error);
      continue;
    }

    // Спершу ставимо наступне, потім прибираємо відпрацьоване: якщо між
    // двома діями щось урветься, краще зайвий раз нагадати, ніж загубити
    // щомісячне нагадування назавжди.
    if (reminder.repeat && next) {
      await saveReminder(
        env,
        reminder.userId,
        reminder.chatId,
        reminder.text,
        next,
        reminder.repeat,
      );
    }
    await deleteReminder(env, reminder.key);
  }

  return sent;
}

/**
 * Вітання з днем народження о дев'ятій ранку.
 *
 * Cron ходить щохвилини, тож без позначки «за цей день уже привітали»
 * о дев'ятій прилетіло б шістдесят однакових повідомлень.
 */
export async function sendBirthdays(env: Env): Promise<number> {
  const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;
  const now = localParts(new Date(), timeZone);
  if (!isGreetingTime(now.hour, now.minute)) return 0;

  const day = todayIn(timeZone);
  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  let sent = 0;

  for (const userId of allowedUserIds(env)) {
    const today = await birthdaysOn(env, userId, day);
    if (today.length === 0) continue;
    if (await greetedToday(env, userId, day)) continue;

    for (const person of today) {
      try {
        await tg.sendMessage(userId, texts.BIRTHDAY_TODAY(person.name, ageOn(day, person.year)), {
          html: true,
        });
        sent += 1;
      } catch (error) {
        console.error("Не вдалося привітати", person.name, error);
      }
    }
  }

  return sent;
}

export async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
  if (await seenUpdate(env, update.update_id)) return;

  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const allowed = allowedUserIds(env);

  if (update.callback_query) {
    const query = update.callback_query;
    if (!allowed.has(query.from.id)) {
      await tg.answerCallback(query.id, "Немає доступу", true);
      return;
    }
    await handleCallback(env, tg, query);
    return;
  }

  const message = update.message;
  const userId = message?.from?.id;
  if (!message || !userId) return;

  if (!allowed.has(userId)) {
    await tg.sendMessage(message.chat.id, texts.NO_ACCESS(userId), { html: true });
    return;
  }

  await syncMenu(env, tg);

  if (message.text) {
    const command = parseCommand(message.text);
    // Очікування знімаємо в будь-якому разі: якщо замість вказівки прийшла
    // команда, людина передумала, і чекати далі означало б з'їсти якесь
    // наступне повідомлення.
    const awaitingNote = await takeNoteRequest(env, userId);

    if (command) {
      await handleCommand(env, tg, message, userId, command.name, command.args);
      return;
    }

    if (awaitingNote) {
      await applyOwnNote(env, tg, message.chat.id, userId, message.text);
      return;
    }

    // Написане від руки теж може бути проханням нагадати — без команди.
    if (await maybeRemind(env, tg, message.chat.id, userId, message.text)) return;

    // Довгий текст пересилають не просто так: людина хоче знати, про що це.
    if (message.text.trim().length >= READ_THRESHOLD) {
      await handleLongText(env, tg, message.chat.id, userId, message.text.trim());
      return;
    }

    await tg.sendMessage(message.chat.id, texts.NOT_AUDIO);
    return;
  }

  if (extractAudio(message)) {
    await handleAudioMessage(env, tg, message, userId);
    return;
  }

  if (extractPhoto(message)) {
    await handlePhotoMessage(env, tg, message, userId);
    return;
  }

  await tg.sendMessage(message.chat.id, texts.NOT_AUDIO);
}

/**
 * Тримає меню команд у Telegram відповідним до коду.
 *
 * Раніше перелік публікувався лише під час прив'язки вебхука, тож кожна
 * додана згодом команда лишалася невидимою в списку «/» доти, доки людина
 * не здогадається ще раз відкрити /setup. Тепер розбіжність помічається
 * сама — ціною одного читання з KV.
 *
 * Помилку ковтаємо навмисне: несвіже меню — прикрість, а от впасти через
 * неї посеред обробки голосового було б значно гірше.
 */
async function syncMenu(env: Env, tg: TelegramClient): Promise<void> {
  const fingerprint = JSON.stringify(COMMANDS);
  try {
    if (await menuPublished(env, fingerprint)) return;
    await tg.setMyCommands(COMMANDS);
    await rememberMenu(env, fingerprint);
  } catch (error) {
    console.error("Не вдалося оновити меню команд", error);
  }
}

/** Написана від руки вказівка: переганяємо нею останній запис. */
async function applyOwnNote(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  note: string,
): Promise<void> {
  const job = await loadLastJob(env, userId);
  if (!job) {
    await tg.sendMessage(chatId, texts.REDO_NOTHING);
    return;
  }
  await tg.sendMessage(chatId, texts.REDO_RUNNING);
  await rerun(env, tg, chatId, userId, job, { note });
}

/**
 * Разова прив'язка вебхука: відкрити
 * https://<worker>.workers.dev/setup?secret=<WEBHOOK_SECRET>
 */
async function handleSetup(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.WEBHOOK_SECRET || url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const webhookUrl = new URL(request.url).origin + "/";

  try {
    await tg.setWebhook(webhookUrl, env.WEBHOOK_SECRET);
    await tg.setMyCommands(COMMANDS);
    await rememberMenu(env, JSON.stringify(COMMANDS));
  } catch (error) {
    return new Response(`Не вдалося: ${String(error)}`, { status: 502 });
  }

  return new Response(
    `Вебхук прив'язано до ${webhookUrl}\nМожеш писати боту в Telegram.`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
