/**
 * Повторювані нагадування.
 *
 * Наступна дата рахується в локальному часі користувача, а не додаванням
 * фіксованої кількості мілісекунд: інакше «щодня о 9:00» після переходу на
 * зимовий час почало б приходити о 8:00.
 */

import { localParts, zonedToUtc } from "./timezone";

export const REPEAT_KINDS = ["daily", "weekly", "monthly", "yearly"] as const;
export type RepeatKind = (typeof REPEAT_KINDS)[number];

export const REPEAT_TITLES: Record<RepeatKind, string> = {
  daily: "щодня",
  weekly: "щотижня",
  monthly: "щомісяця",
  yearly: "щороку",
};

export function isRepeatKind(value: unknown): value is RepeatKind {
  return typeof value === "string" && (REPEAT_KINDS as readonly string[]).includes(value);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Наступне спрацювання після `from`.
 *
 * Для місячних і річних повторів число місяця підтягується до останнього
 * дня, якщо такого числа немає: «щомісяця 31-го» у лютому стане 28-м, а не
 * поїде на березень.
 */
/** Зсув на `count` періодів уперед у локальному часі. */
function addPeriods(
  from: number,
  repeat: RepeatKind,
  count: number,
  timeZone: string,
): number | null {
  const parts = localParts(new Date(from), timeZone);
  let { year, month } = parts;
  let day = parts.day;

  switch (repeat) {
    case "daily":
    case "weekly": {
      // Через UTC-арифметику, щоб не морочитися з переходом через місяць.
      const step = repeat === "daily" ? 1 : 7;
      const shifted = new Date(Date.UTC(year, month - 1, day + step * count));
      year = shifted.getUTCFullYear();
      month = shifted.getUTCMonth() + 1;
      day = shifted.getUTCDate();
      break;
    }
    case "monthly": {
      const total = year * 12 + (month - 1) + count;
      year = Math.floor(total / 12);
      month = (total % 12) + 1;
      day = Math.min(day, daysInMonth(year, month));
      break;
    }
    case "yearly": {
      year += count;
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
 * Для місячних і річних повторів число місяця підтягується до останнього
 * дня, якщо такого числа немає: «щомісяця 31-го» у лютому стане 28-м, а не
 * поїде на березень.
 */
export function nextOccurrence(
  from: number,
  repeat: RepeatKind,
  timeZone: string,
): number | null {
  return addPeriods(from, repeat, 1, timeZone);
}

const DAY_MS = 86_400_000;

/** Груба оцінка, скільки періодів минуло — щоб не крокувати їх по одному. */
function elapsedPeriods(
  from: number,
  repeat: RepeatKind,
  timeZone: string,
  now: number,
): number {
  if (now <= from) return 0;

  if (repeat === "daily" || repeat === "weekly") {
    const step = repeat === "daily" ? DAY_MS : 7 * DAY_MS;
    return Math.floor((now - from) / step);
  }

  const a = localParts(new Date(from), timeZone);
  const b = localParts(new Date(now), timeZone);
  return repeat === "monthly"
    ? (b.year - a.year) * 12 + (b.month - a.month)
    : b.year - a.year;
}

/**
 * Наступне спрацювання, що точно в майбутньому.
 *
 * Пропущені періоди перестрибуємо одним обчисленням, а не циклом: щоденне
 * нагадування, створене кілька років тому, потребувало б тисяч кроків, а
 * кожен крок — це звернення до Intl, тобто процесорний час, якого на
 * вільному тарифі лише 10 мс.
 */
export function nextAfter(
  from: number,
  repeat: RepeatKind,
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
