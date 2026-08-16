import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import {
  findByStamp,
  historyKey,
  indexWords,
  recent,
  remember,
  search,
  stampOf,
} from "../src/history";

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

const USER = 42;
const DAY = 86_400_000;
const BASE = Date.parse("2026-06-01T09:00:00Z");

let kv: FakeKV;
let env: Env;

beforeEach(() => {
  kv = new FakeKV();
  env = { SETTINGS: kv } as unknown as Env;
});

const add = (text: string, dayOffset: number, kind: "voice" | "photo" = "voice") =>
  remember(env, USER, { kind, text }, BASE + dayOffset * DAY);

describe("покажчик слів", () => {
  it("нормалізує й прибирає повтори", () => {
    expect(indexWords("Показники, показники ПОКАЗНИКИ по Гаркушенцях")).toEqual([
      "показники",
      "гаркушенцях",
    ]);
  });

  // Короткі слова — це «про», «для», «але»: місця в ключі з'їдають багато,
  // а шукати за ними ніхто не буде.
  it("короткі слова не індексуються", () => {
    expect(indexWords("це про акт на дім")).toEqual([]);
  });

  it("числа лишаються — за показниками теж шукають", () => {
    expect(indexWords("лічильник 40538909 пломба")).toContain("40538909");
  });

  it("порядок слів зберігається: початок запису інформативніший", () => {
    expect(indexWords("перше друге третє")).toEqual(["перше", "друге", "третє"]);
  });
});

describe("ключ запису", () => {
  it("вміщається в стелю KV навіть для довгого тексту", () => {
    const long = Array.from({ length: 500 }, (_, index) => `слово${index}`).join(" ");
    const key = historyKey(USER, BASE, long);
    expect(new TextEncoder().encode(key).length).toBeLessThanOrEqual(512);
  });

  it("час іде першим, тож ключі сортуються за датою", () => {
    const older = historyKey(USER, BASE, "аааа");
    const newer = historyKey(USER, BASE + DAY, "аааа");
    expect(older < newer).toBe(true);
  });

  it("час дістається з ключа для кнопки", () => {
    expect(stampOf(historyKey(USER, BASE, "показники"))).toHaveLength(12);
  });
});

describe("останні записи", () => {
  it("найновіші згори", async () => {
    await add("найдавніше", 0);
    await add("посередині", 1);
    await add("найсвіжіше", 2);

    const items = await recent(env, USER);
    expect(items.map((item) => item.text)).toEqual([
      "найсвіжіше",
      "посередині",
      "найдавніше",
    ]);
  });

  it("порожній текст не зберігається", async () => {
    await add("   ", 0);
    expect(await recent(env, USER)).toHaveLength(0);
  });

  it("чужі записи не видно", async () => {
    await add("моє", 0);
    await remember(env, 77, { kind: "voice", text: "чуже" }, BASE);
    expect((await recent(env, USER)).map((item) => item.text)).toEqual(["моє"]);
  });

  it("тип запису зберігається", async () => {
    await add("акт про обстеження", 0, "photo");
    expect((await recent(env, USER))[0]?.kind).toBe("photo");
  });
});

describe("пошук", () => {
  beforeEach(async () => {
    await add("перевірити показники по вулиці Озерна в Гаркушенцях", 0);
    await add("нарада у Великій Багачці щодо водовідведення", 1);
    await add("Кірпосенко передав показники лічильника 40538909", 2);
  });

  it("знаходить за словом", async () => {
    const found = await search(env, USER, "показники");
    expect(found).toHaveLength(2);
  });

  // Українська відмінює все, тож точний збіг знаходив би від сили половину.
  it("корінь слова знаходить усі відмінки", async () => {
    expect(await search(env, USER, "гаркушенц")).toHaveLength(1);
    expect(await search(env, USER, "багачц")).toHaveLength(1);
  });

  it("кілька слів звужують пошук", async () => {
    const found = await search(env, USER, "показники Кірпосенко");
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toContain("Кірпосенко");
  });

  it("знаходить за числом", async () => {
    expect(await search(env, USER, "40538909")).toHaveLength(1);
  });

  it("найсвіжіші згори", async () => {
    const found = await search(env, USER, "показники");
    expect(found[0]?.text).toContain("Кірпосенко");
  });

  it("нічого не знайшлось — порожньо, а не помилка", async () => {
    expect(await search(env, USER, "полтава")).toEqual([]);
  });

  it("порожній запит нічого не повертає", async () => {
    expect(await search(env, USER, "  ")).toEqual([]);
  });

  it("у чужій історії не шукає", async () => {
    expect(await search(env, 77, "показники")).toEqual([]);
  });
});

// Перепрогін тим самим записом — це та сама подія, а не нова. Інакше після
// трьох спроб із різними моделями пошук показував би три майже однакові
// рядки замість одного.
describe("повторний прогін", () => {
  it("переписує ту саму позицію, а не додає нову", async () => {
    await remember(env, USER, { kind: "voice", text: "перша спроба", sourceId: "AUDIO-1" }, BASE);
    await remember(
      env,
      USER,
      { kind: "voice", text: "друга спроба", sourceId: "AUDIO-1" },
      BASE + 60_000,
    );

    const items = await recent(env, USER);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("друга спроба");
  });

  it("різні записи лишаються різними", async () => {
    await remember(env, USER, { kind: "voice", text: "перше", sourceId: "AUDIO-1" }, BASE);
    await remember(env, USER, { kind: "voice", text: "друге", sourceId: "AUDIO-2" }, BASE + 60_000);

    expect(await recent(env, USER)).toHaveLength(2);
  });
});

describe("розгортання запису з кнопки", () => {
  it("знаходиться за часом із ключа", async () => {
    await add("нарада у Великій Багачці", 0);
    const [item] = await recent(env, USER);

    const opened = await findByStamp(env, USER, stampOf(item!.key));
    expect(opened?.text).toBe("нарада у Великій Багачці");
  });

  it("чужий запис за тим самим часом не відкриється", async () => {
    await remember(env, 77, { kind: "voice", text: "чуже" }, BASE);
    const stamp = stampOf(historyKey(77, BASE, "чуже"));

    expect(await findByStamp(env, USER, stamp)).toBeNull();
  });

  it("сміття замість часу — це null", async () => {
    expect(await findByStamp(env, USER, "abc")).toBeNull();
  });
});
