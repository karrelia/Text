import { describe, expect, it } from "vitest";

import {
  REPEAT_KINDS,
  REPEAT_TITLES,
  isRepeatKind,
  nextAfter,
  nextOccurrence,
} from "../src/recurrence";
import { DEFAULT_TIMEZONE, formatLocal, zonedToUtc } from "../src/timezone";
import { parseReminderReply } from "../src/reminders";

const TZ = DEFAULT_TIMEZONE;

const at = (local: string) => zonedToUtc(local, TZ)!.getTime();
const shown = (ms: number | null) => (ms === null ? null : formatLocal(new Date(ms), TZ));

describe("наступне спрацювання", () => {
  it("щодня переходить через межу місяця й року", () => {
    expect(shown(nextOccurrence(at("2026-08-31 09:00"), "daily", TZ))).toBe("01.09.2026, 09:00");
    expect(shown(nextOccurrence(at("2026-12-31 23:30"), "daily", TZ))).toBe("01.01.2027, 23:30");
  });

  it("щотижня додає рівно сім днів", () => {
    expect(shown(nextOccurrence(at("2026-08-13 09:00"), "weekly", TZ))).toBe("20.08.2026, 09:00");
  });

  it("щомісяця тримається того самого числа", () => {
    expect(shown(nextOccurrence(at("2026-08-29 09:00"), "monthly", TZ))).toBe("29.09.2026, 09:00");
    expect(shown(nextOccurrence(at("2026-12-29 09:00"), "monthly", TZ))).toBe("29.01.2027, 09:00");
  });

  // «Щомісяця 31-го» у лютому нікуди подіти — підтягуємо до останнього дня,
  // інакше нагадування поїхало б на березень і збилося б назавжди.
  it("кінець місяця підтягується, а не переїжджає", () => {
    expect(shown(nextOccurrence(at("2026-01-31 09:00"), "monthly", TZ))).toBe("28.02.2026, 09:00");
    expect(shown(nextOccurrence(at("2026-03-31 09:00"), "monthly", TZ))).toBe("30.04.2026, 09:00");
  });

  it("29 лютого раз на рік стає 28-м", () => {
    expect(shown(nextOccurrence(at("2028-02-29 09:00"), "yearly", TZ))).toBe("28.02.2029, 09:00");
  });

  it("щороку тримає ту саму дату", () => {
    expect(shown(nextOccurrence(at("2026-08-13 09:00"), "yearly", TZ))).toBe("13.08.2027, 09:00");
  });

  // Найважливіше: додавання доби в мілісекундах збило б годину після
  // переходу на зимовий час, і «щодня о 9:00» почало б приходити о 8:00.
  it("година не з'їжджає на переходах часу", () => {
    expect(shown(nextOccurrence(at("2026-10-24 09:00"), "daily", TZ))).toBe("25.10.2026, 09:00");
    expect(shown(nextOccurrence(at("2026-03-28 09:00"), "daily", TZ))).toBe("29.03.2026, 09:00");
  });

  it("перехід не збиває й тижневий крок", () => {
    expect(shown(nextOccurrence(at("2026-10-21 09:00"), "weekly", TZ))).toBe("28.10.2026, 09:00");
  });
});

describe("догоняння пропущених", () => {
  it("проскакує все, що вже минуло", () => {
    const next = nextAfter(at("2026-01-01 09:00"), "monthly", TZ, at("2026-08-13 12:00"));
    expect(shown(next)).toBe("01.09.2026, 09:00");
  });

  it("одного кроку досить, коли нічого не пропущено", () => {
    const next = nextAfter(at("2026-08-13 09:00"), "daily", TZ, at("2026-08-13 10:00"));
    expect(shown(next)).toBe("14.08.2026, 09:00");
  });

  it("результат завжди в майбутньому", () => {
    const now = at("2026-08-13 12:00");
    for (const kind of REPEAT_KINDS) {
      const next = nextAfter(at("2020-01-01 09:00"), kind, TZ, now);
      expect(next).not.toBeNull();
      expect(next!).toBeGreaterThan(now);
    }
  });

  // Щоденне нагадування з давньої дати — тисячі періодів. Крокувати їх по
  // одному не можна: кожен крок звертається до Intl, і 10 мс процесорного
  // часу закінчились би раніше.
  it("давня щоденна дата доганяється без тисяч кроків", () => {
    const now = at("2026-08-13 12:00");
    const next = nextAfter(at("2000-01-01 09:00"), "daily", TZ, now);
    expect(shown(next)).toBe("14.08.2026, 09:00");
  });

  it("давня щотижнева дата лишається в той самий день тижня", () => {
    // 2020-01-01 — середа, тож і результат має бути середою.
    const next = nextAfter(at("2020-01-01 09:00"), "weekly", TZ, at("2026-08-13 12:00"));
    expect(new Date(next!).getUTCDay()).toBe(3);
  });
});

describe("види повтору", () => {
  it("кожен має українську назву", () => {
    for (const kind of REPEAT_KINDS) {
      expect(REPEAT_TITLES[kind]).toBeTruthy();
    }
  });

  it("чуже значення не приймається", () => {
    expect(isRepeatKind("daily")).toBe(true);
    expect(isRepeatKind("щодня")).toBe(false);
    expect(isRepeatKind(undefined)).toBe(false);
    expect(isRepeatKind(42)).toBe(false);
  });
});

describe("повтор у відповіді моделі", () => {
  it("читається, коли вказаний", () => {
    const parsed = parseReminderReply(
      '{"when":"2026-08-29 09:00","what":"передати показники","repeat":"monthly"}',
    );
    expect(parsed.repeat).toBe("monthly");
  });

  it("відсутній повтор лишається невизначеним", () => {
    const parsed = parseReminderReply('{"when":"2026-08-29 09:00","what":"здати звіт"}');
    expect(parsed.repeat).toBeUndefined();
  });

  it("вигадане моделлю значення ігнорується, а не ламає розбір", () => {
    const parsed = parseReminderReply(
      '{"when":"2026-08-29 09:00","what":"звіт","repeat":"щокварталу"}',
    );
    expect(parsed.repeat).toBeUndefined();
    expect(parsed.what).toBe("звіт");
  });
});
