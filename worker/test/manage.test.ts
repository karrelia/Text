import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { buildManagePrompt } from "../src/prompts";
import {
  listReminders,
  manageIntent,
  parseManageReply,
  planChange,
  saveReminder,
  takeDeleted,
} from "../src/reminders";

const complete = vi.hoisted(() => vi.fn(async () => '{"action":"delete","index":1}'));

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  complete,
}));

const { handleSpoken } = await import("../src/pipeline");

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
const NOW = new Date("2026-08-16T06:00:00Z");
const SOON = Date.now() + 3_600_000;
const LATER = Date.now() + 7_200_000;

let env: Env;
let tg: ReturnType<typeof fakeTelegram>;

beforeEach(() => {
  env = {
    SETTINGS: new FakeKV(),
    TIMEZONE: "Europe/Kyiv",
    LLM_MODEL: "google/gemini-2.5-flash",
  } as unknown as Env;
  tg = fakeTelegram();
  complete.mockReset();
  complete.mockResolvedValue('{"action":"delete","index":1}');
});

const user = { llmModel: "google/gemini-2.5-flash" } as never;

const говорить = (text: string) => handleSpoken(env, tg.client as never, CHAT, USER, text);

// Найнебезпечніше місце: сплутати «прибери нагадування» зі створенням
// нагадування «прибрати». Ціна помилки — знищений запис.
describe("намір керувати, а не створювати", () => {
  it("наказ прибрати — це керування", () => {
    expect(manageIntent("прибери нагадування про показники")).toBe("change");
    expect(manageIntent("скасуй нагадування про нараду")).toBe("change");
    expect(manageIntent("видали нагадування")).toBe("change");
  });

  it("наказ перенести — теж керування", () => {
    expect(manageIntent("перенеси нагадування про звіт на четвер")).toBe("change");
    expect(manageIntent("відклади нагадування про акт на понеділок")).toBe("change");
  });

  // Жива мова частіше каже «давай перенесемо», ніж «перенеси». Перша версія
  // знала лише наказ і на цій фразі мовчала.
  it("«давай перенесемо» — те саме прохання", () => {
    expect(manageIntent("Давай перенесемо нагадування про виконком на 8:40.")).toBe(
      "change",
    );
    expect(manageIntent("давай приберемо нагадування про звіт")).toBe("change");
    expect(manageIntent("скасуємо нагадування про нараду")).toBe("change");
  });

  it("інфінітив після «треба» чи «хочу» теж рахується", () => {
    expect(manageIntent("треба прибрати нагадування про показники")).toBe("change");
    expect(manageIntent("хочу перенести нагадування про звіт на п'ятницю")).toBe("change");
    expect(manageIntent("можеш видалити нагадування про акт")).toBe("change");
  });

  // Найнебезпечніша пара: обидві фрази містять «прибрати» й «нагадування»,
  // але одна створює запис, а друга знищує.
  it("«постав нагадування прибрати» лишається створенням", () => {
    expect(manageIntent("постав нагадування прибрати сміття")).toBe("none");
    expect(manageIntent("треба поставити нагадування прибрати сміття")).toBe("none");
    expect(manageIntent("давай додамо нагадування перенести нараду")).toBe("none");
  });

  // «Нагадай прибрати сміття» — це нове нагадування, а не видалення.
  // Інфінітив у завданні не має переважити наказ у проханні.
  it("інфінітив усередині завдання нічого не видаляє", () => {
    expect(manageIntent("нагадай прибрати сміття завтра")).toBe("none");
    expect(manageIntent("нагадай перенести нараду на четвер")).toBe("none");
    expect(manageIntent("нагадай скасувати підписку")).toBe("none");
  });

  it("створення лишається створенням", () => {
    expect(manageIntent("нагадай завтра о 9 здати звіт")).toBe("none");
    expect(manageIntent("додай нагадування через годину")).toBe("none");
  });

  it("прохання показати — це перелік", () => {
    expect(manageIntent("покажи нагадування")).toBe("list");
    expect(manageIntent("які в мене нагадування")).toBe("list");
  });

  it("текст без нагадувань не чіпається", () => {
    expect(manageIntent("прибери зі столу папери")).toBe("none");
    expect(manageIntent("перенеси нараду на четвер")).toBe("none");
    expect(manageIntent("")).toBe("none");
  });
});

describe("розбір відповіді моделі", () => {
  it("читає видалення", () => {
    expect(parseManageReply('{"action":"delete","index":2}', 3)).toEqual({
      action: "delete",
      index: 1,
    });
  });

  it("номер поза списком не приймається", () => {
    expect(() => parseManageReply('{"action":"delete","index":9}', 3)).toThrow();
    expect(() => parseManageReply('{"action":"delete","index":0}', 3)).toThrow();
  });

  it("невідома дія відхиляється", () => {
    expect(() => parseManageReply('{"action":"burn","index":1}', 3)).toThrow();
  });

  it("сумнів моделі доходить до людини", () => {
    expect(() => parseManageReply('{"error":"підходить два нагадування"}', 3)).toThrow(
      "підходить два нагадування",
    );
  });
});

// «Перенеси на 8:40» означає той самий день, а не сьогоднішній: переносять
// зазвичай усередині дня, на який нагадування й стояло.
describe("година без дати", () => {
  it("промпт велить брати дату самого нагадування", () => {
    const prompt = buildManagePrompt("2026-08-16 09:00", "неділя", [
      "26.08.2026, 08:30 — виконком",
    ]);
    expect(prompt).toContain("бери дату того нагадування");
    expect(prompt).toContain("26.08.2026, 08:30 — виконком");
  });

  it("список подається пронумерованим", () => {
    const prompt = buildManagePrompt("2026-08-16 09:00", "неділя", ["перше", "друге"]);
    expect(prompt).toContain("1. перше");
    expect(prompt).toContain("2. друге");
  });
});

describe("перенесення", () => {
  it("час розбирається в майбутнє", async () => {
    complete.mockResolvedValue('{"action":"move","index":1,"when":"2036-08-20 09:00"}');
    const reminders = [
      { key: "k", userId: USER, chatId: CHAT, text: "звіт", dueAt: SOON },
    ] as never;

    const change = await planChange(env, user, "перенеси на 20-те", reminders, NOW);
    expect(change.action).toBe("move");
    expect(change.dueAt).toBeGreaterThan(Date.now());
  });

  it("минулий час відхиляється", async () => {
    complete.mockResolvedValue('{"action":"move","index":1,"when":"2020-01-01 09:00"}');
    const reminders = [
      { key: "k", userId: USER, chatId: CHAT, text: "звіт", dueAt: SOON },
    ] as never;

    await expect(planChange(env, user, "перенеси", reminders, NOW)).rejects.toThrow("минув");
  });

  it("без часу переносити нікуди", async () => {
    complete.mockResolvedValue('{"action":"move","index":1}');
    const reminders = [
      { key: "k", userId: USER, chatId: CHAT, text: "звіт", dueAt: SOON },
    ] as never;

    await expect(planChange(env, user, "перенеси", reminders, NOW)).rejects.toThrow(
      "на коли",
    );
  });
});

describe("голосом із кінця в кінець", () => {
  beforeEach(async () => {
    await saveReminder(env, USER, CHAT, "передати показники", SOON);
    await saveReminder(env, USER, CHAT, "здати звіт", LATER);
  });

  it("прибирає назване нагадування", async () => {
    complete.mockResolvedValue('{"action":"delete","index":1}');

    expect(await говорить("прибери нагадування про показники")).toBe(true);
    const left = await listReminders(env, USER);
    expect(left.map((item) => item.text)).toEqual(["здати звіт"]);
    expect(tg.sent.at(-1)).toContain("Прибрав");
  });

  // Голосом промахнутись легше, ніж пальцем, тож відкат тут потрібніший.
  it("прибране можна повернути", async () => {
    complete.mockResolvedValue('{"action":"delete","index":1}');
    await говорить("прибери нагадування про показники");

    const stashed = await takeDeleted(env, USER);
    expect(stashed?.text).toBe("передати показники");
  });

  it("переносить і зберігає текст", async () => {
    complete.mockResolvedValue('{"action":"move","index":2,"when":"2036-09-01 09:00"}');

    expect(await говорить("перенеси нагадування про звіт на вересень")).toBe(true);
    const left = await listReminders(env, USER);
    expect(left.map((item) => item.text).sort()).toEqual([
      "здати звіт",
      "передати показники",
    ]);
    expect(tg.sent.at(-1)).toContain("Перенесено");
  });

  it("повтор переживає перенесення", async () => {
    await saveReminder(env, USER, CHAT, "показники щомісяця", LATER + 1000, {
      every: 1,
      unit: "month",
    });
    complete.mockResolvedValue('{"action":"move","index":3,"when":"2036-09-01 09:00"}');

    await говорить("перенеси нагадування про показники щомісяця");
    const moved = (await listReminders(env, USER)).find(
      (item) => item.text === "показники щомісяця",
    );
    expect(moved?.repeat).toEqual({ every: 1, unit: "month" });
  });

  it("перелік показується без звернення до моделі", async () => {
    expect(await говорить("покажи нагадування")).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(tg.sent.at(-1)).toContain("передати показники");
  });

  // Саме та фраза, на якій це вперше не спрацювало.
  it("«давай перенесемо нагадування про виконком на 8:40» доходить до моделі", async () => {
    complete.mockResolvedValue('{"action":"move","index":1,"when":"2036-08-26 08:40"}');

    expect(await говорить("Давай перенесемо нагадування про виконком на 8:40.")).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(tg.sent.at(-1)).toContain("Перенесено");
  });

  it("сумнів моделі не призводить до втрати запису", async () => {
    complete.mockResolvedValue('{"error":"підходить два нагадування"}');

    expect(await говорить("прибери нагадування")).toBe(true);
    expect(await listReminders(env, USER)).toHaveLength(2);
    expect(tg.sent.at(-1)).toContain("підходить два нагадування");
  });
});

describe("межові випадки", () => {
  it("без жодного нагадування бот просто каже про це", async () => {
    expect(await говорить("прибери нагадування про звіт")).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(tg.sent.at(-1)).toContain("міняти нічого");
  });

  // Один вимикач на все, що бот робить із нагадуваннями без команди.
  it("вимкнений autoremind зупиняє й керування", async () => {
    await saveReminder(env, USER, CHAT, "звіт", SOON);
    await env.SETTINGS.put(`user:${USER}`, JSON.stringify({ autoRemind: false }));

    expect(await говорить("прибери нагадування про звіт")).toBe(false);
    expect(await listReminders(env, USER)).toHaveLength(1);
  });
});
