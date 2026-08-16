import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { PREFIX, voiceResultKeyboard } from "../src/keyboards";
import {
  STYLES,
  buildSystemPrompt,
  buildUserMessage,
  styleKind,
  temperatureFor,
} from "../src/prompts";
import { listReminders, parseTasksReply, planTasks } from "../src/reminders";
import type { TgCallbackQuery } from "../src/telegram";

const complete = vi.hoisted(() => vi.fn(async () => '{"tasks":[]}'));

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  complete,
}));

const { handleCallback } = await import("../src/handlers/callbacks");
const { saveLastTranscript } = await import("../src/settings");

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
  const alerts: string[] = [];
  return {
    sent,
    alerts,
    client: {
      sendMessage: vi.fn(async (chatId: number, text: string) => {
        sent.push(text);
        return { message_id: 1, chat: { id: chatId } };
      }),
      editMessage: vi.fn(async () => undefined),
      answerCallback: vi.fn(async (_id: string, text?: string) => {
        if (text) alerts.push(text);
      }),
      sendChatAction: vi.fn(async () => undefined),
      editKeyboard: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined),
    },
  };
}

const USER = 42;
const CHAT = 100;
const NOW = new Date("2026-06-01T06:00:00Z");

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
  complete.mockResolvedValue('{"tasks":[]}');
});

const press = (data: string): TgCallbackQuery =>
  ({
    id: "cb",
    from: { id: USER },
    data,
    message: { message_id: 5, chat: { id: CHAT } },
  }) as TgCallbackQuery;

const user = { llmModel: "google/gemini-2.5-flash" } as never;

describe("режим протоколу", () => {
  it("це окремий вид завдання, а не стиль редактора", () => {
    expect(styleKind("minutes")).toBe("minutes");
    expect(STYLES.minutes!.kind).toBe("minutes");
  });

  // Редактору прямо заборонено переказувати («це редагування, а не переказ»),
  // а протокол — саме переказ, тільки строго за фактами.
  it("має власний базовий промпт, не редакторський", () => {
    const prompt = buildSystemPrompt("minutes");
    expect(prompt).toContain("ДОРУЧЕННЯ");
    expect(prompt).toContain("ВИРІШИЛИ");
    expect(prompt).not.toContain("це редагування, а не переказ");
  });

  it("вимагає не вигадувати терміни", () => {
    expect(buildSystemPrompt("minutes")).toContain("термін не названо");
  });

  it("запис подається як нарада", () => {
    expect(buildUserMessage("minutes", "текст")).toContain("<meeting>");
  });

  // Вигадане прізвище чи число в протоколі — це помилка, за якою хтось діятиме.
  it("температура нульова", () => {
    expect(temperatureFor("minutes", 0.2)).toBe(0);
    expect(temperatureFor("clean", 0.2)).toBe(0.2);
    expect(temperatureFor("video", 0.2)).toBe(0.8);
  });

  it("кнопка доручень з'являється лише під протоколом", () => {
    const withTasks = voiceResultKeyboard("⏰ Доручення").inline_keyboard.flat();
    const without = voiceResultKeyboard().inline_keyboard.flat();

    expect(withTasks.some((button) => button.callback_data === PREFIX.minutesTasks)).toBe(true);
    expect(without.some((button) => button.callback_data === PREFIX.minutesTasks)).toBe(false);
  });
});

describe("розбір доручень", () => {
  it("читає перелік завдань", () => {
    const tasks = parseTasksReply(
      '{"tasks":[{"when":"2026-06-03 09:00","what":"Кірпосенко: передати показники"}]}',
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.what).toBe("Кірпосенко: передати показники");
  });

  it("порожній перелік — це не помилка", () => {
    expect(parseTasksReply('{"tasks":[]}')).toEqual([]);
  });

  // Модель іноді відповідає прозою попри інструкцію — це не привід падати.
  it("сміття замість JSON не ламає розбір", () => {
    expect(parseTasksReply("не знайшов доручень")).toEqual([]);
    expect(parseTasksReply('{"tasks":"чомусь рядок"}')).toEqual([]);
  });

  it("неповні записи відкидаються поштучно", () => {
    const tasks = parseTasksReply(
      '{"tasks":[{"when":"2026-06-03 09:00"},{"when":"2026-06-04 09:00","what":"звіт"}]}',
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.what).toBe("звіт");
  });
});

describe("планування доручень", () => {
  it("кілька доручень стають кількома завданнями", async () => {
    complete.mockResolvedValue(
      '{"tasks":[' +
        '{"when":"2026-06-03 09:00","what":"Кірпосенко: показники"},' +
        '{"when":"2026-06-05 14:00","what":"Кириленко: акт"}' +
        "]}",
    );

    const tasks = await planTasks(env, user, "протокол", NOW);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.what).toBe("Кірпосенко: показники");
  });

  // Половина доручень у протоколі без дати. Вигадати її — розсипати по
  // календарю зобов'язання, яких ніхто не брав.
  it("минулі дати пропускаються, а решта лишається", async () => {
    complete.mockResolvedValue(
      '{"tasks":[' +
        '{"when":"2020-01-01 09:00","what":"давнє"},' +
        '{"when":"2026-06-05 14:00","what":"майбутнє"}' +
        "]}",
    );

    const tasks = await planTasks(env, user, "протокол", NOW);
    expect(tasks.map((task) => task.what)).toEqual(["майбутнє"]);
  });

  it("без доручень повертається порожньо", async () => {
    const tasks = await planTasks(env, user, "протокол", NOW);
    expect(tasks).toEqual([]);
  });
});

describe("кнопка «нагадування з доручень»", () => {
  it("ставить нагадування на кожне доручення", async () => {
    await saveLastTranscript(env, USER, "ДОРУЧЕННЯ\n— Кірпосенко — показники — до 3 червня");
    complete.mockResolvedValue(
      '{"tasks":[' +
        '{"when":"2036-06-03 09:00","what":"Кірпосенко: показники"},' +
        '{"when":"2036-06-05 14:00","what":"Кириленко: акт"}' +
        "]}",
    );

    await handleCallback(env, tg.client as never, press(PREFIX.minutesTasks));

    const saved = await listReminders(env, USER);
    expect(saved).toHaveLength(2);
    expect(tg.sent.at(-1)).toContain("Поставив нагадувань: 2");
  });

  it("нагадування з доручення одноразове", async () => {
    await saveLastTranscript(env, USER, "протокол");
    complete.mockResolvedValue('{"tasks":[{"when":"2036-06-03 09:00","what":"звіт"}]}');

    await handleCallback(env, tg.client as never, press(PREFIX.minutesTasks));

    expect((await listReminders(env, USER))[0]?.repeat).toBeUndefined();
  });

  it("коли термінів немає — підказує, що робити", async () => {
    await saveLastTranscript(env, USER, "протокол без дат");

    await handleCallback(env, tg.client as never, press(PREFIX.minutesTasks));

    expect(await listReminders(env, USER)).toHaveLength(0);
    expect(tg.sent.at(-1)).toContain("Не знайшов жодного доручення");
  });

  it("без протоколу під рукою нічого не робить", async () => {
    await handleCallback(env, tg.client as never, press(PREFIX.minutesTasks));

    expect(complete).not.toHaveBeenCalled();
    expect(tg.alerts.at(-1)).toContain("Немає чого переробляти");
  });
});
