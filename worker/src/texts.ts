/** Тексти інтерфейсу (українською). */

import { PROVIDER_TITLES } from "./env";
import { STYLES } from "./prompts";
import { type Repeat, repeatTitle } from "./recurrence";
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
  "<b>Фото.</b> Надішли знімок документа, накладної чи показників — зчитаю з " +
  "нього текст. Підпис під фото стає вказівкою: напиши «лише показники» або " +
  "«зроби таблицю», і я так і зроблю.\n\n" +
  "<b>Команди</b>\n" +
  "/settings — поточні налаштування\n" +
  "/model — модель для обробки тексту\n" +
  "/style — режим обробки: розшифровка або генерація промтів\n" +
  "/stt — рушій розпізнавання мови\n" +
  "/vision — модель для читання фото\n" +
  "/remind — створити нагадування\n" +
  "/autoremind — чи створювати нагадування без команди\n" +
  "/reminders — список нагадувань\n" +
  "/usage — витрати й залишок на OpenRouter\n" +
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
  "Якщо це твій бот — виконай у теці worker:\n" +
  "<code>npx wrangler secret put ALLOWED_USER_IDS</code>\n" +
  "і встав цей ID. Застосується одразу, deploy не потрібен.";

export const NOT_AUDIO =
  "Я обробляю тільки аудіо. Надішли голосове повідомлення, аудіофайл " +
  "або відеокружечок 🎙";

export const STATUS_TRANSCRIBING = "🎧 Розпізнаю мовлення…";
export const STATUS_CLEANING = "✨ Причісую текст…";
export const STATUS_GENERATING = "🎨 Складаю промт…";
export const STATUS_READING_PHOTO = "🔍 Читаю знімок…";
export const EMPTY_RESULT = "🤷 У записі не вдалося розібрати жодного слова.";
export const EMPTY_PHOTO = "🤷 На знімку не вдалося нічого розібрати.";

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

export const VISION_HELP = (current: string) =>
  "<b>Модель для читання фото</b>\n\n" +
  "Показані лише моделі, що приймають зображення.\n" +
  "Пошук: <code>/vision gemini</code>\n" +
  "Точний ідентифікатор: <code>/vision google/gemini-2.5-pro</code>\n\n" +
  `Зараз: <code>${escapeHtml(current)}</code>`;

export const MODEL_NOT_VISION = (model: string) =>
  `⚠️ Модель <code>${escapeHtml(model)}</code> не приймає зображення. ` +
  "Обери іншу зі списку /vision.";

// ── Нагадування ──────────────────────────────────────────────────────────────

export const REMIND_HELP =
  "<b>Нагадування</b>\n\n" +
  "Скажи звичайними словами, коли й про що нагадати:\n" +
  "<code>/remind у вівторок о 9 здати звіт</code>\n" +
  "<code>/remind через дві години передзвонити Кириленку</code>\n\n" +
  "Надиктував голосове — просто надішли <code>/remind</code> без тексту, " +
  "візьму щойно розшифроване. Або відповідай командою на конкретне " +
  "повідомлення, якщо треба взяти саме його.\n\n" +
  "Список: /reminders";

const repeatNote = (repeat?: Repeat) => (repeat ? ` (${repeatTitle(repeat)})` : "");

export const REMIND_SAVED = (
  what: string,
  when: string,
  fromLast = false,
  repeat?: Repeat,
) =>
  `⏰ Нагадаю <b>${escapeHtml(when)}</b>${repeatNote(repeat)}\n${escapeHtml(what)}` +
  (fromLast ? "\n\n<i>взято з останньої розшифровки</i>" : "");

export const REMIND_AUTO = (what: string, when: string, repeat?: Repeat) =>
  `⏰ Нагадаю <b>${escapeHtml(when)}</b>${repeatNote(repeat)}\n${escapeHtml(what)}`;

export const REMINDER_FIRES_REPEAT = (text: string, when: string, repeat: Repeat) =>
  `⏰ <b>Нагадування</b> (${repeatTitle(repeat)})\n\n${escapeHtml(text)}\n\n` +
  `<i>наступне — ${escapeHtml(when)}</i>`;

export const REMINDER_LABEL = (when: string, text: string, repeat?: Repeat) =>
  `${when}${repeat ? ` ${repeatTitle(repeat)}` : ""} — ${text}`;

export const AUTO_REMIND_ON =
  "⏰ Тепер створюю нагадування без команди.\n\n" +
  "Просто скажи або напиши «нагадай завтра о 9 здати звіт» — або додай " +
  "слово «нагадування» в кінці надиктованого. Команда /remind теж працює.";

export const AUTO_REMIND_OFF =
  "🔇 Більше не створюю нагадування самостійно. Тільки за командою /remind.";

export const REMIND_FAILED = (reason: string) => `🤔 ${escapeHtml(reason)}`;

/** Прохання було явним, але не вийшло — мовчати тут не можна. */
export const REMIND_AUTO_FAILED = (reason: string) =>
  `🤔 Схоже на прохання нагадати, але не вийшло: ${escapeHtml(reason)}\n\n` +
  "Спробуй сказати конкретніше, наприклад «нагадай завтра о 9 здати звіт» " +
  "або «нагадуй щомісяця 29 числа передати показники».";

export const REMIND_LIMIT = (max: number) =>
  `📌 Уже назбиралось ${max} нагадувань. Прибери зайві через /reminders.`;

export const REMINDERS_EMPTY = "📭 Нагадувань немає. Створити — /remind";

export const REMINDERS_HEADER = (count: number) =>
  `<b>Найближчі нагадування (${count})</b>\n\nНатисни, щоб прибрати:`;

export const REMINDER_DELETED = "🗑 Прибрано.";

export const REMINDER_FIRES = (text: string) => `⏰ <b>Нагадування</b>\n\n${escapeHtml(text)}`;

// ── Витрати ──────────────────────────────────────────────────────────────────

const money = (value: number) => `$${value.toFixed(2)}`;

export const USAGE = (spent: number, granted: number) => {
  const left = granted - spent;
  const lines = [
    "<b>Витрати OpenRouter</b>",
    "",
    `Витрачено: ${money(spent)}`,
  ];
  if (granted > 0) {
    lines.push(`Поповнено: ${money(granted)}`, `<b>Залишок: ${money(left)}</b>`);
    if (left <= 1) {
      lines.push("", "⚠️ Залишок малий — варто поповнити на openrouter.ai/credits");
    }
  } else {
    lines.push("", "Ліміт не заданий, тож залишок порахувати нема від чого.");
  }
  lines.push("", "<i>Розпізнавання через Groq тут не враховане — воно окремо.</i>");
  return lines.join("\n");
};

export const USAGE_FAILED = (reason: string) =>
  `⚠️ Не вдалося дізнатися витрати.\n\n<code>${escapeHtml(reason)}</code>`;

// ── Таблиця ──────────────────────────────────────────────────────────────────

export const CSV_BUTTON = "📊 Таблицею для Excel";
export const CSV_HINT = "Перенести зчитане в таблицю?";
export const CSV_BUILDING = "📊 Складаю таблицю…";
export const CSV_CAPTION = "Відкривається в Excel подвійним кліком.";
export const CSV_NOTHING =
  "Немає що переносити в таблицю. Спершу надішли знімок документа.";
export const CSV_FAILED = (reason: string) =>
  `⚠️ Не вдалося скласти таблицю.\n\n<code>${escapeHtml(reason)}</code>`;

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
    `📷 Читання фото: <code>${escapeHtml(user.visionModel)}</code>`,
    `🎛 Режим: ${style.title} — ${style.hint}`,
    `📖 Словник: ${preview(user.glossary)}`,
    `➕ Побажання: ${preview(user.extraPrompt)}`,
    `⏰ Нагадування без команди: ${user.autoRemind ? "увімкнено" : "вимкнено"}`,
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
