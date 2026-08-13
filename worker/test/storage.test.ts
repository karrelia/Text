import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import {
  MAX_PER_USER,
  deleteReminder,
  dueReminders,
  listReminders,
  saveReminder,
} from "../src/reminders";
import {
  defaultsFor,
  loadLastTranscript,
  loadSettings,
  saveLastTranscript,
  seenUpdate,
  updateSettings,
} from "../src/settings";
import { pickReminderSource } from "../src/handlers/commands";

/** Мінімальний KV у пам'яті: досить для put/get/list/delete з префіксом. */
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
      // KV віддає ключі лексикографічно — від цього залежить порядок за часом.
      .sort()
      .slice(0, options.limit ?? 1000)
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

let kv: FakeKV;
let env: Env;

beforeEach(() => {
  kv = new FakeKV();
  env = { SETTINGS: kv, LLM_MODEL: "google/gemini-2.5-flash" } as unknown as Env;
});

const at = (iso: string) => Date.parse(iso);

describe("нагадування у сховищі", () => {
  it("зберігається й читається назад", async () => {
    await saveReminder(env, 42, 100, "здати звіт", at("2030-08-19T06:00:00Z"));
    const list = await listReminders(env, 42);

    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe("здати звіт");
    expect(list[0]?.chatId).toBe(100);
    expect(list[0]?.dueAt).toBe(at("2030-08-19T06:00:00Z"));
  });

  it("список відсортований за часом, а не за порядком створення", async () => {
    await saveReminder(env, 42, 100, "пізніше", at("2030-12-01T09:00:00Z"));
    await saveReminder(env, 42, 100, "раніше", at("2030-08-01T09:00:00Z"));
    await saveReminder(env, 42, 100, "посередині", at("2030-10-01T09:00:00Z"));

    expect((await listReminders(env, 42)).map((r) => r.text)).toEqual([
      "раніше",
      "посередині",
      "пізніше",
    ]);
  });

  it("користувачі не бачать чужих нагадувань", async () => {
    await saveReminder(env, 42, 100, "моє", at("2030-08-19T06:00:00Z"));
    await saveReminder(env, 77, 200, "чуже", at("2030-08-19T06:00:00Z"));

    expect((await listReminders(env, 42)).map((r) => r.text)).toEqual(["моє"]);
    expect((await listReminders(env, 77)).map((r) => r.text)).toEqual(["чуже"]);
  });

  it("настали лише ті, чий час минув", async () => {
    await saveReminder(env, 42, 100, "минуле", at("2020-01-01T09:00:00Z"));
    await saveReminder(env, 42, 100, "майбутнє", at("2030-01-01T09:00:00Z"));

    const due = await dueReminders(env, at("2026-08-13T09:00:00Z"));
    expect(due.map((r) => r.text)).toEqual(["минуле"]);
  });

  it("рівно в свій час нагадування вже настало", async () => {
    const moment = at("2026-08-13T09:00:00Z");
    await saveReminder(env, 42, 100, "точно зараз", moment);
    expect(await dueReminders(env, moment)).toHaveLength(1);
  });

  it("вибірка тих, що настали, бачить усіх користувачів", async () => {
    await saveReminder(env, 42, 100, "перше", at("2020-01-01T09:00:00Z"));
    await saveReminder(env, 77, 200, "друге", at("2020-01-01T09:00:00Z"));

    const due = await dueReminders(env, at("2026-08-13T09:00:00Z"));
    expect(due.map((r) => r.userId).sort()).toEqual([42, 77]);
    expect(due.map((r) => r.chatId).sort()).toEqual([100, 200]);
  });

  it("видалення прибирає лише одне", async () => {
    await saveReminder(env, 42, 100, "лишити", at("2030-08-01T09:00:00Z"));
    await saveReminder(env, 42, 100, "прибрати", at("2030-09-01T09:00:00Z"));

    const list = await listReminders(env, 42);
    const target = list.find((r) => r.text === "прибрати")!;
    await deleteReminder(env, target.key);

    expect((await listReminders(env, 42)).map((r) => r.text)).toEqual(["лишити"]);
  });

  it("нагадування, створені в одну мить, не затирають одне одного", async () => {
    const moment = at("2030-08-19T06:00:00Z");
    await saveReminder(env, 42, 100, "перше", moment);
    await saveReminder(env, 42, 100, "друге", moment);
    expect(await listReminders(env, 42)).toHaveLength(2);
  });

  it("список обмежений стелею на користувача", async () => {
    for (let index = 0; index < MAX_PER_USER + 10; index++) {
      await saveReminder(env, 42, 100, `запис ${index}`, at("2030-08-19T06:00:00Z") + index * 1000);
    }
    expect((await listReminders(env, 42)).length).toBeLessThanOrEqual(MAX_PER_USER);
  });

  it("налаштування не потрапляють у вибірку нагадувань", async () => {
    await updateSettings(env, 42, { style: "video" });
    await saveReminder(env, 42, 100, "нагадування", at("2020-01-01T09:00:00Z"));

    const due = await dueReminders(env, at("2026-08-13T09:00:00Z"));
    expect(due).toHaveLength(1);
    expect(due[0]?.text).toBe("нагадування");
  });
});

describe("налаштування у сховищі", () => {
  it("новий користувач отримує типові значення", async () => {
    const user = await loadSettings(env, 42);
    expect(user).toEqual(defaultsFor(env));
  });

  it("зберігається лише змінене, решта тягнеться з конфігу", async () => {
    await updateSettings(env, 42, { style: "formal" });

    const withNewDefault = { ...env, LLM_MODEL: "openai/gpt-5" } as Env;
    const user = await loadSettings(withNewDefault, 42);
    expect(user.style).toBe("formal");
    expect(user.llmModel).toBe("openai/gpt-5");
  });

  it("модель для фото зберігається окремо від текстової", async () => {
    await updateSettings(env, 42, { visionModel: "google/gemini-2.5-pro" });
    const user = await loadSettings(env, 42);
    expect(user.visionModel).toBe("google/gemini-2.5-pro");
    expect(user.llmModel).toBe("google/gemini-2.5-flash");
  });

  it("невідомий стиль зі сховища не ламає бота", async () => {
    await kv.put("user:42", JSON.stringify({ style: "видалений-режим" }));
    expect((await loadSettings(env, 42)).style).toBe("clean");
  });

  it("дублікат оновлення розпізнається", async () => {
    expect(await seenUpdate(env, 900)).toBe(false);
    expect(await seenUpdate(env, 900)).toBe(true);
    expect(await seenUpdate(env, 901)).toBe(false);
  });
});

// Користувач надсилає /remind окремим повідомленням, а не відповіддю —
// саме на цьому перша версія й не спрацювала.
describe("звідки береться текст нагадування", () => {
  it("явний аргумент має найвищий пріоритет", () => {
    expect(pickReminderSource("завтра о 9 звіт", "з відповіді", "з історії")).toEqual({
      source: "завтра о 9 звіт",
      fromHistory: false,
    });
  });

  it("без аргументу береться те, на що відповіли", () => {
    expect(pickReminderSource("", "з відповіді", "з історії")).toEqual({
      source: "з відповіді",
      fromHistory: false,
    });
  });

  it("без аргументу й відповіді береться остання розшифровка", () => {
    expect(pickReminderSource("", "", "26 серпня о 8:30 виконком")).toEqual({
      source: "26 серпня о 8:30 виконком",
      fromHistory: true,
    });
  });

  it("коли брати нічого — джерела немає", () => {
    expect(pickReminderSource("", "", "")).toEqual({ source: "", fromHistory: false });
  });

  it("порожні рядки не вважаються джерелом", () => {
    expect(pickReminderSource("   ", "  ", "справжній текст").source).toBe("справжній текст");
  });
});

describe("пам'ять про останню розшифровку", () => {
  it("зберігається й читається", async () => {
    await saveLastTranscript(env, 42, "26 серпня о 8:30 виконком");
    expect(await loadLastTranscript(env, 42)).toBe("26 серпня о 8:30 виконком");
  });

  it("у кожного своя", async () => {
    await saveLastTranscript(env, 42, "моє");
    await saveLastTranscript(env, 77, "чуже");
    expect(await loadLastTranscript(env, 42)).toBe("моє");
    expect(await loadLastTranscript(env, 77)).toBe("чуже");
  });

  it("порожній текст не затирає збережене", async () => {
    await saveLastTranscript(env, 42, "справжнє");
    await saveLastTranscript(env, 42, "   ");
    expect(await loadLastTranscript(env, 42)).toBe("справжнє");
  });

  it("якщо нічого не зберігали — порожньо", async () => {
    expect(await loadLastTranscript(env, 42)).toBe("");
  });

  it("не потрапляє у вибірку нагадувань", async () => {
    await saveLastTranscript(env, 42, "щойно сказане");
    await saveReminder(env, 42, 100, "нагадування", at("2020-01-01T09:00:00Z"));
    const due = await dueReminders(env, at("2026-08-13T09:00:00Z"));
    expect(due).toHaveLength(1);
    expect(due[0]?.text).toBe("нагадування");
  });
});
