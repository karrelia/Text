import { describe, expect, it } from "vitest";

import {
  ReminderError,
  looksLikeReminder,
  keyFromTail,
  keyTail,
  parseKey,
  parseReminderReply,
  reminderKey,
} from "../src/reminders";
import { DEFAULT_TIMEZONE, formatLocal, localNow, tzOffsetMs, zonedToUtc } from "../src/timezone";
import { toBase64 } from "../src/vision";

const TZ = DEFAULT_TIMEZONE;

// Україна взимку на UTC+2, влітку на UTC+3 — фіксований зсув дав би
// нагадування, що приходять на годину раніше або пізніше пів року.
describe("часовий пояс", () => {
  it("влітку зсув +3, взимку +2", () => {
    expect(tzOffsetMs(new Date("2026-08-13T12:00:00Z"), TZ) / 3_600_000).toBe(3);
    expect(tzOffsetMs(new Date("2026-01-13T12:00:00Z"), TZ) / 3_600_000).toBe(2);
  });

  it("переводить настінний час у момент часу", () => {
    expect(zonedToUtc("2026-08-19 09:00", TZ)?.toISOString()).toBe("2026-08-19T06:00:00.000Z");
    expect(zonedToUtc("2026-01-15 09:00", TZ)?.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("не збивається на переході на літній час", () => {
    expect(zonedToUtc("2026-03-29 01:00", TZ)?.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(zonedToUtc("2026-03-29 04:00", TZ)?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("не збивається на переході на зимовий час", () => {
    expect(zonedToUtc("2026-10-25 04:00", TZ)?.toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });

  it("приймає обидва роздільники дати й часу", () => {
    expect(zonedToUtc("2026-08-19T09:00", TZ)?.getTime()).toBe(
      zonedToUtc("2026-08-19 09:00", TZ)?.getTime(),
    );
  });

  it("на сміття віддає null, а не хибну дату", () => {
    expect(zonedToUtc("колись у вівторок", TZ)).toBeNull();
    expect(zonedToUtc("", TZ)).toBeNull();
  });

  it("показує час у поясі користувача", () => {
    expect(formatLocal(new Date("2026-08-19T06:00:00Z"), TZ)).toBe("19.08.2026, 09:00");
  });

  it("дає моделі контекст «зараз» українською", () => {
    const now = localNow(new Date("2026-08-13T19:15:00Z"), TZ);
    expect(now.stamp).toBe("2026-08-13 22:15");
    expect(now.weekday).toBe("четвер");
  });

  it("тиждень названо повністю", () => {
    const days = [16, 17, 18, 19, 20, 21, 22].map(
      (day) => localNow(new Date(`2026-08-${day}T09:00:00Z`), TZ).weekday,
    );
    expect(days).toEqual([
      "неділя",
      "понеділок",
      "вівторок",
      "середа",
      "четвер",
      "п'ятниця",
      "субота",
    ]);
  });
});

describe("ключі нагадувань", () => {
  it("сортуються за часом лексикографічно", () => {
    const early = reminderKey(1, Date.parse("2026-08-19T06:00:00Z"), "aaaaaa");
    const late = reminderKey(1, Date.parse("2026-12-19T06:00:00Z"), "aaaaaa");
    expect([late, early].sort()).toEqual([early, late]);
  });

  it("розбираються назад", () => {
    const dueAt = Date.parse("2026-08-19T06:00:00Z");
    const parsed = parseKey(reminderKey(42, dueAt, "abc123"));
    expect(parsed).toEqual({ userId: 42, dueAt });
  });

  it("чужий ключ не розбирається", () => {
    expect(parseKey("user:42")).toBeNull();
    expect(parseKey("rem:abc:def:ghi")).toBeNull();
  });

  it("хвіст вміщається в callback_data", () => {
    const key = reminderKey(123456789, Date.now(), "abc123");
    const data = `rd:${keyTail(key)}`;
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
  });

  it("хвіст збирається назад тільки з власним id", () => {
    const key = reminderKey(42, Date.parse("2026-08-19T06:00:00Z"), "abc123");
    expect(keyFromTail(42, keyTail(key))).toBe(key);
    // Чужий id дає інший ключ — видалити чуже нагадування не вийде.
    expect(keyFromTail(99, keyTail(key))).not.toBe(key);
  });
});

describe("розбір відповіді моделі", () => {
  it("читає звичайний JSON", () => {
    expect(parseReminderReply('{"when":"2026-08-19 09:00","what":"здати звіт"}')).toEqual({
      when: "2026-08-19 09:00",
      what: "здати звіт",
    });
  });

  it("витягує JSON з markdown-огорожі", () => {
    const raw = '```json\n{"when":"2026-08-19 09:00","what":"здати звіт"}\n```';
    expect(parseReminderReply(raw).what).toBe("здати звіт");
  });

  it("витягує JSON із балаканини навколо", () => {
    const raw = 'Ось результат: {"when":"2026-08-19 09:00","what":"здати звіт"} — готово';
    expect(parseReminderReply(raw).when).toBe("2026-08-19 09:00");
  });

  it("передає причину відмови від моделі", () => {
    expect(() => parseReminderReply('{"error":"не бачу часу"}')).toThrow(ReminderError);
    expect(() => parseReminderReply('{"error":"не бачу часу"}')).toThrow("не бачу часу");
  });

  it("не приймає неповний результат", () => {
    expect(() => parseReminderReply('{"when":"2026-08-19 09:00"}')).toThrow(ReminderError);
    expect(() => parseReminderReply('{"what":"здати звіт"}')).toThrow(ReminderError);
  });

  it("не падає на відповіді без JSON", () => {
    expect(() => parseReminderReply("вибач, не зрозумів")).toThrow(ReminderError);
    expect(() => parseReminderReply("")).toThrow(ReminderError);
  });

  it("не падає на битому JSON", () => {
    expect(() => parseReminderReply('{"when": "2026-08-19 09:00", "what"')).toThrow(
      ReminderError,
    );
  });
});

describe("кодування фото", () => {
  it("збігається з еталоном на коротких даних", () => {
    expect(toBase64(new Uint8Array([72, 101, 108, 108, 111]))).toBe("SGVsbG8=");
  });

  it("правильно доповнює хвіст будь-якої довжини", () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(length).fill(65);
      expect(atob(toBase64(bytes))).toHaveLength(length);
    }
  });

  it("не переповнює стек на великому знімку", () => {
    const bytes = new Uint8Array(2_000_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const encoded = toBase64(bytes);
    expect(encoded.length).toBe(Math.ceil(bytes.length / 3) * 4);
    expect(atob(encoded).length).toBe(bytes.length);
  });

  it("порожній масив дає порожній рядок", () => {
    expect(toBase64(new Uint8Array())).toBe("");
  });
});

// Команду /remind вводити незручно, тож намір розпізнається за словами.
// Перевірка дешева навмисно: вона виконується на кожному повідомленні.
describe("розпізнавання наміру нагадати", () => {
  it("ловить пряме прохання", () => {
    expect(looksLikeReminder("нагадай завтра о 9 здати звіт")).toBe(true);
    expect(looksLikeReminder("Нагадайте мені про нараду")).toBe(true);
    expect(looksLikeReminder("треба нагадати про показники")).toBe(true);
  });

  it("ловить слово в кінці, як у живому записі", () => {
    expect(looksLikeReminder("26 серпня, 8:30, виконком, нагадування.")).toBe(true);
  });

  it("ловить суржикові варіанти", () => {
    expect(looksLikeReminder("напомни завтра про звіт")).toBe(true);
    expect(looksLikeReminder("постав напоминание на вівторок")).toBe(true);
  });

  it("ловить «не забудь»", () => {
    expect(looksLikeReminder("не забудь у п'ятницю подзвонити")).toBe(true);
    expect(looksLikeReminder("не забути передати показники")).toBe(true);
  });

  it("не спрацьовує на розповіді в минулому часі", () => {
    expect(looksLikeReminder("я нагадав йому про борг ще вчора")).toBe(false);
    expect(looksLikeReminder("вона нагадала про засідання")).toBe(false);
  });

  it("не спрацьовує на звичайній нотатці", () => {
    expect(looksLikeReminder("перевірити показники по вулиці Озерна")).toBe(false);
    expect(looksLikeReminder("акт про пломбування водомірів складено")).toBe(false);
  });

  it("не чіпляється до частин інших слів", () => {
    // «нагадування» всередині довшого слова не має рахуватись словом.
    expect(looksLikeReminder("супернагадувальний пристрій")).toBe(false);
  });

  it("розділові знаки не заважають", () => {
    expect(looksLikeReminder("нагадай!")).toBe(true);
    expect(looksLikeReminder("...нагадування...")).toBe(true);
  });

  it("порожній текст не намір", () => {
    expect(looksLikeReminder("")).toBe(false);
    expect(looksLikeReminder("   ")).toBe(false);
  });
});
