/**
 * Локальний час користувача.
 *
 * Фіксований зсув тут не годиться: Україна взимку на UTC+2, влітку на UTC+3.
 * Тому зсув щоразу питаємо у Intl для конкретної дати.
 */

export const DEFAULT_TIMEZONE = "Europe/Kyiv";

const WEEKDAYS: Record<string, string> = {
  Monday: "понеділок",
  Tuesday: "вівторок",
  Wednesday: "середа",
  Thursday: "четвер",
  Friday: "п'ятниця",
  Saturday: "субота",
  Sunday: "неділя",
};

function partsIn(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

/** Наскільки локальний час зони випереджає UTC у цю мить, у мілісекундах. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = partsIn(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Опівночі деякі реалізації віддають 24 замість 0.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  // Мілісекунди Intl не віддає, тож рівняємо на цілі секунди.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * «2026-08-19 09:00» як настінний час у зоні → момент часу.
 *
 * Рахуємо у два наближення: перше може промахнутись на годину, якщо дата
 * припадає на перехід на літній час, друге це виправляє.
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(local.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const naive = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (!Number.isFinite(naive)) return null;

  let guess = new Date(naive - tzOffsetMs(new Date(naive), timeZone));
  guess = new Date(naive - tzOffsetMs(guess, timeZone));
  return Number.isNaN(guess.getTime()) ? null : guess;
}

/** Складові локального часу — потрібні, щоб рахувати «те саме число наступного місяця». */
export function localParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = partsIn(date, timeZone);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** Локальна дата як «2026-08-19» — ключ для добових підсумків. */
export function localDay(date: Date, timeZone: string): string {
  const parts = partsIn(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Момент часу → «19.08.2026, 09:00» у зоні користувача. */
export function formatLocal(date: Date, timeZone: string): string {
  const parts = partsIn(date, timeZone);
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** Контекст «зараз» для моделі, яка розбирає фрази на кшталт «у вівторок». */
export function localNow(
  date: Date,
  timeZone: string,
): { stamp: string; weekday: string } {
  const parts = partsIn(date, timeZone);
  return {
    stamp: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[parts.weekday ?? ""] ?? parts.weekday ?? "",
  };
}
