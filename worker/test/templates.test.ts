import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { CALLBACK_LIMIT, PREFIX, templatesKeyboard, voiceResultKeyboard } from "../src/keyboards";
import {
  MAX_BODY_LENGTH,
  buildTemplateSystemPrompt,
  buildTemplateUserMessage,
  hasTemplates,
  listTemplates,
  loadTemplate,
  nameTooLong,
  saveTemplate,
  templateId,
} from "../src/templates";
import type { TgCallbackQuery, TgMessage } from "../src/telegram";

const complete = vi.hoisted(() =>
  vi.fn(
    async (
      _env: unknown,
      _model: string,
      _messages: { content: string }[],
      _temperature: number,
    ) => "АКТ обстеження\nДата: 15.08.2026",
  ),
);

vi.mock("../src/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/openrouter")>()),
  complete,
}));

const { handleCallback } = await import("../src/handlers/callbacks");
const { handleCommand } = await import("../src/handlers/commands");
const { saveLastTranscript, saveLastJob, loadLastDocument } = await import("../src/settings");

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

function fakeTelegram() {
  const sent: string[] = [];
  const edits: string[] = [];
  const alerts: string[] = [];
  let messageId = 0;
  return {
    sent,
    edits,
    alerts,
    client: {
      sendMessage: vi.fn(async (chatId: number, text: string) => {
        sent.push(text);
        return { message_id: ++messageId, chat: { id: chatId } };
      }),
      editMessage: vi.fn(async (_chatId: number, _id: number, text: string) => {
        edits.push(text);
      }),
      answerCallback: vi.fn(async (_id: string, text?: string) => {
        if (text) alerts.push(text);
      }),
      sendChatAction: vi.fn(async () => undefined),
      editKeyboard: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined),
    },
  };
}

const USER = 42;
const CHAT = 100;
const FORM = "АКТ обстеження\nДата: \nАдреса: \nЛічильник № \nВисновок:";

let env: Env;
let tg: ReturnType<typeof fakeTelegram>;

beforeEach(() => {
  env = {
    SETTINGS: new FakeKV(),
    LLM_MODEL: "google/gemini-2.5-flash",
    TIMEZONE: "Europe/Kyiv",
  } as unknown as Env;
  tg = fakeTelegram();
  complete.mockClear();
});

const press = (data: string): TgCallbackQuery =>
  ({
    id: "cb",
    from: { id: USER },
    data,
    message: { message_id: 5, chat: { id: CHAT } },
  }) as TgCallbackQuery;

const message = () => ({ message_id: 1, chat: { id: CHAT } }) as TgMessage;

const command = (args: string) =>
  handleCommand(env, tg.client as never, message(), USER, "template", args);

describe("зберігання бланків", () => {
  it("назва й тіло розділені переносом рядка", async () => {
    await command(`акт обстеження\n${FORM}`);

    const saved = await listTemplates(env, USER);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe("акт обстеження");
    expect(saved[0]?.body).toBe(FORM);
  });

  it("той самий бланк переписується, а не дублюється", async () => {
    await command("акт\nперша версія");
    await command("акт\nдруга версія");

    const saved = await listTemplates(env, USER);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.body).toBe("друга версія");
  });

  // Без тіла це прохання показати наявний бланк, а не зберегти порожній.
  it("сама назва показує збережене", async () => {
    await command(`акт\n${FORM}`);
    tg.sent.length = 0;

    await command("акт");
    expect(tg.sent[0]).toContain("Лічильник");
  });

  it("невідома назва без тіла підказує формат", async () => {
    await command("невідоме");
    expect(tg.sent[0]).toContain("з нового рядка має йти сам бланк");
  });

  it("прибирається за назвою", async () => {
    await command(`акт\n${FORM}`);
    await command("- акт");

    expect(await listTemplates(env, USER)).toHaveLength(0);
  });

  it("задовгий бланк не приймається", async () => {
    await command(`акт\n${"я".repeat(MAX_BODY_LENGTH + 1)}`);

    expect(await listTemplates(env, USER)).toHaveLength(0);
    expect(tg.sent.at(-1)).toContain("задовгий");
  });

  it("бланки в кожного свої", async () => {
    await command(`акт\n${FORM}`);
    expect(await listTemplates(env, 77)).toHaveLength(0);
  });

  it("без жодного бланка команда пояснює, як додати", async () => {
    await command("");
    expect(tg.sent[0]).toContain("Свій бланк плюс надиктовані обставини");
  });
});

// Ідентифікатор їде в callback_data, де всього 64 байти, а кирилиця важить
// удвічі. Задовга назва просто не вміститься в кнопку.
describe("ідентифікатор бланка", () => {
  it("робиться з назви й лишається читабельним", () => {
    expect(templateId("Акт Обстеження")).toBe("акт-обстеження");
  });

  it("розділові знаки не потрапляють у ключ", () => {
    expect(templateId("акт: обстеження, 2026!")).toBe("акт-обстеження-2026");
  });

  it("довгі назви відхиляються", () => {
    expect(nameTooLong("акт")).toBe(false);
    expect(nameTooLong("акт обстеження вузла обліку холодної води")).toBe(true);
  });

  it("кнопка вміщається в ліміт Telegram", async () => {
    const saved = await saveTemplate(env, USER, "акт обстеження", FORM);
    const data = PREFIX.templateFill + saved.id;
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(CALLBACK_LIMIT);
  });

  it("те, що в кнопку не влізло, у переліку не показується", () => {
    const keyboard = templatesKeyboard([
      { id: "акт", title: "акт" },
      { id: "я".repeat(60), title: "задовгий" },
    ]);
    expect(keyboard.inline_keyboard).toHaveLength(1);
  });
});

describe("промпт заповнення", () => {
  it("бланк і запис подаються окремо", () => {
    const body = buildTemplateUserMessage(FORM, "надиктоване");
    expect(body).toContain("<form>");
    expect(body).toContain("<source>");
  });

  // Порожнє місце в документі гірше за чесну позначку: за ним не видно,
  // чи забули заповнити, чи даних справді не було.
  it("вимагає позначати те, чого в записі немає", () => {
    expect(buildTemplateSystemPrompt()).toContain("[не вказано]");
  });

  it("забороняє переписувати сам бланк", () => {
    expect(buildTemplateSystemPrompt()).toContain("Ти заповнюєш його, а не переписуєш");
  });

  it("словник підмішується, коли він є", () => {
    expect(buildTemplateSystemPrompt("Кірпосенко")).toContain("Кірпосенко");
    expect(buildTemplateSystemPrompt()).not.toContain("пиши їх саме так");
  });
});

describe("кнопка «за шаблоном»", () => {
  beforeEach(async () => {
    await saveTemplate(env, USER, "акт", FORM);
  });

  it("заповнює бланк надиктованим", async () => {
    await saveLastTranscript(env, USER, "обстежили лічильник на Озерній 15 серпня");
    await saveLastJob(env, USER, { kind: "voice", fileId: "AUDIO-1" });

    await handleCallback(env, tg.client as never, press(`${PREFIX.templateFill}акт`));

    expect(complete).toHaveBeenCalledTimes(1);
    const messages = complete.mock.calls[0]?.[2] ?? [];
    expect(messages[1]?.content).toContain("Озерній");
    expect(messages[1]?.content).toContain("Лічильник");
    expect(tg.edits.at(-1)).toContain("АКТ обстеження");
  });

  // Той самий бланк має заповнюватись і з фотографії паперового акта.
  it("після знімка джерелом стає зчитане з нього", async () => {
    await saveLastTranscript(env, USER, "давня розшифровка");
    await saveLastJob(env, USER, { kind: "photo", fileId: "PHOTO-1" });
    await env.SETTINGS.put(`doc:${USER}`, "зчитано з паперового акта");

    await handleCallback(env, tg.client as never, press(`${PREFIX.templateFill}акт`));

    const messages = complete.mock.calls[0]?.[2] ?? [];
    expect(messages[1]?.content).toContain("паперового акта");
    expect(messages[1]?.content).not.toContain("давня розшифровка");
  });

  it("заповнений бланк лягає під кнопку «у таблицю»", async () => {
    await saveLastTranscript(env, USER, "обстеження");
    await saveLastJob(env, USER, { kind: "voice", fileId: "AUDIO-1" });

    await handleCallback(env, tg.client as never, press(`${PREFIX.templateFill}акт`));

    expect(await loadLastDocument(env, USER)).toContain("АКТ обстеження");
  });

  it("без надиктованого нічого не заповнює", async () => {
    await handleCallback(env, tg.client as never, press(`${PREFIX.templateFill}акт`));

    expect(complete).not.toHaveBeenCalled();
    expect(tg.alerts.at(-1)).toContain("Нема з чого заповнювати");
  });

  it("прибраний бланк із застарілої кнопки нічого не робить", async () => {
    await saveLastTranscript(env, USER, "обстеження");
    await handleCallback(env, tg.client as never, press(`${PREFIX.templateFill}немає`));

    expect(complete).not.toHaveBeenCalled();
  });
});

describe("кнопка з'являється лише за наявності бланків", () => {
  it("порожньому користувачу її не показуємо", async () => {
    expect(await hasTemplates(env, USER)).toBe(false);

    const keyboard = voiceResultKeyboard("", "");
    expect(
      keyboard.inline_keyboard.flat().some((button) => button.callback_data.endsWith("t")),
    ).toBe(false);
  });

  it("щойно бланк з'явився — кнопка теж", async () => {
    await saveTemplate(env, USER, "акт", FORM);
    expect(await hasTemplates(env, USER)).toBe(true);

    const keyboard = voiceResultKeyboard("", "📄 За шаблоном");
    expect(
      keyboard.inline_keyboard.flat().some((button) => button.callback_data === `${PREFIX.redoOpen}t`),
    ).toBe(true);
  });
});

describe("окремий бланк у сховищі", () => {
  it("читається за ідентифікатором", async () => {
    await saveTemplate(env, USER, "Акт Обстеження", FORM);
    const loaded = await loadTemplate(env, USER, "акт-обстеження");

    expect(loaded?.title).toBe("Акт Обстеження");
    expect(loaded?.body).toBe(FORM);
  });

  it("неіснуючий — це null", async () => {
    expect(await loadTemplate(env, USER, "немає")).toBeNull();
  });
});
