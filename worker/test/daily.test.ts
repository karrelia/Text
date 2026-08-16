import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ageOn,
  birthdaysOn,
  deleteBirthday,
  greetedToday,
  isGreetingTime,
  listBirthdays,
  parseBirthday,
  saveBirthday,
  weatherWord,
} from "../src/daily";
import type { Env } from "../src/env";

const tg = vi.hoisted(() => ({ sent: [] as string[] }));

vi.mock("../src/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/telegram")>();
  class FakeClient {
    async sendMessage(chatId: number, text: string) {
      tg.sent.push(text);
      return { message_id: 1, chat: { id: chatId } };
    }
  }
  return { ...actual, TelegramClient: FakeClient };
});

const { sendBirthdays } = await import("../src/index");

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

const USER = 42;
let env: Env;

beforeEach(() => {
  env = {
    SETTINGS: new FakeKV(),
    TIMEZONE: "Europe/Kyiv",
    ALLOWED_USER_IDS: String(USER),
  } as unknown as Env;
  tg.sent.length = 0;
});

describe("розбір дати народження", () => {
  it("числом", () => {
    expect(parseBirthday("31.12 Кириленко")).toEqual({ when: "12-31" });
    expect(parseBirthday("5/3 мама")).toEqual({ when: "03-05" });
  });

  it("з роком", () => {
    expect(parseBirthday("31.12.1980 батько")).toEqual({ when: "12-31", year: 1980 });
  });

  it("словом", () => {
    expect(parseBirthday("5 березня мама")).toEqual({ when: "03-05" });
    expect(parseBirthday("1 травня 1975 дід")).toEqual({ when: "05-01", year: 1975 });
  });

  it("неможливу дату не приймає", () => {
    expect(parseBirthday("45.99 хтось")).toBeNull();
    expect(parseBirthday("просто текст")).toBeNull();
  });
});

describe("сховище днів народження", () => {
  it("зберігається й читається", async () => {
    await saveBirthday(env, USER, "12-31", "Кириленко", 1980);
    const all = await listBirthdays(env, USER);

    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Кириленко");
    expect(all[0]?.when).toBe("12-31");
    expect(all[0]?.year).toBe(1980);
  });

  it("знаходиться за днем", async () => {
    await saveBirthday(env, USER, "12-31", "Кириленко");
    await saveBirthday(env, USER, "01-05", "мама");

    expect(await birthdaysOn(env, USER, "2026-12-31")).toHaveLength(1);
    expect(await birthdaysOn(env, USER, "2026-06-01")).toHaveLength(0);
  });

  it("чужі не видно", async () => {
    await saveBirthday(env, 77, "12-31", "чужий");
    expect(await listBirthdays(env, USER)).toHaveLength(0);
  });

  it("прибирається", async () => {
    await saveBirthday(env, USER, "12-31", "Кириленко");
    const [item] = await listBirthdays(env, USER);
    await deleteBirthday(env, item!.key);

    expect(await listBirthdays(env, USER)).toHaveLength(0);
  });

  it("вік рахується лише коли відомий рік", () => {
    expect(ageOn("2026-12-31", 1980)).toBe(46);
    expect(ageOn("2026-12-31")).toBeNull();
    expect(ageOn("2026-12-31", 2099)).toBeNull();
  });
});

// Cron ходить щохвилини — без позначки о дев'ятій прилетіло б шістдесят
// однакових вітань.
describe("вітання раз на день", () => {
  it("друге за той самий день не надсилається", async () => {
    expect(await greetedToday(env, USER, "2026-12-31")).toBe(false);
    expect(await greetedToday(env, USER, "2026-12-31")).toBe(true);
  });

  it("наступного дня знову можна", async () => {
    await greetedToday(env, USER, "2026-12-31");
    expect(await greetedToday(env, USER, "2027-01-01")).toBe(false);
  });

  it("вітаємо о дев'ятій рівно", () => {
    expect(isGreetingTime(9, 0)).toBe(true);
    expect(isGreetingTime(9, 1)).toBe(false);
    expect(isGreetingTime(8, 0)).toBe(false);
  });

  it("не о дев'ятій розсилка навіть не читає сховища", async () => {
    vi.setSystemTime(new Date("2026-12-31T05:30:00Z"));
    await saveBirthday(env, USER, "12-31", "Кириленко");

    expect(await sendBirthdays(env)).toBe(0);
    expect(tg.sent).toHaveLength(0);
    vi.useRealTimers();
  });

  it("о дев'ятій вітання приходить один раз", async () => {
    // 09:00 у Києві взимку — це 07:00 UTC.
    vi.setSystemTime(new Date("2026-12-31T07:00:00Z"));
    await saveBirthday(env, USER, "12-31", "Кириленко", 1980);

    expect(await sendBirthdays(env)).toBe(1);
    expect(tg.sent[0]).toContain("Кириленко");
    expect(tg.sent[0]).toContain("46");

    expect(await sendBirthdays(env)).toBe(0);
    expect(tg.sent).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe("опис погоди", () => {
  it("коди WMO перекладені", () => {
    expect(weatherWord(0)).toBe("ясно");
    expect(weatherWord(3)).toBe("хмарно");
    expect(weatherWord(61)).toBe("дощ");
    expect(weatherWord(95)).toBe("гроза");
  });
});
