/**
 * Повторювані нагадування.
 *
 * Інтервал описується парою «скільки + чого», тож підтримуються і «щодня»,
 * і «кожні 3 хвилини», і «кожні 2 тижні» — окремий перелік видів такого не
 * вміщав би.
 */

import { localParts, zonedToUtc } from "./timezone";

export const REPEAT_UNITS = ["minute", "hour", "day", "week", "month", "year"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export interface Repeat {
  every: number;
  unit: RepeatUnit;
}

/** Cron прокидається раз на хвилину — частіше повторювати нема сенсу. */
export const MIN_EVERY = 1;
/** Захист від «кожні 100000 років» через помилку розпізнавання. */
export const MAX_EVERY = 999;

const SIMPLE_TITLES: Record<RepeatUnit, string> = {
  minute: "щохвилини",
  hour: "щогодини",
  day: "щодня",
  week: "щотижня",
  month: "щомісяця",
  year: "щороку",
};

/** Форми однини та множини: «1 хвилину», «2 хвилини», «5 хвилин». */
const FORMS: Record<RepeatUnit, [string, string, string]> = {
  minute: ["хвилину", "хвилини", "хвилин"],
  hour: ["годину", "години", "годин"],
  day: ["день", "дні", "днів"],
  week: ["тиждень", "тижні", "тижнів"],
  month: ["місяць", "місяці", "місяців"],
  year: ["рік", "роки", "років"],
};

/** «Кожну хвилину» проти «кожен день» — прикметник узгоджується з родом. */
const FEMININE: ReadonlySet<RepeatUnit> = new Set<RepeatUnit>(["minute", "hour"]);

function pluralForm(count: number): 0 | 1 | 2 {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

export function repeatTitle(repeat: Repeat): string {
  if (repeat.every === 1) return SIMPLE_TITLES[repeat.unit];

  const form = pluralForm(repeat.every);
  const word = FORMS[repeat.unit][form];
  // «кожен 21 день», але «кожні 22 дні» — узгоджуємо і число, і рід.
  const adjective =
    form === 0 ? (FEMININE.has(repeat.unit) ? "кожну" : "кожен") : "кожні";
  return `${adjective} ${repeat.every} ${word}`;
}

/** Розбирає значення з моделі або зі сховища. Старий формат — рядок виду "monthly". */
export function parseRepeat(value: unknown): Repeat | null {
  if (typeof value === "string") {
    const legacy: Record<string, RepeatUnit> = {
      daily: "day",
      weekly: "week",
      monthly: "month",
      yearly: "year",
      hourly: "hour",
      minutely: "minute",
    };
    const unit = legacy[value];
    return unit ? { every: 1, unit } : null;
  }

  if (typeof value !== "object" || value === null) return null;
  const raw = value as { every?: unknown; unit?: unknown };

  const unit = raw.unit;
  if (typeof unit !== "string" || !(REPEAT_UNITS as readonly string[]).includes(unit)) {
    return null;
  }

  const every = Math.round(Number(raw.every ?? 1));
  if (!Number.isFinite(every) || every < MIN_EVERY || every > MAX_EVERY) return null;

  return { every, unit: unit as RepeatUnit };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (value: number) => String(value).padStart(2, "0");
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Зсув на `count` періодів уперед. */
function addPeriods(
  from: number,
  repeat: Repeat,
  count: number,
  timeZone: string,
): number | null {
  const step = repeat.every * count;

  // Хвилини й години — це проміжки реального часу, тож рахуються прямо.
  // Доба й довші — настінний час: «щодня о 9:00» має лишатись о 9:00 і
  // після переходу на зимовий, хоча доба тоді триває 25 годин.
  if (repeat.unit === "minute") return from + step * MINUTE_MS;
  if (repeat.unit === "hour") return from + step * HOUR_MS;

  const parts = localParts(new Date(from), timeZone);
  let { year, month } = parts;
  let day = parts.day;

  switch (repeat.unit) {
    case "day":
    case "week": {
      const days = repeat.unit === "day" ? step : step * 7;
      const shifted = new Date(Date.UTC(year, month - 1, day + days));
      year = shifted.getUTCFullYear();
      month = shifted.getUTCMonth() + 1;
      day = shifted.getUTCDate();
      break;
    }
    case "month": {
      const total = year * 12 + (month - 1) + step;
      year = Math.floor(total / 12);
      month = (total % 12) + 1;
      day = Math.min(day, daysInMonth(year, month));
      break;
    }
    case "year": {
      year += step;
      day = Math.min(day, daysInMonth(year, month));
      break;
    }
  }

  const next = zonedToUtc(
    `${year}-${pad(month)}-${pad(day)} ${pad(parts.hour)}:${pad(parts.minute)}`,
    timeZone,
  );
  return next ? next.getTime() : null;
}

/**
 * Наступне спрацювання після `from`.
 *
 * Для місячних і річних повторів число підтягується до останнього дня
 * місяця, якщо такого числа немає: «щомісяця 31-го» у лютому стане 28-м, а
 * не поїде на березень.
 */
export function nextOccurrence(
  from: number,
  repeat: Repeat,
  timeZone: string,
): number | null {
  return addPeriods(from, repeat, 1, timeZone);
}

/** Груба оцінка, скільки періодів минуло — щоб не крокувати їх по одному. */
function elapsedPeriods(
  from: number,
  repeat: Repeat,
  timeZone: string,
  now: number,
): number {
  if (now <= from) return 0;

  const fixed: Partial<Record<RepeatUnit, number>> = {
    minute: MINUTE_MS,
    hour: HOUR_MS,
    day: DAY_MS,
    week: 7 * DAY_MS,
  };
  const span = fixed[repeat.unit];
  if (span) return Math.floor((now - from) / (span * repeat.every));

  const a = localParts(new Date(from), timeZone);
  const b = localParts(new Date(now), timeZone);
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  const raw = repeat.unit === "month" ? months : b.year - a.year;
  return Math.floor(raw / repeat.every);
}

/**
 * Наступне спрацювання, що точно в майбутньому.
 *
 * Пропущені періоди перестрибуємо одним обчисленням, а не циклом: щохвилинне
 * нагадування за добу простою дало б понад тисячу кроків, а кожен крок для
 * добових і довших інтервалів звертається до Intl — тобто з'їдає процесорний
 * час, якого на вільному тарифі лише 10 мс.
 */
export function nextAfter(
  from: number,
  repeat: Repeat,
  timeZone: string,
  now: number,
): number | null {
  const jump = Math.max(0, elapsedPeriods(from, repeat, timeZone, now));
  let candidate = addPeriods(from, repeat, jump, timeZone);

  // Оцінка може недобрати кілька періодів через переходи часу й різну
  // довжину місяців — дошліфовуємо кроками.
  for (let guard = 0; guard < 24 && candidate !== null && candidate <= now; guard += 1) {
    candidate = addPeriods(candidate, repeat, 1, timeZone);
  }
  return candidate !== null && candidate > now ? candidate : null;
}
