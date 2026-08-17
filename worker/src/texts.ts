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
  "<b>Текст.</b> Перешли статтю, лист чи довге повідомлення — перекажу суть, " +
  "головні думки й що з цим робити. Кнопками можна попросити розгорнути, " +
  "пояснити простіше або перекласти.\n\n" +
  "<b>Не влаштував результат?</b> Під ним є кнопки: перепрогнати іншою " +
  "моделлю чи стилем, перерозпізнати аудіо або дати вказівку («зроби " +
  "списком», «промт англійською»). Надсилати запис ще раз не треба.\n\n" +
  "<b>Команди можна казати голосом.</b> «Додай у довідник Кірпосенко», " +
  "«яка завтра погода», «покажи витрати», «знайди Гаркушенці» — слеш і " +
  "точна назва не потрібні.\n\n" +
  "<b>Команди</b>\n" +
  "/settings — поточні налаштування\n" +
  "/model — модель для обробки тексту\n" +
  "/style — режим обробки: розшифровка або генерація промтів\n" +
  "/stt — рушій розпізнавання мови\n" +
  "/vision — модель для читання фото\n" +
  "/remind — створити нагадування\n" +
  "/autoremind — чи створювати нагадування без команди\n" +
  "/reminders — список нагадувань\n" +
  "/template — шаблони документів: бланк + надиктоване = готовий папір\n" +
  "/list — списки: покупки, справи, ідеї\n" +
  "/expenses — витрати за місяць із чеків\n" +
  "/birthday — дні народження, вітання о 9:00\n" +
  "/weather — погода, /rate — курс НБУ, /tr — переклад\n" +
  "/find — пошук по надиктованому (<code>/find Гаркушенці</code>)\n" +
  "/history — останні записи\n" +
  "/usage — витрати й залишок на OpenRouter\n" +
  "/glossary — імена й терміни, які треба писати правильно\n" +
  "/prompt — додаткові побажання до обробки\n" +
  "/reset — скинути все до типових значень\n\n" +
  "<b>Три режими.</b> За замовчуванням я записую сказане охайно й нічого не " +
  "додаю. У режимах генерації (/style) навпаки — розгортаю надиктовану ідею " +
  "в готовий промт для відео чи зображення, дописуючи освітлення, план, " +
  "настрій і деталі, яких ви не називали. А «📋 Протокол» витягає з наради " +
  "рішення, доручення й терміни — і з доручень одразу ставить нагадування.\n\n" +
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
  "Надішли голосове, аудіофайл, відеокружечок або знімок 🎙\n\n" +
  "Довгий текст теж підійде — перешли статтю чи лист, і я перекажу суть.";

export const STATUS_TRANSCRIBING = "🎧 Розпізнаю мовлення…";
export const STATUS_CLEANING = "✨ Причісую текст…";
export const STATUS_GENERATING = "🎨 Складаю промт…";
export const STATUS_READING_TEXT = "📖 Читаю…";
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
  "Дописати, не чіпаючи решти: <code>/glossary + Кірпосенко</code>\n" +
  "Прибрати одне: <code>/glossary - Кірпосенко</code>\n" +
  "Очистити все: <code>/glossary -</code>\n\n" +
  `Зараз: ${current}`;

export const LIST_NOT_FOUND = (term: string) =>
  `Не знайшов у списку: <code>${escapeHtml(term)}</code>\n\n` +
  "Перевір написання — прибираю лише те, що збігається повністю.";

export const PROMPT_HELP = (current: string) =>
  "<b>Додаткові побажання</b>\n\n" +
  "Можна дописати власну інструкцію для редагування — вона додається до " +
  "стандартних правил.\n\n" +
  "Приклад:\n" +
  "<code>/prompt Оформлюй списки маркерами</code>\n\n" +
  "Дописати: <code>/prompt + Скорочення розкривай</code>\n" +
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

export const AUTO_REMIND_ON =
  "⏰ Тепер працюю з нагадуваннями без команди.\n\n" +
  "Створити: «нагадай завтра о 9 здати звіт» — або просто слово " +
  "«нагадування» в кінці надиктованого.\n" +
  "Прибрати: «прибери нагадування про показники».\n" +
  "Перенести: «перенеси нагадування про звіт на четвер».\n" +
  "Побачити: «покажи нагадування».";

export const AUTO_REMIND_OFF =
  "🔇 Більше не чіпаю нагадування самостійно — ані створюю, ані міняю. " +
  "Тільки за командами /remind і /reminders.";

export const REMIND_FAILED = (reason: string) => `🤔 ${escapeHtml(reason)}`;

/** Прохання було явним, але не вийшло — мовчати тут не можна. */
export const REMIND_AUTO_FAILED = (reason: string) =>
  `🤔 Схоже на прохання нагадати, але не вийшло: ${escapeHtml(reason)}\n\n` +
  "Спробуй сказати конкретніше, наприклад «нагадай завтра о 9 здати звіт» " +
  "або «нагадуй щомісяця 29 числа передати показники».";

export const REMIND_LIMIT = (max: number) =>
  `📌 Уже назбиралось ${max} нагадувань. Прибери зайві через /reminders.`;

export const REMINDERS_EMPTY = "📭 Нагадувань немає. Створити — /remind";

/**
 * Список нагадувань текстом, а кнопки — окремо, з номерами.
 *
 * Раніше кожен рядок сам був кнопкою «прибрати»: дотик, щоб роздивитися
 * обрізаний текст, мовчки знищував запис. Тепер текст видно повністю й
 * нікуди не треба тикати, щоб його прочитати.
 */
export const REMINDERS_HEADER = (count: number) =>
  `<b>Найближчі нагадування (${count})</b>`;

export const renderReminders = (
  items: { when: string; text: string; repeat?: Repeat }[],
): string =>
  [
    REMINDERS_HEADER(items.length),
    "",
    ...items.map(
      (item, index) =>
        `${index + 1}. <b>${escapeHtml(item.when)}</b>` +
        `${item.repeat ? ` · ${repeatTitle(item.repeat)}` : ""}\n` +
        `    ${escapeHtml(item.text)}`,
    ),
    "",
    "<i>Прибрати — кнопкою з відповідним номером.</i>",
  ].join("\n");

// ── Протокол ─────────────────────────────────────────────────────────────────

export const MINUTES_TASKS_BUTTON = "⏰ Нагадування з доручень";
export const MINUTES_TASKS_WORKING = "Перебираю доручення…";
export const MINUTES_NO_TASKS =
  "Не знайшов жодного доручення з названим терміном.\n\n" +
  "Доручення без дати я навмисне пропускаю — вигадувати її не варто. " +
  "Постав таке нагадування вручну: <code>/remind у четвер передати показники</code>";

export const MINUTES_TASKS_SAVED = (items: { what: string; when: string }[]) =>
  [
    `⏰ <b>Поставив нагадувань: ${items.length}</b>`,
    "",
    ...items.map((item) => `— ${escapeHtml(item.what)}\n   <i>${escapeHtml(item.when)}</i>`),
    "",
    "<i>Прибрати зайве — /reminders</i>",
  ].join("\n");

// ── Шаблони документів ───────────────────────────────────────────────────────

export const TEMPLATE_BUTTON = "📄 За шаблоном";
export const TEMPLATE_FILLING = "Заповнюю бланк…";
export const TEMPLATE_PICK = "Який бланк заповнити щойно сказаним?";

export const TEMPLATE_NONE =
  "<b>Шаблони документів</b>\n\n" +
  "Свій бланк плюс надиктовані обставини — і документ готовий.\n\n" +
  "Додати:\n" +
  "<code>/template акт\nАКТ обстеження\nДата: \nАдреса: \nЛічильник № \nВисновок: </code>\n\n" +
  "Перший рядок після команди — назва, решта — сам бланк. Потім надиктуйте " +
  "обставини й натисніть «📄 За шаблоном» під розшифровкою.";

export const templateList = (items: { title: string; lines: number }[]) =>
  [
    `<b>Шаблони (${items.length})</b>`,
    "",
    ...items.map((item) => `📄 ${escapeHtml(item.title)} — ${item.lines} ряд.`),
    "",
    "Показати один: <code>/template акт</code>",
    "Прибрати: <code>/template - акт</code>",
  ].join("\n");

export const templateShown = (title: string, body: string) =>
  `📄 <b>${escapeHtml(title)}</b>\n\n<code>${escapeHtml(body)}</code>`;

export const TEMPLATE_SAVED = (title: string) =>
  `✅ Шаблон «${escapeHtml(title)}» збережено.\n\n` +
  "Надиктуйте обставини й натисніть «📄 За шаблоном» під розшифровкою.";

export const TEMPLATE_REMOVED = (title: string) =>
  `🗑 Шаблон «${escapeHtml(title)}» прибрано.`;

export const TEMPLATE_UNKNOWN = (name: string) =>
  `Немає шаблону «${escapeHtml(name)}».\n\nПерелік — <code>/template</code>`;

export const TEMPLATE_NAME_TOO_LONG =
  "Назва задовга — вона має вміститись у кнопку. Дай коротшу, на слово-два.";

export const TEMPLATE_TOO_LONG = (limit: number) =>
  `Бланк задовгий: більше за ${limit} символів. Він щоразу їде в запиті до ` +
  "моделі, тож має лишатися бланком, а не книжкою.";

export const TEMPLATE_LIMIT = (limit: number) =>
  `Більше за ${limit} шаблонів не тримаю. Прибери зайвий: <code>/template - назва</code>`;

export const TEMPLATE_NEEDS_BODY =
  "Після назви з нового рядка має йти сам бланк.\n\n" +
  "<code>/template акт\nАКТ обстеження\nДата: \nАдреса: </code>";

export const TEMPLATE_NOTHING_TO_FILL =
  "Нема з чого заповнювати. Спершу надиктуйте обставини або надішліть знімок.";

// ── Історія ──────────────────────────────────────────────────────────────────

export const HISTORY_EMPTY =
  "📭 Історія порожня. Вона наповнюється сама — кожним голосовим і знімком.";

export const FIND_HELP =
  "<b>Пошук по надиктованому</b>\n\n" +
  "Напиши слово або кілька — знайду записи, де вони звучали.\n\n" +
  "Приклад:\n" +
  "<code>/find Гаркушенці показники</code>\n\n" +
  "Слова шукаються за початком, тож відмінки не заважають: " +
  "«Гаркушенц» знайде і «Гаркушенцях», і «Гаркушенці».";

export const FIND_NOTHING = (query: string) =>
  `Нічого не знайшов за запитом «${escapeHtml(query)}».\n\n` +
  "Спробуй коротший корінь слова або інше слово із запису.";

export const historyList = (
  title: string,
  items: { when: string; kind: "voice" | "photo" | "text"; preview: string }[],
): string =>
  [
    `<b>${title}</b>`,
    "",
    ...items.map(
      (item, index) =>
        `${index + 1}. ${kindIcon(item.kind)} <b>${escapeHtml(item.when)}</b>\n` +
        `    ${escapeHtml(item.preview)}`,
    ),
    "",
    "<i>Розгорнути повністю — кнопкою з номером.</i>",
  ].join("\n");

const kindIcon = (kind: "voice" | "photo" | "text") =>
  kind === "photo" ? "📷" : kind === "text" ? "📖" : "🎙";

export const HISTORY_GONE = "Цей запис уже не зберігається.";

export const historyEntry = (
  when: string,
  kind: "voice" | "photo" | "text",
  text: string,
) => `${kindIcon(kind)} <b>${escapeHtml(when)}</b>\n\n${escapeHtml(text)}`;

// ── Команди голосом ──────────────────────────────────────────────────────────

export const VOICE_COMMAND_RUNNING = (command: string, args: string) =>
  `⚙️ <code>/${escapeHtml(command)}${args ? ` ${escapeHtml(args)}` : ""}</code>`;

export const VOICE_COMMAND_FAILED = (reason: string) =>
  `Не зрозумів команду: ${escapeHtml(reason)}\n\n` +
  "Спробуй простіше — «додай у довідник Кірпосенко», «яка завтра погода», " +
  "«покажи витрати». Перелік команд — /help";

// ── Дні народження, погода, курс ─────────────────────────────────────────────

export const BIRTHDAY_HELP =
  "<b>Дні народження</b>\n\n" +
  "Вітання приходить о 9:00 у сам день, з віком, якщо назвати рік.\n\n" +
  "Додати:\n" +
  "<code>/birthday 31.12 Кириленко</code>\n" +
  "<code>/birthday 5 березня 1980 мама</code>\n\n" +
  "Прибрати: <code>/birthday - мама</code>";

export const BIRTHDAY_SAVED = (name: string, when: string) =>
  `🎂 Запам'ятав: <b>${escapeHtml(name)}</b> — ${escapeHtml(when)}`;

export const BIRTHDAY_BAD_DATE =
  "Не зрозумів дату. Напиши як <code>31.12</code> або <code>5 березня</code>, " +
  "далі ім'я.";

export const BIRTHDAY_REMOVED = (name: string) => `🗑 Прибрав: ${escapeHtml(name)}`;
export const BIRTHDAY_UNKNOWN = (name: string) =>
  `Немає такого запису: ${escapeHtml(name)}`;

export const birthdayList = (items: { when: string; name: string; year?: number }[]) =>
  [
    `<b>Дні народження (${items.length})</b>`,
    "",
    ...items.map(
      (item) =>
        `🎂 ${escapeHtml(item.when)} — ${escapeHtml(item.name)}` +
        (item.year ? ` <i>(${item.year})</i>` : ""),
    ),
  ].join("\n");

export const BIRTHDAY_TODAY = (name: string, age: number | null) =>
  `🎂 <b>Сьогодні день народження</b>\n\n${escapeHtml(name)}` +
  (age === null ? "" : ` — виповнюється ${age}`);

export const RATES = (rates: { code: string; rate: number }[]) =>
  [
    "💱 <b>Курс Нацбанку</b>",
    "",
    ...rates.map((r) => `${r.code} — ${r.rate.toFixed(2)} грн`),
  ].join("\n");

export const weather = (
  city: string,
  today: { min: number; max: number; word: string },
  tomorrow: { min: number; max: number; word: string },
) =>
  `🌤 <b>${escapeHtml(city)}</b>\n\n` +
  `Сьогодні: ${today.min}…${today.max}°, ${today.word}\n` +
  `Завтра: ${tomorrow.min}…${tomorrow.max}°, ${tomorrow.word}`;

export const WEATHER_NO_CITY =
  "Не знаю, для якого міста дивитись погоду.\n\n" +
  "Задай його: <code>/city Миргород</code>";

export const CITY_SAVED = (city: string) => `📍 Місто: <b>${escapeHtml(city)}</b>`;

export const SERVICE_FAILED = (what: string, reason: string) =>
  `Не вдалося дізнатись ${escapeHtml(what)}: <code>${escapeHtml(reason)}</code>`;

export const TRANSLATE_HELP =
  "<b>Переклад</b>\n\n" +
  "<code>/tr текст</code> — іншомовне перекладу українською, українське — " +
  "англійською.\n\n" +
  "Можна й відповіддю на повідомлення: <code>/tr</code> без тексту візьме те, " +
  "на що відповідаєш.";

export const STATUS_TRANSLATING = "🌐 Перекладаю…";

// ── Витрати ──────────────────────────────────────────────────────────────────

export const EXPENSE_BUTTON = "🧾 У витрати";
export const EXPENSE_READING = "Розбираю чек…";
export const EXPENSE_CSV_BUTTON = "📊 Таблицею для Excel";

const hryvnia = (value: number) => `${value.toFixed(2)} грн`;

export const EXPENSE_SAVED = (
  merchant: string,
  total: number,
  category: string,
  month: number,
) =>
  `🧾 <b>${escapeHtml(merchant)}</b> — ${hryvnia(total)}\n` +
  `Категорія: ${escapeHtml(category)}\n\n` +
  `<i>За місяць: ${hryvnia(month)}</i>`;

export const EXPENSE_FAILED = (reason: string) =>
  `Не записав чек: ${escapeHtml(reason)}\n\n` +
  "Спробуй перечитати знімок іншою моделлю або запиши суму вручну.";

export const EXPENSES_EMPTY = (month: string) =>
  `📭 За ${escapeHtml(month)} витрат не записано.\n\n` +
  "Надішли знімок чека — під зчитаним буде кнопка «🧾 У витрати».";

export const expensesSummary = (
  month: string,
  summary: { total: number; count: number; byCategory: { category: string; total: number }[] },
) =>
  [
    `💸 <b>Витрати за ${escapeHtml(month)}</b>`,
    "",
    ...summary.byCategory.map(
      (row) => `${escapeHtml(row.category)} — ${hryvnia(row.total)}`,
    ),
    "",
    `<b>Разом: ${hryvnia(summary.total)}</b>  <i>(чеків: ${summary.count})</i>`,
  ].join("\n");

// ── Списки ───────────────────────────────────────────────────────────────────

export const renderList = (title: string, items: string[]) =>
  [
    `🛒 <b>${escapeHtml(title)}</b> (${items.length})`,
    "",
    ...items.map((item, index) => `${index + 1}. ${escapeHtml(item)}`),
    "",
    "<i>Викреслити — кнопкою з номером.</i>",
  ].join("\n");

export const LIST_EMPTY = (list: string) =>
  `📭 Список «${escapeHtml(list)}» порожній.`;

export const LIST_ADDED = (list: string, added: string[], total: number) =>
  added.length === 0
    ? `Це вже є в списку «${escapeHtml(list)}».`
    : `✅ Додав до «${escapeHtml(list)}»: ${added.map(escapeHtml).join(", ")}\n\n` +
      `<i>Усього в списку: ${total}</i>`;

export const LIST_CROSSED = (removed: string[]) =>
  `✅ Викреслив: ${removed.map(escapeHtml).join(", ")}\n\n`;

export const LIST_NOT_THERE = (items: string[]) =>
  `Не знайшов у списку: ${items.map(escapeHtml).join(", ")}`;

export const LIST_CLEARED = (list: string, count: number) =>
  `🧹 Очистив «${escapeHtml(list)}» — прибрано пунктів: ${count}.`;

export const LIST_FAILED = (reason: string) =>
  `Не вийшло зі списком: ${escapeHtml(reason)}\n\n` +
  "Спробуй простіше: «додай до покупок молоко і хліб».";

export const LISTS_NONE =
  "<b>Списки</b>\n\n" +
  "Скажи або напиши «додай до покупок молоко і хліб» — і список заведеться сам.\n\n" +
  "Далі: «що в покупках», «купив молоко», «очисти покупки».\n" +
  "Списки будь-які: покупки, справи, ідеї.";

export const listsOverview = (names: string[]) =>
  [
    `<b>Списки (${names.length})</b>`,
    "",
    ...names.map((name) => `🛒 ${escapeHtml(name)}`),
    "",
    "Показати: <code>/list покупки</code>",
  ].join("\n");

// ── Керування нагадуваннями голосом ──────────────────────────────────────────

export const MANAGE_EMPTY = "📭 Нагадувань немає — міняти нічого.";

export const MANAGE_DELETED = (what: string) =>
  `🗑 Прибрав: <b>${escapeHtml(what)}</b>`;

export const MANAGE_MOVED = (what: string, from: string, to: string) =>
  `📅 Перенесено: <b>${escapeHtml(what)}</b>\n\n` +
  `<s>${escapeHtml(from)}</s> → <b>${escapeHtml(to)}</b>`;

export const MANAGE_FAILED = (reason: string) =>
  `Не змінив нагадування: ${escapeHtml(reason)}\n\n` +
  "Спробуй назвати його точніше — або зроби це кнопками в /reminders.";

export const SNOOZE_DONE_BUTTON = "✅ Готово";
export const REMINDER_ACKED = "✅ Готово";
export const SNOOZED_TOAST = (when: string) => `Відкладено до ${when}`;

export const SNOOZED = (text: string, when: string) =>
  `😴 Відкладено до <b>${escapeHtml(when)}</b>\n\n${escapeHtml(text)}`;

export const SNOOZE_GONE =
  "Це нагадування вже не під рукою — відкласти можна протягом доби. Створи нове через /remind.";

export const REMINDER_DELETED = "🗑 Прибрано.";
export const REMINDER_UNDO_BUTTON = "↩️ Повернути";
export const REMINDER_RESTORED = (when: string) => `↩️ Повернуто на ${escapeHtml(when)}.`;
export const REMINDER_UNDO_EXPIRED = "Повертати вже нічого — відкотити можна одразу.";

export const REMINDER_FIRES = (text: string) => `⏰ <b>Нагадування</b>\n\n${escapeHtml(text)}`;

// ── Витрати ──────────────────────────────────────────────────────────────────

const money = (value: number) => `$${value.toFixed(2)}`;

export const USAGE = (spent: number, granted: number, today?: number) => {
  const left = granted - spent;
  const lines = [
    "<b>Витрати OpenRouter</b>",
    "",
    `Витрачено: ${money(spent)}`,
  ];
  // Загальну суму дає OpenRouter, а «сьогодні» рахуємо самі — саме воно
  // показує, у скільки обходиться нинішня модель, поки її не пізно змінити.
  if (today !== undefined) lines.push(`Сьогодні: ${priceTag(today)}`);
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

export const WHOLE_FILE_CAPTION = "Той самий текст одним файлом — зручніше копіювати.";

export const CSV_BUTTON = "📊 Таблицею для Excel";
export const CSV_HINT = "Перенести зчитане в таблицю?";

// ── Повторний прогін ─────────────────────────────────────────────────────────

/**
 * Чинна вказівка показується під результатом — інакше про неї легко забути.
 * Поруч — вартість: без неї вибір моделі робиться наосліп.
 */
export const REDO_HINT = (note = "", cost?: Spending) =>
  [
    note.trim() ? `Вказівка: <i>${escapeHtml(note.trim())}</i>` : "",
    note.trim() ? "Ще щось змінити?" : "Не влаштовує результат?",
    cost ? `<i>${spendingLine(cost)}</i>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

export interface Spending {
  now: number;
  today: number;
}

/** Дрібні суми у центах: «$0.0004» читається гірше, ніж «0.04¢». */
const priceTag = (value: number) =>
  value < 0.01 ? `${(value * 100).toFixed(2)}¢` : `$${value.toFixed(3)}`;

const spendingLine = (cost: Spending) =>
  `${priceTag(cost.now)} · сьогодні ${priceTag(cost.today)}`;

export const REDO_RUNNING = "Переробляю…";
export const REDO_PICK_MODEL = "Обери модель — і я одразу перероблю цей запис:";
export const REDO_PICK_STYLE = "Обери стиль — і я одразу перероблю цей запис:";
export const REDO_PICK_VISION = "Обери модель — і я перечитаю цей знімок:";
export const REDO_NOTHING =
  "Немає чого переробляти. Надішли голосове або знімок.";
export const REDO_NO_AUDIO =
  "Це був знімок, а не запис — перерозпізнавати нема чого.";

export const REDO_PICK_TWEAK =
  "Що змінити в результаті? Або натисни «Своя вказівка» й напиши своїми словами.";
export const REDO_OWN_NOTE_BUTTON = "💬 Своя вказівка";
export const REDO_ASK_NOTE =
  "Напиши одним повідомленням, що змінити.\n\n" +
  "Наприклад: «зроби списком», «промт англійською», «лиши три речення», " +
  "«вийми звідси лише дати й суми».";
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
