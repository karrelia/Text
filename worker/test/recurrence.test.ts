import { describe, expect, it } from "vitest";

import {
  MAX_EVERY,
  type Repeat,
  REPEAT_UNITS,
  nextAfter,
  nextOccurrence,
  parseRepeat,
  repeatTitle,
} from "../src/recurrence";
import { DEFAULT_TIMEZONE, formatLocal, zonedToUtc } from "../src/timezone";
import { parseReminderReply, reminderIntent } from "../src/reminders";

const TZ = DEFAULT_TIMEZONE;

const at = (local: string) => zonedToUtc(local, TZ)!.getTime();
const shown = (ms: number | null) => (ms === null ? null : formatLocal(new Date(ms), TZ));
const every = (count: number, unit: Repeat["unit"]): Repeat => ({ every: count, unit });

describe("наступне спрацювання", () => {
  it("щодня переходить через межу місяця й року", () => {
    expect(shown(nextOccurrence(at("2026-08-31 09:00"), every(1, "day"), TZ))).toBe(
      "01.09.2026, 09:00",
    );
    expect(shown(nextOccurrence(at("2026-12-31 23:30"), every(1, "day"), TZ))).toBe(
      "01.01.2027, 23:30",
    );
  });

  it("щотижня додає рівно сім днів", () => {
    expect(shown(nextOccurrence(at("2026-08-13 09:00"), every(1, "week"), TZ))).toBe(
      "20.08.2026, 09:00",
    );
  });

  it("щомісяця тримається того самого числа", () => {
    expect(shown(nextOccurrence(at("2026-08-29 09:00"), every(1, "month"), TZ))).toBe(
      "29.09.2026, 09:00",
    );
    expect(shown(nextOccurrence(at("2026-12-29 09:00"), every(1, "month"), TZ))).toBe(
      "29.01.2027, 09:00",
    );
  });

  // «Щомісяця 31-го» у лютому нікуди подіти — підтягуємо до останнього дня,
  // інакше нагадування поїхало б на березень і збилося б назавжди.
  it("кінець місяця підтягується, а не переїжджає", () => {
    expect(shown(nextOccurrence(at("2026-01-31 09:00"), every(1, "month"), TZ))).toBe(
      "28.02.2026, 09:00",
    );
    expect(shown(nextOccurrence(at("2026-03-31 09:00"), every(1, "month"), TZ))).toBe(
      "30.04.2026, 09:00",
    );
  });

  it("29 лютого раз на рік стає 28-м", () => {
    expect(shown(nextOccurrence(at("2028-02-29 09:00"), every(1, "year"), TZ))).toBe(
      "28.02.2029, 09:00",
    );
  });

  // Саме на цьому користувач і спіткнувся: «через кожну хвилину» просто не
  // існувало серед підтримуваних повторів.
  it("хвилини й години теж повторюються", () => {
    expect(shown(nextOccurrence(at("2026-08-14 10:58"), every(1, "minute"), TZ))).toBe(
      "14.08.2026, 10:59",
    );
    expect(shown(nextOccurrence(at("2026-08-14 10:58"), every(3, "minute"), TZ))).toBe(
      "14.08.2026, 11:01",
    );
    expect(shown(nextOccurrence(at("2026-08-14 10:58"), every(2, "hour"), TZ))).toBe(
      "14.08.2026, 12:58",
    );
  });

  it("довільний крок працює для всіх одиниць", () => {
    expect(shown(nextOccurrence(at("2026-08-13 09:00"), every(2, "week"), TZ))).toBe(
      "27.08.2026, 09:00",
    );
    expect(shown(nextOccurrence(at("2026-08-13 09:00"), every(3, "month"), TZ))).toBe(
      "13.11.2026, 09:00",
    );
    expect(shown(nextOccurrence(at("2026-08-13 09:00"), every(2, "year"), TZ))).toBe(
      "13.08.2028, 09:00",
    );
  });

  // Додавання доби в мілісекундах збило б годину після переходу на зимовий
  // час, і «щодня о 9:00» почало б приходити о 8:00.
  it("година не з'їжджає на переходах часу", () => {
    expect(shown(nextOccurrence(at("2026-10-24 09:00"), every(1, "day"), TZ))).toBe(
      "25.10.2026, 09:00",
    );
    expect(shown(nextOccurrence(at("2026-03-28 09:00"), every(1, "day"), TZ))).toBe(
      "29.03.2026, 09:00",
    );
  });
});

describe("догоняння пропущених", () => {
  it("проскакує все, що вже минуло", () => {
    const next = nextAfter(at("2026-01-01 09:00"), every(1, "month"), TZ, at("2026-08-13 12:00"));
    expect(shown(next)).toBe("01.09.2026, 09:00");
  });

  it("результат завжди в майбутньому", () => {
    const now = at("2026-08-13 12:00");
    for (const unit of REPEAT_UNITS) {
      const next = nextAfter(at("2026-08-01 09:00"), every(1, unit), TZ, now);
      expect(next).not.toBeNull();
      expect(next!).toBeGreaterThan(now);
    }
  });

  // Щохвилинне нагадування за добу простою — понад тисяча періодів.
  // Крокувати їх по одному не можна: кожен крок для добових і довших
  // інтервалів звертається до Intl, а процесорного часу лише 10 мс.
  it("доба простою на щохвилинному не потребує тисяч кроків", () => {
    const next = nextAfter(at("2026-08-13 09:00"), every(1, "minute"), TZ, at("2026-08-14 09:00"));
    expect(shown(next)).toBe("14.08.2026, 09:01");
  });

  it("давня щоденна дата доганяється", () => {
    const next = nextAfter(at("2000-01-01 09:00"), every(1, "day"), TZ, at("2026-08-13 12:00"));
    expect(shown(next)).toBe("14.08.2026, 09:00");
  });

  it("крок понад одиницю зберігається при догонянні", () => {
    // Від 1 січня кроком у 3 місяці: січень → квітень → липень → жовтень.
    const next = nextAfter(at("2026-01-01 09:00"), every(3, "month"), TZ, at("2026-08-13 12:00"));
    expect(shown(next)).toBe("01.10.2026, 09:00");
  });
});

describe("назви інтервалів українською", () => {
  it("одиничний крок називається одним словом", () => {
    expect(repeatTitle(every(1, "minute"))).toBe("щохвилини");
    expect(repeatTitle(every(1, "hour"))).toBe("щогодини");
    expect(repeatTitle(every(1, "day"))).toBe("щодня");
    expect(repeatTitle(every(1, "week"))).toBe("щотижня");
    expect(repeatTitle(every(1, "month"))).toBe("щомісяця");
    expect(repeatTitle(every(1, "year"))).toBe("щороку");
  });

  it("множина узгоджується з числом", () => {
    expect(repeatTitle(every(2, "minute"))).toBe("кожні 2 хвилини");
    expect(repeatTitle(every(5, "minute"))).toBe("кожні 5 хвилин");
    expect(repeatTitle(every(3, "day"))).toBe("кожні 3 дні");
    expect(repeatTitle(every(7, "day"))).toBe("кожні 7 днів");
    expect(repeatTitle(every(2, "week"))).toBe("кожні 2 тижні");
  });

  it("рід узгоджується на числах, що закінчуються на одиницю", () => {
    expect(repeatTitle(every(21, "minute"))).toBe("кожну 21 хвилину");
    expect(repeatTitle(every(21, "day"))).toBe("кожен 21 день");
  });

  it("одинадцять — виняток, це множина", () => {
    expect(repeatTitle(every(11, "day"))).toBe("кожні 11 днів");
  });
});

describe("розбір інтервалу", () => {
  it("читає пару «скільки + чого»", () => {
    expect(parseRepeat({ every: 3, unit: "minute" })).toEqual({ every: 3, unit: "minute" });
  });

  it("без «every» вважає крок одиничним", () => {
    expect(parseRepeat({ unit: "month" })).toEqual({ every: 1, unit: "month" });
  });

  // Раніше повтори зберігались рядками — старі записи мають лишитись живими.
  it("розуміє старий формат зі сховища", () => {
    expect(parseRepeat("monthly")).toEqual({ every: 1, unit: "month" });
    expect(parseRepeat("daily")).toEqual({ every: 1, unit: "day" });
  });

  it("сміття не приймається", () => {
    expect(parseRepeat("щомісяця")).toBeNull();
    expect(parseRepeat({ every: 1, unit: "століття" })).toBeNull();
    expect(parseRepeat({ every: 0, unit: "day" })).toBeNull();
    expect(parseRepeat({ every: MAX_EVERY + 1, unit: "day" })).toBeNull();
    expect(parseRepeat(undefined)).toBeNull();
    expect(parseRepeat(42)).toBeNull();
  });
});

describe("повтор у відповіді моделі", () => {
  it("читається, коли вказаний", () => {
    const parsed = parseReminderReply(
      '{"when":"2026-08-29 09:00","what":"показники","repeat":{"every":1,"unit":"month"}}',
    );
    expect(parsed.repeat).toEqual({ every: 1, unit: "month" });
  });

  it("відсутній повтор лишається невизначеним", () => {
    const parsed = parseReminderReply('{"when":"2026-08-29 09:00","what":"здати звіт"}');
    expect(parsed.repeat).toBeUndefined();
  });

  it("вигадане моделлю значення ігнорується, а не ламає розбір", () => {
    const parsed = parseReminderReply(
      '{"when":"2026-08-29 09:00","what":"звіт","repeat":{"every":1,"unit":"квартал"}}',
    );
    expect(parsed.repeat).toBeUndefined();
    expect(parsed.what).toBe("звіт");
  });
});

// Мовчазний відступ доречний для нотатки зі словом «нагадування», але не
// тоді, коли людина прямо попросила: тоді тиша виглядає як поломка.
describe("сила наміру", () => {
  it("пряме прохання — сильний намір", () => {
    expect(reminderIntent("нагадай завтра о 9 здати звіт")).toBe("strong");
    expect(reminderIntent("не забудь у п'ятницю подзвонити")).toBe("strong");
    expect(reminderIntent("напомни про звіт")).toBe("strong");
  });

  it("«додай нагадування» — теж пряме прохання", () => {
    expect(reminderIntent("Додай нагадування через кожну хвилину.")).toBe("strong");
    expect(reminderIntent("постав нагадування на вівторок")).toBe("strong");
    expect(reminderIntent("створи нагадування")).toBe("strong");
  });

  it("саме слово посеред нотатки — слабкий намір", () => {
    expect(reminderIntent("26 серпня, 8:30, виконком, нагадування.")).toBe("weak");
    expect(reminderIntent("треба нагадати про показники")).toBe("weak");
  });

  it("минулий час і звичайні нотатки — не намір", () => {
    expect(reminderIntent("я нагадав йому про борг ще вчора")).toBe("none");
    expect(reminderIntent("перевірити показники по вулиці Озерна")).toBe("none");
    expect(reminderIntent("")).toBe("none");
  });
});
