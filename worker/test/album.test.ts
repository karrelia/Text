import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AlbumPage, addPage, gather } from "../src/album";
import type { Env } from "../src/env";
import { buildPhotoSystemPrompt } from "../src/prompts";

const readPhoto = vi.hoisted(() =>
  vi.fn(
    async (
      _env: unknown,
      _images: { mimeType: string }[],
      _user: unknown,
      _instruction: string,
    ) => "Зчитано з фото",
  ),
);

vi.mock("../src/vision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/vision")>()),
  readPhoto,
}));

const { handlePhotoMessage } = await import("../src/pipeline");

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

  async list(options: { prefix?: string; limit?: number } = {}) {
    const prefix = options.prefix ?? "";
    const keys = [...this.data.keys()]
      .filter((key) => key.startsWith(prefix))
      // KV віддає ключі лексикографічно — на цьому тримається порядок сторінок.
      .sort()
      .slice(0, options.limit ?? 1000)
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

function fakeTelegram() {
  let messageId = 0;
  return {
    sendMessage: vi.fn(async (chatId: number) => ({
      message_id: ++messageId,
      chat: { id: chatId },
    })),
    editMessage: vi.fn(async () => undefined),
    sendChatAction: vi.fn(async () => undefined),
    sendDocument: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    downloadFile: vi.fn(async (fileId: string) => ({
      body: new Response(fileId),
      name: `${fileId}.jpg`,
    })),
  };
}

const USER = 42;
const CHAT = 100;

let env: Env;
let tg: ReturnType<typeof fakeTelegram>;

beforeEach(() => {
  env = {
    SETTINGS: new FakeKV(),
    VISION_MODEL: "google/gemini-2.5-flash",
    LLM_MODEL: "google/gemini-2.5-flash",
    TIMEZONE: "Europe/Kyiv",
  } as unknown as Env;
  tg = fakeTelegram();
  readPhoto.mockClear();
});

const page = (fileId: string, messageId: number, caption = ""): AlbumPage => ({
  fileId,
  mimeType: "image/jpeg",
  caption,
  messageId,
});

const photoUpdate = (fileId: string, messageId: number, group?: string, caption = "") =>
  ({
    message_id: messageId,
    chat: { id: CHAT },
    caption,
    ...(group ? { media_group_id: group } : {}),
    photo: [{ file_id: fileId, file_size: 2000 }],
  }) as never;

describe("збирання альбому", () => {
  it("сторінки лягають у порядку надсилання, а не приходу", async () => {
    await addPage(env, USER, "g1", page("B", 11));
    await addPage(env, USER, "g1", page("A", 10));
    await addPage(env, USER, "g1", page("C", 12));

    const pages = await gather(env, USER, "g1", "A", 0);
    expect(pages!.map((item) => item.fileId)).toEqual(["A", "B", "C"]);
  });

  // Спільний список довелося б читати й писати назад, і три одночасні
  // запити затерли б сторінки одне одного — атомарного дописування KV немає.
  it("одночасні сторінки не затирають одна одну", async () => {
    await Promise.all([
      addPage(env, USER, "g1", page("A", 10)),
      addPage(env, USER, "g1", page("B", 11)),
      addPage(env, USER, "g1", page("C", 12)),
    ]);

    const pages = await gather(env, USER, "g1", "A", 0);
    expect(pages).toHaveLength(3);
  });

  it("повторне оновлення не дублює сторінку", async () => {
    await addPage(env, USER, "g1", page("A", 10));
    await addPage(env, USER, "g1", page("A", 10));

    expect(await gather(env, USER, "g1", "A", 0)).toHaveLength(1);
  });

  // Ведучого визначає сам список, а не гонитва за блокуванням: інакше два
  // запити, що почались одночасно, прочитали б альбом двічі.
  it("читає альбом рівно один запит", async () => {
    await addPage(env, USER, "g1", page("A", 10));
    await addPage(env, USER, "g1", page("B", 11));

    const [first, second] = await Promise.all([
      gather(env, USER, "g1", "A", 0),
      gather(env, USER, "g1", "B", 0),
    ]);

    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.map((item) => item.fileId)).toEqual(["A", "B"]);
  });

  it("прибирає альбом за собою", async () => {
    await addPage(env, USER, "g1", page("A", 10));
    expect(await gather(env, USER, "g1", "A", 0)).not.toBeNull();
    expect(await gather(env, USER, "g1", "A", 0)).toBeNull();
  });

  it("альбоми різних людей не перетинаються", async () => {
    await addPage(env, USER, "g1", page("A", 10));
    await addPage(env, 77, "g1", page("Z", 10));

    const mine = await gather(env, USER, "g1", "A", 0);
    expect(mine!.map((item) => item.fileId)).toEqual(["A"]);
  });
});

describe("альбом як один документ", () => {
  // Чекання вимикаємо, інакше кожен тест простоював би півтори секунди.
  beforeEach(() => {
    (env as { ALBUM_WAIT_MS?: string }).ALBUM_WAIT_MS = "0";
  });

  const send = (fileId: string, messageId: number, group?: string, caption = "") =>
    handlePhotoMessage(env, tg as never, photoUpdate(fileId, messageId, group, caption), USER);

  it("три сторінки читаються одним запитом до моделі", async () => {
    await Promise.all([
      send("P1", 10, "g1"),
      send("P2", 11, "g1"),
      send("P3", 12, "g1", "лише показники"),
    ]);

    expect(readPhoto).toHaveBeenCalledTimes(1);
    expect(readPhoto.mock.calls[0]?.[1]).toHaveLength(3);
    expect(tg.downloadFile.mock.calls.map((call) => call[0])).toEqual(["P1", "P2", "P3"]);
  });

  // Telegram чіпляє підпис лише до одного знімка альбому — і це не
  // обов'язково перший.
  it("підпис із будь-якої сторінки стає вказівкою до всього документа", async () => {
    await Promise.all([send("P1", 10, "g1"), send("P2", 11, "g1", "зроби таблицею")]);

    expect(readPhoto.mock.calls[0]?.[3]).toContain("зроби таблицею");
  });

  it("одиночний знімок обробляється без чекання", async () => {
    await send("SOLO", 5);

    expect(readPhoto).toHaveBeenCalledTimes(1);
    expect(readPhoto.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it("два різні альбоми не змішуються", async () => {
    await Promise.all([send("A1", 10, "g1"), send("A2", 11, "g1")]);
    await Promise.all([send("B1", 20, "g2"), send("B2", 21, "g2")]);

    expect(readPhoto).toHaveBeenCalledTimes(2);
    expect(readPhoto.mock.calls[1]?.[1]).toHaveLength(2);
  });
});

describe("промпт для кількох сторінок", () => {
  it("пояснює моделі, що це один документ", () => {
    const prompt = buildPhotoSystemPrompt("", "", 3);
    expect(prompt).toContain("Знімків 3");
    expect(prompt).toContain("одне ціле");
  });

  it("для одного знімка нічого зайвого не додає", () => {
    expect(buildPhotoSystemPrompt("", "", 1)).not.toContain("одне ціле");
    expect(buildPhotoSystemPrompt()).not.toContain("одне ціле");
  });
});
