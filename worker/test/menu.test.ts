import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import type { TgUpdate } from "../src/telegram";

// Меню команд живе на боці Telegram: поки не викликати setMyCommands, у
// списку «/» лишається те, що опублікували колись. Саме через це нові
// команди були невидимі — тож рахуємо виклики.
const menu = vi.hoisted(() => ({ calls: [] as string[][] }));

vi.mock("../src/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telegram")>();
  class FakeClient {
    async sendMessage(chatId: number) {
      return { message_id: 1, chat: { id: chatId } };
    }
    async editMessage() {}
    async answerCallback() {}
    async sendChatAction() {}
    async setMyCommands(commands: { command: string }[]) {
      menu.calls.push(commands.map((item) => item.command));
    }
  }
  return { ...actual, TelegramClient: FakeClient };
});

const { handleUpdate } = await import("../src/index");
const { COMMANDS } = await import("../src/handlers/commands");

class FakeKV {
  readonly data = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list() {
    return { keys: [], list_complete: true };
  }
}

const USER = 42;
let kv: FakeKV;
let env: Env;

beforeEach(() => {
  kv = new FakeKV();
  env = {
    SETTINGS: kv,
    ALLOWED_USER_IDS: String(USER),
    LLM_MODEL: "google/gemini-2.5-flash",
  } as unknown as Env;
  menu.calls.length = 0;
});

const text = (body: string, updateId: number): TgUpdate =>
  ({
    update_id: updateId,
    message: { message_id: 1, chat: { id: USER }, from: { id: USER }, text: body },
  }) as TgUpdate;

describe("меню команд", () => {
  it("публікується повністю, а не переліком із першого розгортання", async () => {
    await handleUpdate(env, text("/settings", 1));

    expect(menu.calls).toHaveLength(1);
    expect(menu.calls[0]).toEqual(COMMANDS.map((item) => item.command));
    // Саме ці команди й бракували в списку у користувача.
    expect(menu.calls[0]).toContain("vision");
    expect(menu.calls[0]).toContain("reminders");
    expect(menu.calls[0]).toContain("usage");
  });

  it("не смикає Telegram на кожне повідомлення", async () => {
    await handleUpdate(env, text("/settings", 1));
    await handleUpdate(env, text("/settings", 2));
    await handleUpdate(env, text("просто нотатка", 3));

    expect(menu.calls).toHaveLength(1);
  });

  it("оновлюється, щойно перелік у коді змінився", async () => {
    await handleUpdate(env, text("/settings", 1));
    // Так виглядає сховище після розгортання з іншим набором команд.
    await kv.put("meta:commands", JSON.stringify([{ command: "help" }]));
    await handleUpdate(env, text("/settings", 2));

    expect(menu.calls).toHaveLength(2);
  });

  it("чужому користувачеві меню не публікуємо", async () => {
    await handleUpdate(env, {
      update_id: 5,
      message: { message_id: 1, chat: { id: 7 }, from: { id: 7 }, text: "/start" },
    } as TgUpdate);

    expect(menu.calls).toHaveLength(0);
  });
});
