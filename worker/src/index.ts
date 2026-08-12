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
import { handleAudioMessage } from "./pipeline";
import { seenUpdate } from "./settings";
import { TelegramClient, type TgUpdate, extractAudio } from "./telegram";
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
} satisfies ExportedHandler<Env>;

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
    } else {
      await tg.sendMessage(message.chat.id, texts.NOT_AUDIO);
    }
    return;
  }

  if (extractAudio(message)) {
    await handleAudioMessage(env, tg, message, userId);
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
