/** Тексти інтерфейсу (українською). */

import { PROVIDER_TITLES } from "./env";
import { STYLES } from "./prompts";
import type { UserSettings } from "./settings";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const START =
  "👋 Привіт! Я перетворюю надиктоване на охайний текст.\n\n" +
  "Надішли мені <b>голосове повідомлення</b>, аудіофайл або відеокружечок — " +
  "у відповідь отримаєш готовий текст: без «е-е», повторів, обмовок і слів-паразитів, " +
  "із пунктуацією та абзацами.\n\n" +
  "Розрахований на українську мову й суржик; англійські назви та терміни " +
  "лишаються латиницею.\n\n" +
  "Що можна налаштувати — /settings";

export const HELP =
  "<b>Як користуватись</b>\n" +
  "Просто надішли голосове, аудіофайл (mp3, m4a, ogg, wav…) або відеокружечок.\n\n" +
  "<b>Команди</b>\n" +
  "/settings — поточні налаштування\n" +
  "/model — модель для обробки тексту\n" +
  "/style — режим обробки: розшифровка або генерація промтів\n" +
  "/stt — рушій розпізнавання мови\n" +
  "/glossary — імена й терміни, які треба писати правильно\n" +
  "/prompt — додаткові побажання до обробки\n" +
  "/reset — скинути все до типових значень\n\n" +
  "<b>Два режими.</b> За замовчуванням я записую сказане охайно й нічого не " +
  "додаю. У режимах генерації (/style) навпаки — розгортаю надиктовану ідею " +
  "в готовий промт для відео чи зображення, дописуючи освітлення, план, " +
  "настрій і деталі, яких ви не називали.\n\n" +
  "<b>Порада.</b> Якщо в записах регулярно звучать прізвища, назви компаній чи " +
  "технічні терміни — додай їх у /glossary. Це помітно підвищує точність, бо " +
  "підказка йде і в розпізнавання, і в обробку.";

export const NO_ACCESS = (userId: number) =>
  "🔒 Цей бот приватний.\n\n" +
  `Твій Telegram ID: <code>${userId}</code>\n` +
  "Якщо це твій бот — додай цей ID у <code>ALLOWED_USER_IDS</code> " +
  "у файлі wrangler.toml і виконай <code>npx wrangler deploy</code>.";

export const NOT_AUDIO =
  "Я обробляю тільки аудіо. Надішли голосове повідомлення, аудіофайл " +
  "або відеокружечок 🎙";

export const STATUS_TRANSCRIBING = "🎧 Розпізнаю мовлення…";
export const STATUS_CLEANING = "✨ Причісую текст…";
export const STATUS_GENERATING = "🎨 Складаю промт…";
export const EMPTY_RESULT = "🤷 У записі не вдалося розібрати жодного слова.";

export const ERROR_TOO_LONG = (duration: number, limit: number) =>
  `⏱ Запис задовгий: ${duration} хв, а ліміт — ${limit} хв. ` +
  "Надішли коротшим фрагментом.";

export const ERROR_TOO_BIG =
  "📦 Telegram не дає ботам завантажувати файли більші за 20 МБ. " +
  "Стисни запис або наріж на частини.";

export const ERROR_GENERIC = (error: string) =>
  `⚠️ Не вдалося обробити запис.\n\n<code>${escapeHtml(error)}</code>`;

export const SETTINGS_SAVED = "✅ Збережено.";
export const RESET_DONE = "♻️ Налаштування скинуто до типових.";
export const STALE_CHOICE = "Список застарів — виклич команду ще раз.";

export const GLOSSARY_HELP = (current: string) =>
  "<b>Словник власних назв</b>\n\n" +
  "Перелічи через кому або з нового рядка імена, назви й терміни, які " +
  "звучать у твоїх записах — я писатиму їх правильно.\n\n" +
  "Приклад:\n" +
  "<code>/glossary Кириленко, ТОВ «Миргородводоканал», Kubernetes</code>\n\n" +
  "Очистити: <code>/glossary -</code>\n\n" +
  `Зараз: ${current}`;

export const PROMPT_HELP = (current: string) =>
  "<b>Додаткові побажання</b>\n\n" +
  "Можна дописати власну інструкцію для редагування — вона додається до " +
  "стандартних правил.\n\n" +
  "Приклад:\n" +
  "<code>/prompt Оформлюй списки маркерами</code>\n\n" +
  "Очистити: <code>/prompt -</code>\n\n" +
  `Зараз: ${current}`;

export const GLOSSARY_FULL = (total: number) =>
  `📖 Термінів: ${total}. Усі використовуються і в розпізнаванні, і в редагуванні.`;

export const GLOSSARY_TRUNCATED = (kept: number, total: number) =>
  `⚠️ Термінів: ${total}, але в <b>розпізнавання</b> вміщаються лише перші ${kept} — ` +
  "рушій обмежує довжину підказки.\n" +
  `Решта ${total - kept} впливають лише на <b>редагування</b> тексту. ` +
  "Щоб усі працювали на розпізнавання, перенесіть найважливіші назви на початок " +
  "або скоротіть список.";

export const MODEL_HELP = (current: string) =>
  "<b>Модель обробки тексту</b>\n\n" +
  "Обери зі списку нижче або знайди будь-яку модель OpenRouter:\n" +
  "<code>/model gemini</code>, <code>/model claude</code>\n\n" +
  "Щоб задати точний ідентифікатор:\n" +
  "<code>/model anthropic/claude-sonnet-4.5</code>\n\n" +
  `Зараз: <code>${escapeHtml(current)}</code>`;

export const NO_MATCHES = (query: string) =>
  `Нічого не знайшов за запитом «${escapeHtml(query)}». Спробуй інше слово.`;

export const MODEL_UNKNOWN = (model: string) =>
  `⚠️ Моделі <code>${escapeHtml(model)}</code> немає в каталозі OpenRouter. ` +
  "Перевір ідентифікатор на openrouter.ai/models";

export const STT_PICK = (current: string) =>
  `<b>Рушій розпізнавання мови</b>\n\nЗараз: ${escapeHtml(current)}`;

export const STT_NO_KEY =
  "⚠️ Для цього рушія не заданий API-ключ. Додай його командою " +
  "wrangler secret put і зроби deploy.";

export const STYLE_PICK = (current: string) =>
  "<b>Режим обробки</b>\n\n" +
  "✍️ <b>Розшифровка</b> — записує сказане охайно, нічого не додаючи.\n" +
  "🎬🖼📝 <b>Генерація</b> — навпаки, розгортає надиктовану ідею й свідомо " +
  "додає деталі, яких ви не називали.\n\n" +
  `Зараз: ${escapeHtml(current)}`;

export function renderSettings(user: UserSettings): string {
  const style = STYLES[user.style] ?? STYLES.clean!;
  return [
    "<b>Поточні налаштування</b>",
    "",
    `🎧 Розпізнавання: ${PROVIDER_TITLES[user.sttProvider]}`,
    `   модель: <code>${escapeHtml(user.sttModel)}</code>`,
    `🧠 Обробка тексту: <code>${escapeHtml(user.llmModel)}</code>`,
    `🎛 Режим: ${style.title} — ${style.hint}`,
    `📖 Словник: ${preview(user.glossary)}`,
    `➕ Побажання: ${preview(user.extraPrompt)}`,
  ].join("\n");
}

function preview(value: string, limit = 120): string {
  const flat = value.trim().split(/\s+/).join(" ");
  if (!flat) return "—";
  const shortened = flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
  return `<code>${escapeHtml(shortened)}</code>`;
}

/** Ріже довгий текст на повідомлення, не розриваючи абзаци й речення. */
export function splitForTelegram(text: string, limit: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];

  const parts: string[] = [];
  let rest = trimmed;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf("\n\n");

    if (cut < limit / 2) {
      cut = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
      );
      cut = cut === -1 ? -1 : cut + 1;
    }
    if (cut < limit / 2) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = limit;

    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}
