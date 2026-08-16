/**
 * Дні народження й довідки без ключів: погода та курс валют.
 *
 * Обидві служби навмисно взяті такі, що не потребують реєстрації —
 * Open-Meteo й API Нацбанку віддають дані анонімно. Інакше розгортання
 * бота обросло б ще двома ключами заради дрібниць.
 */

import type { Env } from "./env";
import { localDay } from "./timezone";

// ── Дні народження ───────────────────────────────────────────────────────────

export interface Birthday {
  key: string;
  /** «12-31» — місяць і день. Рік окремо, бо його часто не знають. */
  when: string;
  name: string;
  year?: number;
}

interface StoredBirthday {
  name: string;
  year?: number;
}

const bdPrefix = (userId: number) => `bd:${userId}:`;

/** «31 грудня», «31.12», «31.12.1980» → «12-31» плюс рік, якщо назвали. */
export function parseBirthday(input: string): { when: string; year?: number } | null {
  const MONTHS = [
    "січ",
    "лют",
    "берез",
    "квіт",
    "трав",
    "черв",
    "лип",
    "серп",
    "верес",
    "жовт",
    "листоп",
    "груд",
  ];

  const numeric = /(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}))?/.exec(input);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        when: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        ...(numeric[3] ? { year: Number(numeric[3]) } : {}),
      };
    }
  }

  const worded = /(\d{1,2})\s+([\p{L}]+)/u.exec(input);
  if (worded) {
    const day = Number(worded[1]);
    const stem = (worded[2] ?? "").toLowerCase();
    const month = MONTHS.findIndex((name) => stem.startsWith(name)) + 1;
    if (month > 0 && day >= 1 && day <= 31) {
      const year = /(\d{4})/.exec(input.slice(worded.index + worded[0].length));
      return {
        when: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        ...(year ? { year: Number(year[1]) } : {}),
      };
    }
  }

  return null;
}

export async function saveBirthday(
  env: Env,
  userId: number,
  when: string,
  name: string,
  year?: number,
): Promise<void> {
  const value: StoredBirthday = { name, ...(year ? { year } : {}) };
  const id = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40);
  await env.SETTINGS.put(`${bdPrefix(userId)}${when}:${id}`, JSON.stringify(value));
}

export async function listBirthdays(env: Env, userId: number): Promise<Birthday[]> {
  const prefix = bdPrefix(userId);
  const listed = await env.SETTINGS.list({ prefix, limit: 200 });
  const found: Birthday[] = [];

  for (const entry of listed.keys) {
    const stored = await env.SETTINGS.get<StoredBirthday>(entry.name, "json");
    if (!stored?.name) continue;
    found.push({
      key: entry.name,
      when: entry.name.slice(prefix.length, prefix.length + 5),
      name: stored.name,
      ...(stored.year ? { year: stored.year } : {}),
    });
  }

  return found;
}

export async function deleteBirthday(env: Env, key: string): Promise<void> {
  await env.SETTINGS.delete(key);
}

/** Хто святкує в цей день. `day` — «2026-12-31». */
export async function birthdaysOn(
  env: Env,
  userId: number,
  day: string,
): Promise<Birthday[]> {
  const prefix = `${bdPrefix(userId)}${day.slice(5)}:`;
  const listed = await env.SETTINGS.list({ prefix, limit: 20 });
  const found: Birthday[] = [];

  for (const entry of listed.keys) {
    const stored = await env.SETTINGS.get<StoredBirthday>(entry.name, "json");
    if (!stored?.name) continue;
    found.push({
      key: entry.name,
      when: day.slice(5),
      name: stored.name,
      ...(stored.year ? { year: stored.year } : {}),
    });
  }

  return found;
}

/** Скільки виповнюється, якщо рік народження відомий. */
export function ageOn(day: string, year?: number): number | null {
  if (!year) return null;
  const age = Number(day.slice(0, 4)) - year;
  return age > 0 && age < 150 ? age : null;
}

/**
 * Позначка «за цей день уже привітали». Cron ходить щохвилини, а вітання
 * має бути одне: без неї о дев'ятій ранку прилетіло б шістдесят.
 */
export async function greetedToday(env: Env, userId: number, day: string): Promise<boolean> {
  const key = `bdsent:${userId}:${day}`;
  if (await env.SETTINGS.get(key)) return true;
  await env.SETTINGS.put(key, "1", { expirationTtl: 172_800 });
  return false;
}

/** Кому й коли розсилати вітання: о дев'ятій за місцевим часом. */
export function isGreetingTime(hour: number, minute: number): boolean {
  return hour === 9 && minute === 0;
}

// ── Курс валют ───────────────────────────────────────────────────────────────

const NBU_URL =
  "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";

export interface Rate {
  code: string;
  rate: number;
}

/** Основні курси Нацбанку. Без ключа, без реєстрації, оновлюються щодня. */
export async function fetchRates(codes = ["USD", "EUR", "PLN"]): Promise<Rate[]> {
  const response = await fetch(NBU_URL);
  if (!response.ok) throw new Error(`Нацбанк відповів ${response.status}`);

  const payload = (await response.json()) as { cc?: string; rate?: number }[];
  const wanted = new Set(codes);

  return payload
    .filter((item) => item.cc && wanted.has(item.cc) && typeof item.rate === "number")
    .map((item) => ({ code: item.cc!, rate: item.rate! }));
}

// ── Погода ───────────────────────────────────────────────────────────────────

export interface Forecast {
  city: string;
  today: { min: number; max: number; code: number };
  tomorrow: { min: number; max: number; code: number };
}

/** Опис погоди за кодом WMO — тим самим, що віддає Open-Meteo. */
export function weatherWord(code: number): string {
  if (code === 0) return "ясно";
  if (code <= 2) return "мінлива хмарність";
  if (code === 3) return "хмарно";
  if (code <= 48) return "туман";
  if (code <= 57) return "мряка";
  if (code <= 67) return "дощ";
  if (code <= 77) return "сніг";
  if (code <= 82) return "злива";
  if (code <= 86) return "сніг";
  return "гроза";
}

export async function fetchForecast(city: string, timeZone: string): Promise<Forecast> {
  const geo = await fetch(
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=uk&name=" +
      encodeURIComponent(city),
  );
  if (!geo.ok) throw new Error(`Пошук міста відповів ${geo.status}`);

  const places = (await geo.json()) as {
    results?: { latitude: number; longitude: number; name: string }[];
  };
  const place = places.results?.[0];
  if (!place) throw new Error(`Не знайшов міста «${city}»`);

  const forecast = await fetch(
    "https://api.open-meteo.com/v1/forecast?forecast_days=2" +
      "&daily=temperature_2m_min,temperature_2m_max,weather_code" +
      `&timezone=${encodeURIComponent(timeZone)}` +
      `&latitude=${place.latitude}&longitude=${place.longitude}`,
  );
  if (!forecast.ok) throw new Error(`Погода відповіла ${forecast.status}`);

  const data = (await forecast.json()) as {
    daily?: {
      temperature_2m_min?: number[];
      temperature_2m_max?: number[];
      weather_code?: number[];
      /** Стара назва того самого поля — Open-Meteo приймає обидві. */
      weathercode?: number[];
    };
  };

  const min = data.daily?.temperature_2m_min ?? [];
  const max = data.daily?.temperature_2m_max ?? [];
  const codes = data.daily?.weather_code ?? data.daily?.weathercode ?? [];
  if (min.length < 2 || max.length < 2) throw new Error("Прогноз повернувся неповним");

  return {
    city: place.name,
    today: { min: Math.round(min[0]!), max: Math.round(max[0]!), code: codes[0] ?? 0 },
    tomorrow: { min: Math.round(min[1]!), max: Math.round(max[1]!), code: codes[1] ?? 0 },
  };
}

/** Сьогоднішній день у зоні користувача — спільна дрібниця для обох. */
export function todayIn(timeZone: string): string {
  return localDay(new Date(), timeZone);
}
