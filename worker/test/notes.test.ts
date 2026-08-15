import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { PREFIX } from "../src/keyboards";
import { TWEAKS, buildPhotoSystemPrompt, buildSystemPrompt, styleForNote } from "../src/prompts";
import type { TgCallbackQuery, TgUpdate } from "../src/telegram";

const transcribe = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => "ее сказане слово"));
const processTranscript = vi.hoisted(() =>
  vi.fn(async (_env: unknown, _text: string, _user: unknown, _note?: string) => "Готовий текст."),
);
const readPhoto = vi.hoisted(() =>
  vi.fn(
    async (
      _env: unknown,
      _body: unknown,
      _mime: string,
      _user: unknown,
      _instruction: string,
    ) => "Зчитано з фото",
  ),
);

// Спільний журнал: маршрутизатор оновлень створює клієнта Telegram сам, тож
// підміняємо саме клас, а не передаємо підробку аргументом.
const tg = vi.hoisted(() => ({
  sent: [] as string[],
  alerts: [] as string[],
  files: [] as string[],
}));

vi.mock("../src/stt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stt")>()),
  transcribe,
}));

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  processTranscript,
  searchModels: vi.fn(async () => []),
}));

vi.mock("../src/vision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/vision")>()),
  readPhoto,
}));

vi.mock("../src/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telegram")>();
  let messageId = 0;
  class FakeClient {
    async sendMessage(chatId: number, text: string) {
      tg.sent.push(text);
      return { message_id: ++messageId, chat: { id: chatId } };
    }
    async editMessage(_chatId: number, _id: number, text: string) {
      tg.sent.push(text);
    }
    async answerCallback(_id: string, text?: string) {
      if (text) tg.alerts.push(text);
    }
    async sendChatAction() {}
    async sendDocument() {}
    async deleteMessage() {}
    async downloadFile(fileId: string) {
      tg.files.push(fileId);
      return { body: new Response("файл"), name: "voice.ogg" };
    }
  }
  return { ...actual, TelegramClient: FakeClient };
});

const { handleAudioMessage, handlePhotoMessage } = await import("../src/pipeline");
const { handleCallback } = await import("../src/handlers/callbacks");
const { handleUpdate } = await import("../src/index");
const { loadSettings, loadLastJob } = await import("../src/settings");

class FakeKV {
  readonly data = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.data.get(key);
    if (raw === undefined) return null;
    return type === "json" ? JSON.parse(raw) : raw;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list() {
    return { keys: [], list_complete: true };
  }
}

const USER = 42;
const CHAT = 100;

let env: Env;
let client: { sendMessage: unknown };

beforeEach(async () => {
  env = {
    SETTINGS: new FakeKV(),
    LLM_MODEL: "google/gemini-2.5-flash",
    VISION_MODEL: "google/gemini-2.5-flash",
    GROQ_API_KEY: "test",
    ALLOWED_USER_IDS: String(USER),
    TIMEZONE: "Europe/Kyiv",
  } as unknown as Env;
  const { TelegramClient } = await import("../src/telegram");
  client = new TelegramClient("token") as never;
  tg.sent.length = 0;
  tg.alerts.length = 0;
  tg.files.length = 0;
  transcribe.mockClear();
  processTranscript.mockClear();
  readPhoto.mockClear();
});

const press = (data: string): TgCallbackQuery =>
  ({
    id: "cb1",
    from: { id: USER },
    data,
    message: { message_id: 1, chat: { id: CHAT } },
  }) as TgCallbackQuery;

const textUpdate = (text: string, updateId: number): TgUpdate =>
  ({
    update_id: updateId,
    message: { message_id: 9, chat: { id: CHAT }, from: { id: USER }, text },
  }) as TgUpdate;

const voiceMessage = () =>
  ({
    message_id: 7,
    chat: { id: CHAT },
    voice: { file_id: "AUDIO-1", duration: 12, file_size: 1000 },
  }) as never;

const photoMessage = (caption = "") =>
  ({
    message_id: 8,
    chat: { id: CHAT },
    caption,
    photo: [{ file_id: "PHOTO-1", file_size: 2000 }],
  }) as never;

const noteOf = (call: number) => processTranscript.mock.calls[call]?.[3];

describe("вказівка кнопкою", () => {
  it("готова вказівка доходить до обробки й не чіпає розпізнавання", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(`${PREFIX.redoNote}list`));

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(processTranscript).toHaveBeenCalledTimes(2);
    expect(noteOf(0)).toBe("");
    expect(noteOf(1)).toBe(TWEAKS.list!.text);
  });

  // Стиль і модель — вибір надовго, вказівка — ні. Якби вона осідала в
  // /prompt, наступне голосове теж вийшло б списком, а про це вже ніхто
  // не пам'ятав би.
  it("у налаштуваннях не осідає", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(`${PREFIX.redoNote}en`));

    expect((await loadSettings(env, USER)).extraPrompt).toBe("");
  });

  it("тримається під час наступної зміни моделі", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(`${PREFIX.redoNote}list`));
    await handleCallback(env, client as never, press(`${PREFIX.redoModel}openai/gpt-5`));

    expect(noteOf(2)).toBe(TWEAKS.list!.text);
  });

  it("нове голосове починається без вказівки", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(`${PREFIX.redoNote}list`));
    await handleAudioMessage(env, client as never, voiceMessage(), USER);

    expect(noteOf(2)).toBe("");
  });

  it("застаріла кнопка нічого не переробляє", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(`${PREFIX.redoNote}вигадане`));

    expect(processTranscript).toHaveBeenCalledTimes(1);
  });

  it("для знімка вказівка стає в один ряд із підписом", async () => {
    await handlePhotoMessage(env, client as never, photoMessage("лише показники"), USER);
    await handleCallback(env, client as never, press(`${PREFIX.redoNote}table`));

    const instruction = readPhoto.mock.calls[1]?.[4] ?? "";
    expect(instruction).toContain("лише показники");
    expect(instruction).toContain(TWEAKS.table!.text);
  });
});

describe("вказівка своїми словами", () => {
  it("наступне повідомлення стає вказівкою, а не нотаткою", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(PREFIX.redoAsk));
    await handleUpdate(env, textUpdate("перепиши це трьома реченнями", 1));

    expect(noteOf(1)).toBe("перепиши це трьома реченнями");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("спрацьовує один раз — далі текст знову звичайний", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(PREFIX.redoAsk));
    await handleUpdate(env, textUpdate("зроби списком", 1));
    await handleUpdate(env, textUpdate("просто нотатка", 2));

    expect(processTranscript).toHaveBeenCalledTimes(2);
  });

  // Інакше команда мовчки перетворилась би на вказівку — і /settings
  // повернув би переписаний текст замість налаштувань.
  it("команда лишається командою й знімає очікування", async () => {
    await handleAudioMessage(env, client as never, voiceMessage(), USER);
    await handleCallback(env, client as never, press(PREFIX.redoAsk));
    await handleUpdate(env, textUpdate("/settings", 1));
    await handleUpdate(env, textUpdate("а це вже нотатка", 2));

    expect(processTranscript).toHaveBeenCalledTimes(1);
  });

  it("без збереженого запису кнопка чесно каже, що переробляти нічого", async () => {
    await handleCallback(env, client as never, press(PREFIX.redoAsk));

    expect(tg.alerts.at(-1)).toContain("Немає чого переробляти");
    expect(await loadLastJob(env, USER)).toBeNull();
  });
});

describe("вказівка в системному промпті", () => {
  it("оголошується головнішою за правила подачі", () => {
    const prompt = buildSystemPrompt("clean", "", "", "Мова відповіді — англійська.");
    expect(prompt).toContain("Мова відповіді — англійська.");
    expect(prompt).toContain("головніша за правила подачі");
  });

  it("у редагуванні береже точність, у генерації — задум", () => {
    expect(buildSystemPrompt("clean", "", "", "зроби списком")).toContain("точність");
    expect(buildSystemPrompt("video", "", "", "українською")).toContain("задум");
  });

  it("без вказівки промпт лишається таким, як був", () => {
    expect(buildSystemPrompt("clean")).not.toContain("для цього прогону");
  });

  it("на знімку вказівка не скасовує точності читання", () => {
    const prompt = buildPhotoSystemPrompt("", "зроби таблицею");
    expect(prompt).toContain("зроби таблицею");
    expect(prompt).toContain("[нерозбірливо]");
  });
});

// «Без обробки» взагалі не звертається до моделі, тож будь-яка вказівка в
// цьому режимі просто зникла б — людина натиснула б і не побачила різниці.
describe("вказівка при вимкненій обробці", () => {
  it("переводить прогін на найближчий стиль, що вміє її виконати", () => {
    expect(styleForNote("raw", "зроби списком")).toBe("verbatim");
  });

  it("без вказівки «Без обробки» лишається собою", () => {
    expect(styleForNote("raw", "")).toBe("raw");
    expect(styleForNote("raw")).toBe("raw");
  });

  it("решти стилів не чіпає", () => {
    expect(styleForNote("clean", "зроби списком")).toBe("clean");
    expect(styleForNote("video", "українською")).toBe("video");
  });
});
