/** Мінімальний клієнт Telegram Bot API та типи оновлень. */

export interface TgUser {
  id: number;
  username?: string;
}

export interface TgFileMeta {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  duration?: number;
  file_size?: number;
}

export interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
  caption?: string;
  voice?: TgFileMeta;
  audio?: TgFileMeta;
  video_note?: TgFileMeta;
  document?: TgFileMeta;
  photo?: TgPhotoSize[];
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export class TelegramError extends Error {}

/** Телеграм ріже повідомлення на 4096 символів; лишаємо запас. */
export const MESSAGE_LIMIT = 3900;

/** Bot API не віддає файли, більші за 20 МБ. */
export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export class TelegramClient {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, payload: unknown): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Проксі та збої на боці мережі відповідають не-JSON — не даємо
    // SyntaxError протекти назовні під виглядом помилки обробки запису.
    let data: { ok?: boolean; result?: T; description?: string };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new TelegramError(`${method}: Telegram відповів ${response.status} без JSON`);
    }

    if (!data.ok) {
      throw new TelegramError(`${method}: ${data.description ?? response.status}`);
    }
    return data.result as T;
  }

  sendMessage(
    chatId: number,
    text: string,
    options: { html?: boolean; keyboard?: InlineKeyboard } = {},
  ): Promise<TgMessage> {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.html ? "HTML" : undefined,
      link_preview_options: { is_disabled: true },
      reply_markup: options.keyboard,
    });
  }

  async editMessage(
    chatId: number,
    messageId: number,
    text: string,
    options: { html?: boolean; keyboard?: InlineKeyboard } = {},
  ): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: options.html ? "HTML" : undefined,
        link_preview_options: { is_disabled: true },
        reply_markup: options.keyboard,
      });
    } catch (error) {
      // «message is not modified» — нормальна ситуація, не привід падати.
      if (!(error instanceof TelegramError) || !/not modified/i.test(error.message)) {
        throw error;
      }
    }
  }

  async answerCallback(id: string, text?: string, alert = false): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: id,
      text,
      show_alert: alert,
    });
  }

  async sendChatAction(chatId: number, action = "typing"): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  /**
   * Надсилає файл. Для CSV додаємо BOM: без нього Excel відкриває
   * кирилицю кракозябрами.
   */
  async sendDocument(
    chatId: number,
    fileName: string,
    content: string,
    caption?: string,
    withBom = false,
    mimeType = "text/csv",
  ): Promise<void> {
    const body = new FormData();
    body.append("chat_id", String(chatId));
    if (caption) body.append("caption", caption);
    body.append(
      "document",
      new Blob([(withBom ? "\uFEFF" : "") + content], {
        type: `${mimeType}; charset=utf-8`,
      }),
      fileName,
    );

    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendDocument`,
      { method: "POST", body },
    );
    if (!response.ok) {
      throw new TelegramError(`sendDocument: Telegram відповів ${response.status}`);
    }
  }

  /**
   * Міняє лише кнопки, не чіпаючи тексту. Потрібне там, де текст уже
   * відрендерений і переслати його як HTML не вийде — наприклад, щоб
   * прибрати кнопки під нагадуванням, яке щойно відклали.
   */
  async editKeyboard(
    chatId: number,
    messageId: number,
    keyboard?: InlineKeyboard,
  ): Promise<void> {
    try {
      await this.call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
      });
    } catch (error) {
      if (!(error instanceof TelegramError) || !/not modified/i.test(error.message)) {
        console.log("Не вдалося оновити кнопки", error);
      }
    }
  }

  /**
   * Прибирає своє повідомлення. Telegram дозволяє це протягом 48 годин;
   * невдачу ковтаємо — перелік кнопок, що затримався в чаті, не привід
   * зривати обробку.
   */
  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    try {
      await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch (error) {
      console.log("Не вдалося прибрати повідомлення", error);
    }
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    await this.call("setMyCommands", { commands });
  }

  async setWebhook(url: string, secret?: string): Promise<void> {
    await this.call("setWebhook", {
      url,
      secret_token: secret || undefined,
      drop_pending_updates: true,
      allowed_updates: ["message", "callback_query"],
    });
  }

  /**
   * Потік із файлом. Тіло не читаємо в пам'ять і не торкаємось байтів —
   * так процесорний час лишається мінімальним (на вільному тарифі його 10 мс).
   */
  async downloadFile(fileId: string): Promise<{ body: Response; name: string }> {
    const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) {
      throw new TelegramError("Telegram не повернув шлях до файлу");
    }
    const response = await fetch(
      `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
    );
    if (!response.ok) {
      throw new TelegramError(`Не вдалося завантажити файл: ${response.status}`);
    }
    return { body: response, name: file.file_path.split("/").pop() || "audio.ogg" };
  }
}

/** Фото стиснене Telegram — беремо найбільший варіант. Ним і читаємо текст. */
export function extractPhoto(message: TgMessage): TgFileMeta | null {
  if (message.photo?.length) {
    const largest = message.photo.reduce((best, size) =>
      size.width * size.height > best.width * best.height ? size : best,
    );
    return {
      file_id: largest.file_id,
      file_size: largest.file_size,
      mime_type: "image/jpeg",
      file_name: "photo.jpg",
    };
  }

  if (message.document?.mime_type?.startsWith("image/")) {
    return { ...message.document, file_name: message.document.file_name || "image.jpg" };
  }

  return null;
}

/** Дістає аудіо з повідомлення будь-якого підтримуваного типу. */
export function extractAudio(message: TgMessage): TgFileMeta | null {
  if (message.voice) return { ...message.voice, file_name: "audio.ogg" };
  if (message.video_note) return { ...message.video_note, file_name: "audio.mp4" };
  if (message.audio) {
    return { ...message.audio, file_name: message.audio.file_name || "audio.mp3" };
  }
  const document = message.document;
  if (document?.mime_type?.startsWith("audio/")) {
    return { ...document, file_name: document.file_name || "audio.ogg" };
  }
  return null;
}
