import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { CALLBACK_LIMIT, PREFIX, listKeyboard } from "../src/keyboards";
import {
  DEFAULT_LIST,
  addItems,
  clearList,
  itemTail,
  listId,
  listNames,
  loadList,
  mentionsList,
  parseListReply,
  removeItems,
} from "../src/lists";
import type { TgCallbackQuery } from "../src/telegram";

const complete = vi.hoisted(() =>
  vi.fn(
    async (
      _env: unknown,
      _model: string,
      _messages: { content: string }[],
      _temperature: number,
    ) => '{"action":"add","list":"покупки","items":["молоко"]}',
  ),
);

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  complete,
}));

const { maybeRemind } = await import("../src/pipeline");
const { handleCallback } = await import("../src/handlers/callbacks");

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
  const edits: string[] = [];
  return {
    sent,
    edits,
    client: {
      sendMessage: vi.fn(async (chatId: number, text: string) => {
        sent.push(text);
        return { message_id: 1, chat: { id: chatId } };
      }),
      editMessage: vi.fn(async (_chatId: number, _id: number, text: string) => {
        edits.push(text);
      }),
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
  complete.mockResolvedValue('{"action":"add","list":"покупки","items":["молоко"]}');
});

const говорить = (text: string) => maybeRemind(env, tg.client as never, CHAT, USER, text);

const press = (data: string): TgCallbackQuery =>
  ({
    id: "cb",
    from: { id: USER },
    data,
    message: { message_id: 5, chat: { id: CHAT } },
  }) as TgCallbackQuery;

// Без назви списку «купив молоко» не відрізнити від звичайної нотатки, а
// викреслювати за здогадкою — найгірше, що можна зробити зі списком.
describe("коли це про список", () => {
  it("назва списку в будь-якому відмінку", () => {
    expect(mentionsList("додай до покупок молоко")).toBe(true);
    expect(mentionsList("що в покупках")).toBe(true);
    expect(mentionsList("запиши в справи подзвонити в банк")).toBe(true);
  });

  it("без назви списку не чіпаємо", () => {
    expect(mentionsList("купив молоко")).toBe(false);
    expect(mentionsList("перевірити показники по вулиці Озерна")).toBe(false);
  });

  // «Покупках» усередині слова не рахується — інакше будь-яке слово з
  // цими літерами вмикало б розбір.
  it("частина довшого слова не спрацьовує", () => {
    expect(mentionsList("покупкахтось")).toBe(false);
  });
});

describe("назви списків", () => {
  it("відмінки зводяться до одного списку", () => {
    expect(listId("покупок")).toBe("покупки");
    expect(listId("покупках")).toBe("покупки");
    expect(listId("закупи")).toBe("покупки");
  });

  it("незнайому назву лишаємо як є", () => {
    expect(listId("подарунки")).toBe("подарунки");
  });

  it("розділові знаки прибираються", () => {
    expect(listId("Покупки!")).toBe("покупки");
  });
});

describe("сховище списку", () => {
  // Кілька пунктів з однієї фрази лягають у ту саму мілісекунду, і без
  // зсуву порядок визначала б випадкова сіль у ключі — тобто щоразу інший.
  it("додає й читає в порядку додавання", async () => {
    await addItems(env, USER, "покупки", ["молоко", "хліб", "цукор", "кава"]);
    const items = await loadList(env, USER, "покупки");
    expect(items.map((item) => item.text)).toEqual(["молоко", "хліб", "цукор", "кава"]);
  });

  it("те саме двічі не додається", async () => {
    await addItems(env, USER, "покупки", ["молоко"]);
    const added = await addItems(env, USER, "покупки", ["Молоко"]);
    expect(added).toEqual([]);
    expect(await loadList(env, USER, "покупки")).toHaveLength(1);
  });

  // Людина каже «купив молоко», а в списку записано «молоко 2 л».
  it("викреслює за частиною назви", async () => {
    await addItems(env, USER, "покупки", ["молоко 2 л", "хліб"]);
    const removed = await removeItems(env, USER, "покупки", ["молоко"]);

    expect(removed).toEqual(["молоко 2 л"]);
    expect((await loadList(env, USER, "покупки")).map((item) => item.text)).toEqual(["хліб"]);
  });

  it("чого немає — не викреслює", async () => {
    await addItems(env, USER, "покупки", ["хліб"]);
    expect(await removeItems(env, USER, "покупки", ["кава"])).toEqual([]);
  });

  it("списки не перетинаються", async () => {
    await addItems(env, USER, "покупки", ["молоко"]);
    await addItems(env, USER, "справи", ["подзвонити"]);

    expect(await loadList(env, USER, "покупки")).toHaveLength(1);
    expect(await listNames(env, USER)).toEqual(["покупки", "справи"]);
  });

  it("чужий список не видно", async () => {
    await addItems(env, USER, "покупки", ["молоко"]);
    expect(await loadList(env, 77, "покупки")).toHaveLength(0);
  });

  it("очищення прибирає все", async () => {
    await addItems(env, USER, "покупки", ["молоко", "хліб"]);
    expect(await clearList(env, USER, "покупки")).toBe(2);
    expect(await loadList(env, USER, "покупки")).toHaveLength(0);
  });
});

describe("розбір прохання", () => {
  it("кілька речей стають кількома пунктами", () => {
    const plan = parseListReply(
      '{"action":"add","list":"покупки","items":["молоко","хліб","2 кг цукру"]}',
    );
    expect(plan.items).toHaveLength(3);
    expect(plan.list).toBe("покупки");
  });

  it("відмінок у відповіді моделі теж зводиться", () => {
    expect(parseListReply('{"action":"show","list":"покупках"}').list).toBe("покупки");
  });

  it("без назви списку береться типовий", () => {
    expect(parseListReply('{"action":"show"}').list).toBe(DEFAULT_LIST);
  });

  it("додавання без пунктів — це помилка, а не порожній запис", () => {
    expect(() => parseListReply('{"action":"add","list":"покупки","items":[]}')).toThrow();
  });

  it("сміття не ламає розбір", () => {
    expect(() => parseListReply("не зрозумів")).toThrow();
    expect(() => parseListReply('{"action":"burn","list":"покупки"}')).toThrow();
  });
});

describe("голосом із кінця в кінець", () => {
  it("додає назване", async () => {
    complete.mockResolvedValue(
      '{"action":"add","list":"покупки","items":["молоко","хліб"]}',
    );

    expect(await говорить("додай до покупок молоко і хліб")).toBe(true);
    expect((await loadList(env, USER, "покупки")).map((item) => item.text)).toEqual([
      "молоко",
      "хліб",
    ]);
  });

  it("показує список без змін", async () => {
    await addItems(env, USER, "покупки", ["молоко"]);
    complete.mockResolvedValue('{"action":"show","list":"покупки"}');

    await говорить("що в покупках");
    expect(tg.sent.at(-1)).toContain("молоко");
    expect(await loadList(env, USER, "покупки")).toHaveLength(1);
  });

  it("викреслює куплене", async () => {
    await addItems(env, USER, "покупки", ["молоко", "хліб"]);
    complete.mockResolvedValue('{"action":"done","list":"покупки","items":["молоко"]}');

    await говорить("купив молоко з покупок");
    expect((await loadList(env, USER, "покупки")).map((item) => item.text)).toEqual(["хліб"]);
  });

  it("порожній список не мовчить", async () => {
    complete.mockResolvedValue('{"action":"show","list":"покупки"}');

    await говорить("що в покупках");
    expect(tg.sent.at(-1)).toContain("порожній");
  });

  // Прохання нагадати не має потрапити в списки лише через слово «справи».
  it("нагадування лишається нагадуванням", async () => {
    expect(await говорить("нагадай завтра о 9 здати звіт")).toBe(true);
    expect(await listNames(env, USER)).toEqual([]);
  });
});

describe("кнопка викреслювання", () => {
  it("прибирає пункт і лишає решту", async () => {
    await addItems(env, USER, "покупки", ["молоко", "хліб"]);
    const items = await loadList(env, USER, "покупки");

    await handleCallback(
      env,
      tg.client as never,
      press(PREFIX.listCross + itemTail(items[0]!.key)),
    );

    expect((await loadList(env, USER, "покупки")).map((item) => item.text)).toEqual(["хліб"]);
    expect(tg.edits.at(-1)).toContain("хліб");
    expect(tg.edits.at(-1)).not.toContain("молоко");
  });

  it("чужий пункт не викреслиться", async () => {
    await addItems(env, 77, "покупки", ["чуже"]);
    const items = await loadList(env, 77, "покупки");

    await handleCallback(
      env,
      tg.client as never,
      press(PREFIX.listCross + itemTail(items[0]!.key)),
    );

    expect(await loadList(env, 77, "покупки")).toHaveLength(1);
  });

  it("кнопка вміщається в ліміт Telegram", async () => {
    await addItems(env, USER, "покупки", ["молоко"]);
    const items = await loadList(env, USER, "покупки");
    const data = PREFIX.listCross + itemTail(items[0]!.key);

    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(CALLBACK_LIMIT);
  });

  it("кнопки розкладаються по чотири в ряд", () => {
    const keyboard = listKeyboard(["покупки:1:a", "покупки:2:b", "покупки:3:c", "покупки:4:d", "покупки:5:e"]);
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(keyboard.inline_keyboard[0]).toHaveLength(4);
  });
});
