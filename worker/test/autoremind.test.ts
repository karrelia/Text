import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReminderError } from "../src/reminders";

// Заміняємо саме створення нагадування: нас цікавить не розбір часу, а те,
// чи бот озветься після невдачі. Мовчання на пряме прохання виглядає як
// поломка — саме на це поскаржився користувач.
const createReminder = vi.hoisted(() => vi.fn());

vi.mock("../src/reminders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/reminders")>();
  return { ...actual, createReminder };
});

vi.mock("../src/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/settings")>();
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({
      llmModel: "google/gemini-2.5-flash",
      visionModel: "google/gemini-2.5-flash",
      sttProvider: "groq" as const,
      sttModel: "whisper-large-v3",
      style: "clean",
      glossary: "",
      extraPrompt: "",
      autoRemind: true,
    })),
  };
});

const { maybeRemind } = await import("../src/pipeline");

function fakeTelegram() {
  const sent: string[] = [];
  return {
    sent,
    client: {
      sendMessage: vi.fn(async (_chatId: number, text: string) => {
        sent.push(text);
        return { message_id: 1, chat: { id: _chatId } };
      }),
    },
  };
}

const env = { TIMEZONE: "Europe/Kyiv" } as never;

beforeEach(() => {
  createReminder.mockReset();
});

describe("нагадування без команди", () => {
  it("пряме прохання, що не вдалося розібрати, не лишається без відповіді", async () => {
    createReminder.mockRejectedValue(new ReminderError("не бачу часу"));
    const tg = fakeTelegram();

    const handled = await maybeRemind(
      env,
      tg.client as never,
      555,
      555,
      "Додай нагадування через кожну хвилину.",
    );

    expect(handled).toBe(true);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]).toContain("не бачу часу");
  });

  it("нотатка зі словом «нагадування» не сварить людину", async () => {
    createReminder.mockRejectedValue(new ReminderError("не бачу часу"));
    const tg = fakeTelegram();

    const handled = await maybeRemind(
      env,
      tg.client as never,
      555,
      555,
      "26 серпня, 8:30, виконком, нагадування.",
    );

    expect(handled).toBe(false);
    expect(tg.sent).toHaveLength(0);
  });

  it("звичайний текст навіть не доходить до розбору", async () => {
    const tg = fakeTelegram();

    const handled = await maybeRemind(
      env,
      tg.client as never,
      555,
      555,
      "перевірити показники по вулиці Озерна",
    );

    expect(handled).toBe(false);
    expect(createReminder).not.toHaveBeenCalled();
    expect(tg.sent).toHaveLength(0);
  });

  it("успішне нагадування підтверджується з інтервалом", async () => {
    createReminder.mockResolvedValue({
      key: "rem:555:000001788000000:abc123",
      dueAt: Date.parse("2026-08-29T06:00:00Z"),
      what: "передати показники",
      repeat: { every: 1, unit: "month" },
    });
    const tg = fakeTelegram();

    const handled = await maybeRemind(
      env,
      tg.client as never,
      555,
      555,
      "нагадуй щомісяця 29 числа передати показники",
    );

    expect(handled).toBe(true);
    expect(tg.sent[0]).toContain("щомісяця");
    expect(tg.sent[0]).toContain("передати показники");
  });
});
