import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import {
  CATEGORIES,
  expensesToCsv,
  loadMonth,
  looksLikeReceipt,
  monthOf,
  parseReceiptReply,
  saveExpense,
  summarize,
} from "../src/expenses";
import { PREFIX, photoResultKeyboard } from "../src/keyboards";
import type { TgCallbackQuery } from "../src/telegram";

const complete = vi.hoisted(() =>
  vi.fn(
    async (
      _env: unknown,
      _model: string,
      _messages: { content: string }[],
      _temperature: number,
    ) => '{"merchant":"АТБ","total":347.52,"category":"продукти"}',
  ),
);

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  complete,
}));

const { handleCallback } = await import("../src/handlers/callbacks");
const { saveLastDocument } = await import("../src/settings");

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
  const files: string[] = [];
  return {
    sent,
    files,
    client: {
      sendMessage: vi.fn(async (chatId: number, text: string) => {
        sent.push(text);
        return { message_id: 1, chat: { id: chatId } };
      }),
      editMessage: vi.fn(async () => undefined),
      answerCallback: vi.fn(async () => undefined),
      sendChatAction: vi.fn(async () => undefined),
      sendDocument: vi.fn(async (_chatId: number, name: string, content: string) => {
        files.push(`${name}\n${content}`);
      }),
    },
  };
}

const USER = 42;
const CHAT = 100;
const MONTH = "2026-08";

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
  complete.mockResolvedValue('{"merchant":"АТБ","total":347.52,"category":"продукти"}');
});

const press = (data: string): TgCallbackQuery =>
  ({
    id: "cb",
    from: { id: USER },
    data,
    message: { message_id: 5, chat: { id: CHAT } },
  }) as TgCallbackQuery;

// Кнопка має з'являтись під чеком, а не під кожним актом чи накладною.
describe("чи це схоже на чек", () => {
  it("сума на знімку — привід показати кнопку", () => {
    expect(looksLikeReceipt("АТБ\nРазом: 347.52 грн")).toBe(true);
    expect(looksLikeReceipt("До сплати 120,00")).toBe(true);
    expect(looksLikeReceipt("TOTAL 45.00 UAH")).toBe(true);
  });

  it("акт обстеження чеком не вважається", () => {
    expect(looksLikeReceipt("АКТ обстеження\nЛічильник № 40538909")).toBe(false);
  });

  it("кнопка з'являється лише під чеком", () => {
    const withReceipt = photoResultKeyboard("csv", "", "🧾 У витрати").inline_keyboard.flat();
    const without = photoResultKeyboard("csv").inline_keyboard.flat();

    expect(withReceipt.some((button) => button.callback_data === PREFIX.expenseAdd)).toBe(true);
    expect(without.some((button) => button.callback_data === PREFIX.expenseAdd)).toBe(false);
  });
});

describe("розбір чека", () => {
  it("читає магазин, суму й категорію", () => {
    const receipt = parseReceiptReply('{"merchant":"АТБ","total":347.52,"category":"продукти"}');
    expect(receipt).toEqual({ merchant: "АТБ", total: 347.52, category: "продукти" });
  });

  it("невідома категорія стає «інше»", () => {
    expect(parseReceiptReply('{"merchant":"X","total":10,"category":"космос"}').category).toBe(
      "інше",
    );
  });

  // Вигадана сума в обліку гірша за незаписаний чек: її ніхто не помітить.
  it("без суми чек не записується", () => {
    expect(() => parseReceiptReply('{"merchant":"АТБ","category":"продукти"}')).toThrow();
    expect(() => parseReceiptReply('{"merchant":"АТБ","total":0}')).toThrow();
    expect(() => parseReceiptReply('{"merchant":"АТБ","total":"багато"}')).toThrow();
  });

  it("копійки не губляться", () => {
    expect(parseReceiptReply('{"merchant":"X","total":10.005,"category":"інше"}').total).toBe(
      10.01,
    );
  });

  it("сумнів моделі доходить до людини", () => {
    expect(() => parseReceiptReply('{"error":"це не чек"}')).toThrow("це не чек");
  });

  it("усі категорії перекладені", () => {
    expect(CATEGORIES).toContain("продукти");
    expect(CATEGORIES).toContain("інше");
  });
});

describe("підсумок місяця", () => {
  it("групує за категоріями, найбільші згори", async () => {
    await saveExpense(env, USER, MONTH, { merchant: "АТБ", total: 300, category: "продукти" });
    await saveExpense(env, USER, MONTH, { merchant: "Кава", total: 60, category: "кафе" });
    await saveExpense(env, USER, MONTH, { merchant: "Сільпо", total: 200, category: "продукти" });

    const summary = summarize(await loadMonth(env, USER, MONTH));
    expect(summary.total).toBe(560);
    expect(summary.count).toBe(3);
    expect(summary.byCategory[0]).toEqual({ category: "продукти", total: 500 });
  });

  it("місяці не змішуються", async () => {
    await saveExpense(env, USER, MONTH, { merchant: "АТБ", total: 100, category: "продукти" });
    await saveExpense(env, USER, "2026-09", { merchant: "АТБ", total: 200, category: "продукти" });

    expect(summarize(await loadMonth(env, USER, MONTH)).total).toBe(100);
  });

  it("чужі витрати не видно", async () => {
    await saveExpense(env, USER, MONTH, { merchant: "АТБ", total: 100, category: "продукти" });
    expect(await loadMonth(env, 77, MONTH)).toHaveLength(0);
  });

  it("порожній місяць — це нулі, а не поломка", () => {
    expect(summarize([])).toEqual({ total: 0, count: 0, byCategory: [] });
  });

  it("місяць береться з дати", () => {
    expect(monthOf("2026-08-16")).toBe("2026-08");
  });
});

describe("вивантаження в таблицю", () => {
  it("має заголовки й крапку з комою", async () => {
    await saveExpense(env, USER, MONTH, { merchant: "АТБ", total: 347.52, category: "продукти" });
    const csv = expensesToCsv(await loadMonth(env, USER, MONTH), () => "16.08.2026, 12:00");

    expect(csv.split("\n")[0]).toBe("Дата;Магазин;Категорія;Сума");
    expect(csv).toContain("АТБ;продукти;347.52");
  });

  // Крапка з комою в назві магазину інакше зсунула б цілу колонку.
  it("назва з крапкою з комою береться в лапки", () => {
    const csv = expensesToCsv(
      [{ key: "k", at: 0, merchant: "АТБ; маркет", total: 10, category: "інше" }],
      () => "дата",
    );
    expect(csv).toContain('"АТБ; маркет"');
  });
});

describe("кнопка «у витрати»", () => {
  it("записує чек і показує підсумок місяця", async () => {
    await saveLastDocument(env, USER, "АТБ\nРазом: 347.52 грн");

    await handleCallback(env, tg.client as never, press(PREFIX.expenseAdd));

    expect(complete).toHaveBeenCalledTimes(1);
    expect(tg.sent.at(-1)).toContain("АТБ");
    expect(tg.sent.at(-1)).toContain("347.52");
  });

  // Розбираємо вже зчитаний текст: другий виклик із зображенням коштував би
  // вдесятеро дорожче й нічого б не додав.
  it("знімок удруге не читається", async () => {
    await saveLastDocument(env, USER, "АТБ\nРазом: 347.52 грн");
    await handleCallback(env, tg.client as never, press(PREFIX.expenseAdd));

    const messages = complete.mock.calls[0]?.[2] ?? [];
    expect(messages[1]?.content).toContain("347.52");
    expect(JSON.stringify(messages)).not.toContain("image_url");
  });

  it("без зчитаного нічого не записує", async () => {
    await handleCallback(env, tg.client as never, press(PREFIX.expenseAdd));
    expect(complete).not.toHaveBeenCalled();
  });

  it("невдалий розбір не мовчить", async () => {
    await saveLastDocument(env, USER, "щось незрозуміле");
    complete.mockResolvedValue('{"error":"це не чек"}');

    await handleCallback(env, tg.client as never, press(PREFIX.expenseAdd));
    expect(tg.sent.at(-1)).toContain("це не чек");
  });
});
