import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { buildCommandPrompt } from "../src/prompts";
import { VOICE_COMMANDS, commandIntent, parseCommandReply } from "../src/voice";

const complete = vi.hoisted(() =>
  vi.fn(
    async (
      _env: unknown,
      _model: string,
      _messages: { content: string }[],
      _temperature: number,
    ) => '{"command":"glossary","args":"+ Кірпосенко"}',
  ),
);

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  complete,
}));

const { handleSpoken } = await import("../src/pipeline");
const { loadSettings } = await import("../src/settings");
const { listReminders } = await import("../src/reminders");

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
      .sort()
      .slice(0, options.limit ?? 1000)
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

function fakeTelegram() {
  const sent: string[] = [];
  return {
    sent,
    client: {
      sendMessage: vi.fn(async (chatId: number, text: string) => {
        sent.push(text);
        return { message_id: 1, chat: { id: chatId } };
      }),
      editMessage: vi.fn(async () => undefined),
      answerCallback: vi.fn(async () => undefined),
      sendChatAction: vi.fn(async () => undefined),
    },
  };
}

const USER = 42;
const CHAT = 100;

let env: Env;
let tg: ReturnType<typeof fakeTelegram>;

beforeEach(() => {
  env = {
    SETTINGS: new FakeKV(),
    LLM_MODEL: "google/gemini-2.5-flash",
    TIMEZONE: "Europe/Kyiv",
  } as unknown as Env;
  tg = fakeTelegram();
  complete.mockReset();
  complete.mockResolvedValue('{"command":"glossary","args":"+ Кірпосенко"}');
});

const говорить = (text: string) => handleSpoken(env, tg.client as never, CHAT, USER, text);

// Перевірка йде на кожному записі, тож вона має бути дешевою й тихою:
// потрібні обидві половини — предмет і дія.
describe("коли сказане є командою", () => {
  it("предмет плюс дія — це команда", () => {
    expect(commandIntent("додай в довідник Кірпосенко")).toBe("glossary");
    expect(commandIntent("покажи витрати")).toBe("expenses");
    expect(commandIntent("яка завтра погода")).toBe("weather");
    expect(commandIntent("зміни стиль")).toBe("style");
  });

  it("сам предмет без дії — ще не звертання", () => {
    expect(commandIntent("у нас змінилася модель насоса")).toBeNull();
    expect(commandIntent("погода сьогодні гарна")).toBeNull();
  });

  it("сама дія без предмета теж ні", () => {
    expect(commandIntent("додай два кубометри")).toBeNull();
    expect(commandIntent("покажи мені дорогу")).toBeNull();
  });

  it("звичайна нотатка не чіпається", () => {
    expect(commandIntent("перевірити показники по вулиці Озерна")).toBeNull();
    expect(commandIntent("")).toBeNull();
  });
});

describe("розбір відповіді моделі", () => {
  it("читає команду й аргумент", () => {
    expect(parseCommandReply('{"command":"glossary","args":"+ Кірпосенко"}')).toEqual({
      command: "glossary",
      args: "+ Кірпосенко",
    });
  });

  it("без аргументу — порожній рядок", () => {
    expect(parseCommandReply('{"command":"settings"}').args).toBe("");
  });

  // Модель цілком може повернути команду, якої їй не пропонували, — і
  // «reset» стер би всі налаштування без вороття.
  it("команда поза переліком відхиляється", () => {
    expect(() => parseCommandReply('{"command":"reset"}')).toThrow();
    expect(() => parseCommandReply('{"command":"deleteEverything"}')).toThrow();
  });

  it("скидання немає навіть у переліку дозволених", () => {
    expect(Object.hasOwn(VOICE_COMMANDS, "reset")).toBe(false);
  });

  it("сміття не ламає розбір", () => {
    expect(() => parseCommandReply("не зрозумів")).toThrow();
  });

  it("сумнів моделі доходить до людини", () => {
    expect(() => parseCommandReply('{"error":"не зрозумів про що це"}')).toThrow(
      "не зрозумів про що це",
    );
  });
});

describe("виконання голосом", () => {
  it("«додай в довідник Кірпосенко» справді дописує в словник", async () => {
    expect(await говорить("додай в довідник Кірпосенко")).toBe(true);
    expect((await loadSettings(env, USER)).glossary).toBe("Кірпосенко");
  });

  it("дописує, не затираючи наявного", async () => {
    await env.SETTINGS.put(`user:${USER}`, JSON.stringify({ glossary: "Миргород" }));

    await говорить("додай в довідник Кірпосенко");
    expect((await loadSettings(env, USER)).glossary).toBe("Миргород, Кірпосенко");
  });

  it("показує, яку саме команду виконав", async () => {
    await говорить("додай в довідник Кірпосенко");
    expect(tg.sent[0]).toContain("/glossary");
  });

  it("незрозуміле прохання не мовчить", async () => {
    complete.mockResolvedValue('{"error":"не зрозумів про що це"}');

    expect(await говорить("покажи довідник задом наперед")).toBe(true);
    expect(tg.sent.at(-1)).toContain("не зрозумів про що це");
  });

  // /autoremind керує нагадуваннями, а не тим, чи слухати бота взагалі.
  it("вимкнений autoremind команди не глушить", async () => {
    await env.SETTINGS.put(`user:${USER}`, JSON.stringify({ autoRemind: false }));

    expect(await говорить("додай в довідник Кірпосенко")).toBe(true);
    expect((await loadSettings(env, USER)).glossary).toBe("Кірпосенко");
  });
});

// Порядок гілок важливий: «додай нагадування» містить «додай», а «покажи
// покупки» — «покажи». Обидві мають лишитись у своїх, докладніших гілках.
describe("межа з нагадуваннями й списками", () => {
  it("прохання нагадати не стає командою", async () => {
    complete.mockResolvedValue('{"when":"2036-09-01 09:00","what":"здати звіт"}');

    await говорить("нагадай першого вересня здати звіт");
    const messages = complete.mock.calls[0]?.[2] ?? [];
    expect(messages[0]?.content).toContain("нагадування");
    expect(await listReminders(env, USER)).toHaveLength(1);
  });

  it("прохання про список не стає командою", async () => {
    complete.mockResolvedValue('{"action":"add","list":"покупки","items":["молоко"]}');

    await говорить("додай до покупок молоко");
    const messages = complete.mock.calls[0]?.[2] ?? [];
    expect(messages[0]?.content).toContain("побутові списки");
  });

  it("«покажи нагадування» лишається переліком нагадувань", async () => {
    await говорить("покажи нагадування");
    // Перелік показується без звернення до моделі взагалі.
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("промпт команд", () => {
  it("перелічує дозволені команди з підказками", () => {
    const prompt = buildCommandPrompt(VOICE_COMMANDS);
    expect(prompt).toContain("glossary — аргумент:");
    expect(prompt).toContain("weather — аргумент:");
  });

  it("прямо забороняє вигадувати скидання", () => {
    expect(buildCommandPrompt(VOICE_COMMANDS)).toContain("Ніколи не вигадуй команду скидання");
  });

  it("вимагає прибирати службові слова з аргументу", () => {
    expect(buildCommandPrompt(VOICE_COMMANDS)).toContain("без слів «додай» і «довідник»");
  });
});
