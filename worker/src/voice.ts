/**
 * Команди голосом: «додай в довідник Кірпосенко», «яка завтра погода»,
 * «покажи витрати».
 *
 * Нагадування й списки мають власні, давніші гілки — вони дешевші й
 * докладніші. Цей шар підбирає все інше: те, задля чого досі доводилось
 * набирати команду руками.
 *
 * Перевірка «чи це взагалі команда» — за словами, без моделі: вона йде на
 * кожному записі, і зайвий виклик LLM коштував би грошей і секунди на
 * кожній розшифровці. Модель викликається лише тоді, коли в сказаному
 * справді є і предмет («довідник», «погода»), і дія («додай», «покажи»).
 */

import type { Env } from "./env";
import { OpenRouterError, complete, stripWrapper } from "./openrouter";
import { buildCommandPrompt } from "./prompts";
import type { UserSettings } from "./settings";

export class VoiceCommandError extends Error {}

/**
 * Що бот уміє на голос. Ключ — команда, значення — слова, за якими її
 * впізнають, і підказка для моделі про вигляд аргументу.
 *
 * `reset` тут свідомо немає. Скинути всі налаштування — дія без вороття,
 * а «скинь» легко почути там, де його не казали: ціна помилки розпізнавання
 * тут надто висока, тож ця команда лишається тільки для рук.
 */
export const VOICE_COMMANDS: Record<string, { words: string[]; hint: string }> = {
  glossary: {
    words: ["довідник", "довідника", "словник", "словника", "словнику", "глосарій"],
    hint: "«+ Назва» дописати, «- Назва» прибрати, порожньо — показати",
  },
  prompt: {
    words: ["побажання", "інструкція", "інструкцію", "промт", "промпт"],
    hint: "«+ текст» дописати, «-» очистити, порожньо — показати",
  },
  style: { words: ["стиль", "стилю", "режим", "режиму"], hint: "завжди порожньо" },
  model: { words: ["модель", "моделі", "моделлю"], hint: "слово для пошуку або порожньо" },
  vision: { words: ["фото", "знімк", "зображень"], hint: "слово для пошуку або порожньо" },
  weather: { words: ["погода", "погоду", "погоди"], hint: "назва міста або порожньо" },
  city: { words: ["місто", "міста", "місті"], hint: "назва міста" },
  rate: { words: ["курс", "курсу", "долар", "євро", "валют"], hint: "завжди порожньо" },
  expenses: { words: ["витрат", "чеки", "чеків"], hint: "завжди порожньо" },
  reminders: { words: ["нагадуванн"], hint: "завжди порожньо" },
  list: { words: ["списк", "список"], hint: "назва списку або порожньо" },
  birthday: {
    words: ["народженн", "іменин"],
    hint: "«31.12 Ім'я» додати, «- Ім'я» прибрати, порожньо — показати",
  },
  template: { words: ["шаблон", "шаблони", "бланк"], hint: "назва бланка або порожньо" },
  find: { words: ["знайди", "пошукай", "пошук"], hint: "слова для пошуку" },
  history: { words: ["історі", "останні записи"], hint: "завжди порожньо" },
  usage: { words: ["витрачено", "залишок", "баланс"], hint: "завжди порожньо" },
  settings: { words: ["налаштуванн"], hint: "завжди порожньо" },
  help: { words: ["довідка", "довідку", "що ти вмієш"], hint: "завжди порожньо" },
};

/** Дії, після яких предметне слово перестає бути просто згадкою. */
const ACTIONS = [
  "додай",
  "додати",
  "додайте",
  "допиши",
  "запиши",
  "запишіть",
  "внеси",
  "прибери",
  "приберіть",
  "видали",
  "видаліть",
  "очисти",
  "покажи",
  "покажіть",
  "показати",
  "виведи",
  "зміни",
  "змінити",
  "постав",
  "встанови",
  "перемкни",
  "вибери",
  "обери",
  "знайди",
  "пошукай",
  "переклади",
  "який",
  "яка",
  "яке",
  "які",
  "скільки",
  "де",
];

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Чи схоже сказане на команду боту. Потрібні обидві половини: предмет і
 * дія. Саме слово «модель» трапляється в нотатці про насос, а саме «додай»
 * — у проханні нагадати; разом вони вже означають звертання.
 */
export function commandIntent(text: string): string | null {
  const lowered = text.trim().toLowerCase();
  if (!lowered) return null;

  const words = lowered.split(WORD_SPLIT).filter(Boolean);
  if (!words.some((word) => ACTIONS.includes(word))) return null;

  for (const [command, spec] of Object.entries(VOICE_COMMANDS)) {
    if (spec.words.some((needle) => lowered.includes(needle))) return command;
  }
  return null;
}

export interface PlannedCommand {
  command: string;
  args: string;
}

export function parseCommandReply(raw: string): PlannedCommand {
  const cleaned = stripWrapper(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new VoiceCommandError("Не зрозумів команду.");
  }

  let payload: { command?: string; args?: string; error?: string };
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new VoiceCommandError("Не зрозумів команду.");
  }

  if (payload.error) throw new VoiceCommandError(payload.error);

  const command = (payload.command ?? "").trim().toLowerCase();
  // Перевіряємо за своїм переліком, а не довіряємо відповіді: модель цілком
  // може повернути «reset», якого їй навіть не пропонували.
  if (!Object.hasOwn(VOICE_COMMANDS, command)) {
    throw new VoiceCommandError("Не зрозумів, яку саме команду виконати.");
  }

  return { command, args: (payload.args ?? "").trim() };
}

export async function planCommand(
  env: Env,
  user: UserSettings,
  text: string,
): Promise<PlannedCommand> {
  let raw: string;
  try {
    raw = await complete(
      env,
      user.llmModel,
      [
        { role: "system", content: buildCommandPrompt(VOICE_COMMANDS) },
        { role: "user", content: `<request>\n${text}\n</request>` },
      ],
      0,
    );
  } catch (error) {
    throw error instanceof OpenRouterError ? new VoiceCommandError(error.message) : error;
  }

  return parseCommandReply(raw);
}
