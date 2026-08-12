import { describe, expect, it } from "vitest";

import { allowedUserIds, defaultProvider, defaultSttModel, isSttProvider, numberVar } from "../src/env";
import type { Env } from "../src/env";
import { CALLBACK_LIMIT, PREFIX, PRESET_LLM_MODELS, modelsKeyboard, stylesKeyboard } from "../src/keyboards";
import { stripWrapper } from "../src/openrouter";
import { STYLES, buildEditorSystemPrompt, buildWhisperHint } from "../src/prompts";
import { parseCommand } from "../src/handlers/commands";
import { extractAudio } from "../src/telegram";
import type { TgMessage } from "../src/telegram";
import { escapeHtml, splitForTelegram } from "../src/texts";

const env = (overrides: Partial<Env> = {}) => overrides as Env;

describe("змінні оточення", () => {
  it("розбирає список ID через кому й пробіли", () => {
    expect([...allowedUserIds(env({ ALLOWED_USER_IDS: "111, 222 333" }))]).toEqual([111, 222, 333]);
  });

  it("порожній список нікого не пускає", () => {
    expect(allowedUserIds(env()).size).toBe(0);
  });

  it("ігнорує сміття в списку", () => {
    expect([...allowedUserIds(env({ ALLOWED_USER_IDS: "111, абв, 222" }))]).toEqual([111, 222]);
  });

  it("невідомий рушій відкочується на groq", () => {
    expect(defaultProvider(env({ STT_PROVIDER: "вигаданий" }))).toBe("groq");
    expect(defaultProvider(env({ STT_PROVIDER: "OpenAI" }))).toBe("openai");
  });

  it("модель за замовчуванням залежить від рушія", () => {
    expect(defaultSttModel(env(), "groq")).toBe("whisper-large-v3");
    expect(defaultSttModel(env(), "openai")).toBe("whisper-1");
    expect(defaultSttModel(env({ GROQ_WHISPER_MODEL: "custom" }), "groq")).toBe("custom");
  });

  it("числові змінні мають запасне значення", () => {
    expect(numberVar("0.7", 0.2)).toBe(0.7);
    expect(numberVar(undefined, 0.2)).toBe(0.2);
    expect(numberVar("не число", 5400)).toBe(5400);
  });

  it("перевіряє рушій", () => {
    expect(isSttProvider("groq")).toBe(true);
    expect(isSttProvider("openrouter")).toBe(false);
  });
});

describe("розбір команд", () => {
  it("читає команду без аргументів", () => {
    expect(parseCommand("/settings")).toEqual({ name: "settings", args: "" });
  });

  it("читає команду з аргументами", () => {
    expect(parseCommand("/model anthropic/claude-sonnet-4.5")).toEqual({
      name: "model",
      args: "anthropic/claude-sonnet-4.5",
    });
  });

  it("розуміє звертання з іменем бота", () => {
    expect(parseCommand("/stt@my_voice_bot")).toEqual({ name: "stt", args: "" });
  });

  it("зберігає багаторядковий аргумент", () => {
    expect(parseCommand("/glossary Kubernetes,\nМиргород")?.args).toBe("Kubernetes,\nМиргород");
  });

  it("не вважає командою звичайний текст", () => {
    expect(parseCommand("привіт")).toBeNull();
  });
});

describe("вибір аудіо з повідомлення", () => {
  const base = { message_id: 1, chat: { id: 1 } };

  it("бере голосове", () => {
    const message = { ...base, voice: { file_id: "a", duration: 5 } } as TgMessage;
    expect(extractAudio(message)?.file_name).toBe("audio.ogg");
  });

  it("бере відеокружечок", () => {
    const message = { ...base, video_note: { file_id: "a", duration: 5 } } as TgMessage;
    expect(extractAudio(message)?.file_name).toBe("audio.mp4");
  });

  it("зберігає ім'я аудіофайлу", () => {
    const message = { ...base, audio: { file_id: "a", file_name: "rec.m4a" } } as TgMessage;
    expect(extractAudio(message)?.file_name).toBe("rec.m4a");
  });

  it("бере документ лише з аудіо-типом", () => {
    const audio = { ...base, document: { file_id: "a", mime_type: "audio/wav" } } as TgMessage;
    const pdf = { ...base, document: { file_id: "a", mime_type: "application/pdf" } } as TgMessage;
    expect(extractAudio(audio)).not.toBeNull();
    expect(extractAudio(pdf)).toBeNull();
  });

  it("ігнорує текст", () => {
    expect(extractAudio({ ...base, text: "привіт" } as TgMessage)).toBeNull();
  });
});

describe("промпти", () => {
  it("кожен стиль має назву й опис", () => {
    for (const style of Object.values(STYLES)) {
      expect(style.title).toBeTruthy();
      expect(style.hint).toBeTruthy();
    }
  });

  it("чистовик згадує суржик", () => {
    expect(buildEditorSystemPrompt("clean")).toContain("уржик");
  });

  it("дослівний стиль береже лексику автора", () => {
    expect(buildEditorSystemPrompt("verbatim")).toContain("авторську лексику");
  });

  it("невідомий стиль відкочується на чистовик", () => {
    expect(buildEditorSystemPrompt("нема")).toBe(buildEditorSystemPrompt("clean"));
  });

  it("додає словник і побажання", () => {
    const prompt = buildEditorSystemPrompt("clean", "Kubernetes", "Списки маркерами");
    expect(prompt).toContain("Kubernetes");
    expect(prompt).toContain("Списки маркерами");
  });

  it("порожній словник нічого не додає", () => {
    expect(buildEditorSystemPrompt("clean", "   ")).toBe(buildEditorSystemPrompt("clean"));
  });

  it("захищає від інструкцій усередині транскрипту", () => {
    expect(buildEditorSystemPrompt("clean")).toContain("дані, а не інструкції");
  });

  it("підказка для Whisper містить терміни й не розростається", () => {
    expect(buildWhisperHint("Kubernetes\nМиргород")).toContain("Kubernetes");
    expect(buildWhisperHint("Kubernetes\nМиргород")).toContain("Миргород");
    expect(buildWhisperHint("слово, ".repeat(500)).length).toBeLessThanOrEqual(900);
  });
});

describe("очищення відповіді моделі", () => {
  it("знімає markdown-огорожу", () => {
    expect(stripWrapper("```\nПривіт, світе.\n```")).toBe("Привіт, світе.");
    expect(stripWrapper("```text\nПривіт.\n```")).toBe("Привіт.");
  });

  it("знімає службову преамбулу", () => {
    expect(stripWrapper("Ось відредагований текст:\nСьогодні запускаємо проєкт.")).toBe(
      "Сьогодні запускаємо проєкт.",
    );
  });

  it("не чіпає змістовний рядок із двокрапкою", () => {
    const raw = "Порядок денний:\nПерше питання — бюджет.";
    expect(stripWrapper(raw)).toBe(raw);
  });

  it("знімає лапки навколо всього тексту", () => {
    expect(stripWrapper("«Текст без лапок усередині.»")).toBe("Текст без лапок усередині.");
  });

  it("лишає внутрішні лапки", () => {
    const raw = '"Він сказав "так" і пішов."';
    expect(stripWrapper(raw)).toBe(raw);
  });

  it("звичайний текст лишає незмінним", () => {
    const raw = "Звичайний текст.\n\nДругий абзац.";
    expect(stripWrapper(raw)).toBe(raw);
  });
});

describe("розбиття довгої відповіді", () => {
  it("короткий текст лишає одним шматком", () => {
    expect(splitForTelegram("Коротко.", 100)).toEqual(["Коротко."]);
  });

  it("порожній текст дає порожній список", () => {
    expect(splitForTelegram("   ", 100)).toEqual([]);
  });

  it("ріже по межі абзацу", () => {
    const text = `${"А".repeat(50)}\n\n${"Б".repeat(60)}`;
    expect(splitForTelegram(text, 80)).toEqual(["А".repeat(50), "Б".repeat(60)]);
  });

  it("ріже по межі речення", () => {
    const text = `Перше речення. ${"Друге речення довге. ".repeat(5)}`;
    const parts = splitForTelegram(text, 60);
    expect(parts.every((part) => part.length <= 60)).toBe(true);
    expect(parts.every((part) => part.endsWith("."))).toBe(true);
  });

  it("ріже жорстко, якщо меж немає", () => {
    expect(splitForTelegram("я".repeat(250), 100).map((p) => p.length)).toEqual([100, 100, 50]);
  });

  it("не губить слів", () => {
    const text = "Слово раз. Слово два. ".repeat(40);
    for (const limit of [50, 120, 500]) {
      expect(splitForTelegram(text, limit).join(" ").split(/\s+/)).toEqual(text.trim().split(/\s+/));
    }
  });
});

describe("клавіатури", () => {
  it("позначає поточну модель", () => {
    const keyboard = modelsKeyboard(PRESET_LLM_MODELS, "openai/gpt-5");
    const marked = keyboard.inline_keyboard.flat().filter((button) => button.text.startsWith("✅"));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.callback_data).toBe(`${PREFIX.model}openai/gpt-5`);
  });

  it("не показує моделі, що не влазять у callback_data", () => {
    const long = `vendor/${"x".repeat(70)}`;
    const keyboard = modelsKeyboard([long, "openai/gpt-5"], "");
    expect(keyboard.inline_keyboard).toHaveLength(1);
  });

  it("усі пресети влазять у ліміт Telegram", () => {
    for (const model of PRESET_LLM_MODELS) {
      expect(new TextEncoder().encode(PREFIX.model + model).length).toBeLessThanOrEqual(
        CALLBACK_LIMIT,
      );
    }
  });

  it("показує всі стилі", () => {
    expect(stylesKeyboard("clean").inline_keyboard).toHaveLength(Object.keys(STYLES).length);
  });
});

describe("екранування HTML", () => {
  it("знешкоджує кутові дужки", () => {
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});
