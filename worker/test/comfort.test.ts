import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { PREFIX, remindersKeyboard } from "../src/keyboards";
import {
  firedId,
  listReminders,
  loadReminder,
  rememberFired,
  saveReminder,
  stashDeleted,
  takeDeleted,
} from "../src/reminders";
import type { TgCallbackQuery } from "../src/telegram";
import { addSpending, spentToday } from "../src/settings";
import { REDO_HINT } from "../src/texts";
import { localDay } from "../src/timezone";
import { applyListEdit } from "../src/handlers/commands";
import { handleCallback } from "../src/handlers/callbacks";

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
  const edits: string[] = [];
  const alerts: string[] = [];
  return {
    edits,
    alerts,
    client: {
      sendMessage: vi.fn(async (chatId: number) => ({ message_id: 1, chat: { id: chatId } })),
      editMessage: vi.fn(async (_chatId: number, _id: number, text: string) => {
        edits.push(text);
      }),
      answerCallback: vi.fn(async (_id: string, text?: string) => {
        if (text) alerts.push(text);
      }),
      deleteMessage: vi.fn(async () => undefined),
      editKeyboard: vi.fn(async () => undefined),
      sendChatAction: vi.fn(async () => undefined),
    },
  };
}

const USER = 42;
const CHAT = 100;
const SOON = Date.now() + 3_600_000;

let kv: FakeKV;
let env: Env;
let tg: ReturnType<typeof fakeTelegram>;

beforeEach(() => {
  kv = new FakeKV();
  env = { SETTINGS: kv, TIMEZONE: "Europe/Kyiv" } as unknown as Env;
  tg = fakeTelegram();
});

const press = (data: string): TgCallbackQuery =>
  ({
    id: "cb",
    from: { id: USER },
    data,
    message: { message_id: 5, chat: { id: CHAT } },
  }) as TgCallbackQuery;

const tailOf = (key: string) => key.replace(/^rem:\d+:/, "");

// Раніше кнопкою був сам рядок списку: дотик, щоб роздивитися обрізаний
// текст, мовчки знищував нагадування.
describe("список нагадувань", () => {
  it("кнопки лише прибирають і підписані номерами з тексту", () => {
    const keyboard = remindersKeyboard(["a", "b", "c"]);
    const buttons = keyboard.inline_keyboard.flat();

    expect(buttons.map((button) => button.text)).toEqual(["🗑 1", "🗑 2", "🗑 3"]);
    expect(buttons.every((button) => button.callback_data.startsWith(PREFIX.reminderDelete))).toBe(
      true,
    );
  });

  it("довгий список розкладається в кілька рядів", () => {
    const keyboard = remindersKeyboard(["a", "b", "c", "d", "e"]);
    expect(keyboard.inline_keyboard).toHaveLength(2);
    expect(keyboard.inline_keyboard[0]).toHaveLength(4);
  });

  it("кнопка «повернути» додається лише коли є що повертати", () => {
    expect(remindersKeyboard(["a"]).inline_keyboard).toHaveLength(1);
    expect(remindersKeyboard(["a"], "↩️").inline_keyboard).toHaveLength(2);
  });
});

describe("випадкове видалення", () => {
  it("прибране можна повернути", async () => {
    const key = await saveReminder(env, USER, CHAT, "здати звіт", SOON);

    await handleCallback(env, tg.client as never, press(PREFIX.reminderDelete + tailOf(key)));
    expect(await listReminders(env, USER)).toHaveLength(0);

    await handleCallback(env, tg.client as never, press(PREFIX.reminderUndo));
    const restored = await listReminders(env, USER);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.text).toBe("здати звіт");
  });

  it("повтор переживає повернення", async () => {
    const key = await saveReminder(env, USER, CHAT, "показники", SOON, {
      every: 1,
      unit: "month",
    });

    await handleCallback(env, tg.client as never, press(PREFIX.reminderDelete + tailOf(key)));
    await handleCallback(env, tg.client as never, press(PREFIX.reminderUndo));

    expect((await listReminders(env, USER))[0]?.repeat).toEqual({ every: 1, unit: "month" });
  });

  it("решта списку лишається перед очима", async () => {
    const key = await saveReminder(env, USER, CHAT, "прибрати", SOON);
    await saveReminder(env, USER, CHAT, "лишити", SOON + 60_000);

    await handleCallback(env, tg.client as never, press(PREFIX.reminderDelete + tailOf(key)));

    expect(tg.edits.at(-1)).toContain("лишити");
    expect(tg.edits.at(-1)).not.toContain("прибрати");
  });

  it("чуже нагадування прибрати не вийде", async () => {
    const key = await saveReminder(env, 77, 200, "чуже", SOON);
    await handleCallback(env, tg.client as never, press(PREFIX.reminderDelete + tailOf(key)));

    expect(await listReminders(env, 77)).toHaveLength(1);
  });

  it("прострочене одноразове повертається на зараз, а не в минуле", async () => {
    const past = Date.now() - 86_400_000;
    await stashDeleted(env, {
      key: "rem:42:x",
      userId: USER,
      chatId: CHAT,
      text: "давнє",
      dueAt: past,
    });

    await handleCallback(env, tg.client as never, press(PREFIX.reminderUndo));
    const restored = await listReminders(env, USER);
    expect(restored[0]!.dueAt).toBeGreaterThanOrEqual(past);
  });

  it("коли відкочувати нічого — бот про це каже", async () => {
    await handleCallback(env, tg.client as never, press(PREFIX.reminderUndo));
    expect(tg.alerts.at(-1)).toContain("Повертати вже нічого");
  });

  it("відкотити можна лише один раз", async () => {
    await stashDeleted(env, {
      key: "rem:42:x",
      userId: USER,
      chatId: CHAT,
      text: "одне",
      dueAt: SOON,
    });

    expect(await takeDeleted(env, USER)).not.toBeNull();
    expect(await takeDeleted(env, USER)).toBeNull();
  });
});

// Нагадування приходить тоді, коли його поставили, а не тоді, коли зручно.
// Без кнопок єдиним виходом було продиктувати той самий текст заново.
describe("відкласти нагадування", () => {
  const fire = async (text: string, id: string) => {
    await rememberFired(env, USER, id, text);
  };

  it("створює новий запис на вказаний час", async () => {
    await fire("передзвонити Кириленку", "abc123");
    const before = Date.now();

    await handleCallback(env, tg.client as never, press(`${PREFIX.snooze}60:abc123`));

    const list = await listReminders(env, USER);
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe("передзвонити Кириленку");
    expect(list[0]!.dueAt).toBeGreaterThanOrEqual(before + 59 * 60_000);
    expect(list[0]!.dueAt).toBeLessThanOrEqual(Date.now() + 61 * 60_000);
  });

  // Відкладаємо цей раз, а не всю серію: наступне спрацювання за розкладом
  // уже стоїть окремим записом, і чіпати його не можна.
  it("відкладене — одноразове навіть для повторюваного", async () => {
    await fire("передати показники", "rep777");
    await handleCallback(env, tg.client as never, press(`${PREFIX.snooze}180:rep777`));

    expect((await listReminders(env, USER))[0]?.repeat).toBeUndefined();
  });

  it("кілька нагадувань за раз не плутаються", async () => {
    await fire("перше", "aaa111");
    await fire("друге", "bbb222");

    await handleCallback(env, tg.client as never, press(`${PREFIX.snooze}60:bbb222`));

    expect((await listReminders(env, USER))[0]?.text).toBe("друге");
  });

  it("кнопки прибираються, щоб не відкласти двічі", async () => {
    await fire("звіт", "ccc333");
    await handleCallback(env, tg.client as never, press(`${PREFIX.snooze}60:ccc333`));

    expect(tg.client.editKeyboard).toHaveBeenCalled();
  });

  it("забуте за добу нагадування чесно про це каже", async () => {
    await handleCallback(env, tg.client as never, press(`${PREFIX.snooze}60:немає`));

    expect(await listReminders(env, USER)).toHaveLength(0);
    expect(tg.alerts.at(-1)).toContain("вже не під рукою");
  });

  it("зіпсована кнопка нічого не створює", async () => {
    await fire("звіт", "ddd444");
    await handleCallback(env, tg.client as never, press(`${PREFIX.snooze}казна-що:ddd444`));

    expect(await listReminders(env, USER)).toHaveLength(0);
  });

  it("«Готово» лише знімає кнопки", async () => {
    await handleCallback(env, tg.client as never, press(PREFIX.snoozeDone));

    expect(tg.client.editKeyboard).toHaveBeenCalled();
    expect(await listReminders(env, USER)).toHaveLength(0);
  });

  it("ідентифікатор береться з хвоста ключа", () => {
    expect(firedId("rem:42:000001788000000:abc123")).toBe("abc123");
  });
});

describe("окремий запис у сховищі", () => {
  it("читається за ключем разом із повтором", async () => {
    const key = await saveReminder(env, USER, CHAT, "показники", SOON, {
      every: 2,
      unit: "week",
    });
    const loaded = await loadReminder(env, key);

    expect(loaded?.text).toBe("показники");
    expect(loaded?.repeat).toEqual({ every: 2, unit: "week" });
    expect(loaded?.userId).toBe(USER);
  });

  it("неіснуючий ключ — це null, а не падіння", async () => {
    expect(await loadReminder(env, "rem:42:000001788000000:zzz")).toBeNull();
    expect(await loadReminder(env, "сміття")).toBeNull();
  });
});

// Без цього вибір моделі робиться наосліп: різниця між дешевою та дорогою
// на одному записі — десятки разів, а видно її лише в підсумку за місяць.
describe("облік витрат", () => {
  const DAY = "2026-08-15";

  it("накопичується за добу", async () => {
    await addSpending(env, USER, DAY, 0.002);
    await addSpending(env, USER, DAY, 0.003);
    expect(await spentToday(env, USER, DAY)).toBeCloseTo(0.005, 6);
  });

  it("дні рахуються окремо", async () => {
    await addSpending(env, USER, DAY, 0.01);
    await addSpending(env, USER, "2026-08-16", 0.02);
    expect(await spentToday(env, USER, DAY)).toBeCloseTo(0.01, 6);
  });

  it("у кожного свій рахунок", async () => {
    await addSpending(env, USER, DAY, 0.01);
    expect(await spentToday(env, 77, DAY)).toBe(0);
  });

  it("порожній день — це нуль, а не поломка", async () => {
    expect(await spentToday(env, USER, DAY)).toBe(0);
  });

  // OpenRouter не для всіх постачальників повертає вартість — нуль не має
  // ані псувати підсумок, ані створювати запис.
  it("нульова вартість нічого не змінює", async () => {
    await addSpending(env, USER, DAY, 0.01);
    await addSpending(env, USER, DAY, 0);
    expect(await spentToday(env, USER, DAY)).toBeCloseTo(0.01, 6);
  });

  it("дрібні суми показуються в центах, більші — в доларах", () => {
    expect(REDO_HINT("", { now: 0.0004, today: 0.012 })).toContain("0.04¢");
    expect(REDO_HINT("", { now: 0.02, today: 0.5 })).toContain("$0.020");
  });

  it("без вартості підпису немає", () => {
    expect(REDO_HINT("")).not.toContain("¢");
  });

  it("локальна дата — ключ доби", () => {
    // 21:30 за Гринвічем у Києві це вже наступний день.
    expect(localDay(new Date("2026-08-15T21:30:00Z"), "Europe/Kyiv")).toBe("2026-08-16");
  });
});

// Словник із півтора десятка назв не можна змушувати переписувати цілком
// заради однієї нової.
describe("дописування в список", () => {
  it("«+» додає в кінець, не чіпаючи решти", () => {
    expect(applyListEdit("Миргород, Гаркушенці", "+ Кірпосенко").value).toBe(
      "Миргород, Гаркушенці, Кірпосенко",
    );
  });

  it("«+» приймає кілька назв відразу", () => {
    expect(applyListEdit("Миргород", "+ Гаркушенці, Кірпосенко").value).toBe(
      "Миргород, Гаркушенці, Кірпосенко",
    );
  });

  it("двічі те саме не додається", () => {
    expect(applyListEdit("Миргород, Кірпосенко", "+ кірпосенко").value).toBe(
      "Миргород, Кірпосенко",
    );
  });

  it("«-» з назвою прибирає лише її", () => {
    expect(applyListEdit("Миргород, Кірпосенко, Гаркушенці", "- Кірпосенко").value).toBe(
      "Миргород, Гаркушенці",
    );
  });

  it("невідома назва не мовчить і нічого не псує", () => {
    const result = applyListEdit("Миргород", "- Полтава");
    expect(result.value).toBe("Миргород");
    expect(result.error).toContain("Не знайшов");
  });

  it("звичайний список і далі замінює все", () => {
    expect(applyListEdit("Миргород", "Полтава, Лубни").value).toBe("Полтава, Лубни");
  });

  // Інакше «+» на порожньому місці мовчки з'їв би сам символ.
  it("сам «+» без назви лишається текстом", () => {
    expect(applyListEdit("Миргород", "+").value).toBe("+");
  });

  it("порожній словник теж наповнюється", () => {
    expect(applyListEdit("", "+ Миргород").value).toBe("Миргород");
  });
});
