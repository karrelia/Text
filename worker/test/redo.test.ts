import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { PREFIX } from "../src/keyboards";
import type { TgCallbackQuery } from "../src/telegram";

// Розпізнавання, редагування й читання фото ходять у мережу — підміняємо
// саме їх. Перевіряємо не якість відповіді моделі, а те, скільки разів і що
// саме викликається при повторному прогоні.
const transcribe = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => "ее сказане слово"),
);
const processTranscript = vi.hoisted(() =>
  vi.fn(async (_env: unknown, _text: string, _user: { llmModel: string }) => "Сказане слово."),
);
const readPhoto = vi.hoisted(() =>
  vi.fn(
    async (
      _env: unknown,
      _images: { mimeType: string }[],
      _user: { visionModel: string },
      _instruction: string,
    ) => "Зчитано з фото",
  ),
);
const searchModels = vi.hoisted(() => vi.fn(async () => [] as { id: string }[]));

vi.mock("../src/stt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stt")>()),
  transcribe,
}));

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  processTranscript,
  searchModels,
}));

vi.mock("../src/vision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/vision")>()),
  readPhoto,
}));

const { handleAudioMessage, handlePhotoMessage } = await import("../src/pipeline");
const { handleCallback } = await import("../src/handlers/callbacks");
const { loadSettings } = await import("../src/settings");

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

function fakeTelegram() {
  const sent: string[] = [];
  const edits: string[] = [];
  const alerts: string[] = [];
  let messageId = 0;
  return {
    sent,
    edits,
    alerts,
    client: {
      sendMessage: vi.fn(async (chatId: number, text: string) => {
        sent.push(text);
        return { message_id: ++messageId, chat: { id: chatId } };
      }),
      editMessage: vi.fn(async (_chatId: number, _id: number, text: string) => {
        edits.push(text);
      }),
      answerCallback: vi.fn(async (_id: string, text?: string) => {
        if (text) alerts.push(text);
      }),
      sendChatAction: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined),
      downloadFile: vi.fn(async () => ({
        body: new Response("audio"),
        name: "voice.ogg",
      })),
      sendDocument: vi.fn(async () => undefined),
    },
  };
}

const USER = 42;
const CHAT = 100;

let kv: FakeKV;
let env: Env;
let tg: ReturnType<typeof fakeTelegram>;

beforeEach(() => {
  kv = new FakeKV();
  env = {
    SETTINGS: kv,
    LLM_MODEL: "google/gemini-2.5-flash",
    VISION_MODEL: "google/gemini-2.5-flash",
    GROQ_API_KEY: "test",
  } as unknown as Env;
  tg = fakeTelegram();
  transcribe.mockClear();
  processTranscript.mockClear();
  readPhoto.mockClear();
  searchModels.mockClear();
});

const press = (data: string): TgCallbackQuery =>
  ({
    id: "cb1",
    from: { id: USER },
    data,
    message: { message_id: 1, chat: { id: CHAT } },
  }) as TgCallbackQuery;

const voiceMessage = () =>
  ({
    message_id: 7,
    chat: { id: CHAT },
    voice: { file_id: "AUDIO-1", duration: 12, file_size: 1000 },
  }) as never;

const photoMessage = () =>
  ({
    message_id: 8,
    chat: { id: CHAT },
    caption: "лише показники",
    photo: [{ file_id: "PHOTO-1", file_size: 2000 }],
  }) as never;

describe("повторний прогін голосового", () => {
  it("зміна стилю не платить за розпізнавання вдруге", async () => {
    await handleAudioMessage(env, tg.client as never, voiceMessage(), USER);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(processTranscript).toHaveBeenCalledTimes(1);

    await handleCallback(env, tg.client as never, press(`${PREFIX.redoStyle}formal`));

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(processTranscript).toHaveBeenCalledTimes(2);
    expect((await loadSettings(env, USER)).style).toBe("formal");
    // Другий раз обробляли той самий сирий текст.
    expect(processTranscript.mock.calls[1]?.[1]).toBe("ее сказане слово");
  });

  it("зміна моделі теж переробляє одразу, без нового аудіо", async () => {
    await handleAudioMessage(env, tg.client as never, voiceMessage(), USER);
    await handleCallback(env, tg.client as never, press(`${PREFIX.redoModel}openai/gpt-5`));

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(processTranscript).toHaveBeenCalledTimes(2);
    expect((await loadSettings(env, USER)).llmModel).toBe("openai/gpt-5");
    expect(processTranscript.mock.calls[1]?.[2]?.llmModel).toBe("openai/gpt-5");
  });

  it("«перерозпізнати» справді йде за аудіо знову", async () => {
    await handleAudioMessage(env, tg.client as never, voiceMessage(), USER);
    await handleCallback(env, tg.client as never, press(PREFIX.redoStt));

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(tg.client.downloadFile).toHaveBeenCalledTimes(2);
    expect(tg.client.downloadFile).toHaveBeenLastCalledWith("AUDIO-1");
  });

  it("невідомий стиль із застарілої кнопки нічого не переробляє", async () => {
    await handleAudioMessage(env, tg.client as never, voiceMessage(), USER);
    await handleCallback(env, tg.client as never, press(`${PREFIX.redoStyle}видалений`));

    expect(processTranscript).toHaveBeenCalledTimes(1);
  });

  it("без збереженого прогону кнопка чесно каже, що переробляти нічого", async () => {
    await handleCallback(env, tg.client as never, press(`${PREFIX.redoModel}openai/gpt-5`));

    expect(processTranscript).not.toHaveBeenCalled();
    expect(tg.alerts.at(-1)).toContain("Немає чого переробляти");
  });
});

describe("повторний прогін фото", () => {
  it("інша модель перечитує той самий знімок із тим самим підписом", async () => {
    await handlePhotoMessage(env, tg.client as never, photoMessage(), USER);
    expect(readPhoto).toHaveBeenCalledTimes(1);

    await handleCallback(
      env,
      tg.client as never,
      press(`${PREFIX.redoVision}google/gemini-2.5-pro`),
    );

    expect(readPhoto).toHaveBeenCalledTimes(2);
    expect(tg.client.downloadFile).toHaveBeenLastCalledWith("PHOTO-1");
    expect((await loadSettings(env, USER)).visionModel).toBe("google/gemini-2.5-pro");
    expect(readPhoto.mock.calls[1]?.[2]?.visionModel).toBe("google/gemini-2.5-pro");
    expect(readPhoto.mock.calls[1]?.[3]).toBe("лише показники");
  });

  it("«перерозпізнати» до знімка не застосовується", async () => {
    await handlePhotoMessage(env, tg.client as never, photoMessage(), USER);
    await handleCallback(env, tg.client as never, press(PREFIX.redoStt));

    expect(readPhoto).toHaveBeenCalledTimes(1);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
