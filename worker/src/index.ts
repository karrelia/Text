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
import { handleAudioMessage, handlePhotoMessage, maybeRemind } from "./pipeline";
import { deleteReminder, dueReminders } from "./reminders";
import { seenUpdate } from "./settings";
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
  },
} satisfies ExportedHandler<Env>;

export async function sendDueReminders(env: Env): Promise<number> {
  const due = await dueReminders(env, Date.now());
  if (due.length === 0) return 0;

  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  let sent = 0;

  for (const reminder of due) {
    try {
      await tg.sendMessage(reminder.chatId, texts.REMINDER_FIRES(reminder.text), {
        html: true,
      });
      sent += 1;
    } catch (error) {
      // Не змогли надіслати — лишаємо запис, спробуємо за хвилину.
      console.error("Не вдалося надіслати нагадування", reminder.key, error);
      continue;
    }
    await deleteReminder(env, reminder.key);
  }

  return sent;
}

async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
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

  if (message.text) {
    const command = parseCommand(message.text);
    if (command) {
      await handleCommand(env, tg, message, userId, command.name, command.args);
      return;
    }
    // Написане від руки теж може бути проханням нагадати — без команди.
    if (await maybeRemind(env, tg, message.chat.id, userId, message.text)) return;
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
  } catch (error) {
    return new Response(`Не вдалося: ${String(error)}`, { status: 502 });
  }

  return new Response(
    `Вебхук прив'язано до ${webhookUrl}\nМожеш писати боту в Telegram.`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
