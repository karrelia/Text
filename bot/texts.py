"""Тексти інтерфейсу (українською)."""

from __future__ import annotations

from html import escape

from .prompts import STYLES
from .services.stt import PROVIDER_TITLES
from .storage import UserSettings

START = (
    "👋 Привіт! Я перетворюю надиктоване на охайний текст.\n\n"
    "Надішли мені <b>голосове повідомлення</b>, аудіофайл або відеокружечок — "
    "у відповідь отримаєш готовий текст: без «е-е», повторів, обмовок і слів-паразитів, "
    "із пунктуацією та абзацами.\n\n"
    "Розрахований на українську мову й суржик; англійські назви та терміни "
    "лишаються латиницею.\n\n"
    "Що можна налаштувати — /settings"
)

HELP = (
    "<b>Як користуватись</b>\n"
    "Просто надішли голосове, аудіофайл (mp3, m4a, ogg, wav…) або відеокружечок. "
    "Довгі записи ріжу на шматки по паузах і склеюю результат.\n\n"
    "<b>Команди</b>\n"
    "/settings — поточні налаштування\n"
    "/model — модель для обробки тексту\n"
    "/style — стиль обробки\n"
    "/stt — рушій розпізнавання мови\n"
    "/sttmodel — аудіо-модель (коли рушій = OpenRouter)\n"
    "/glossary — імена й терміни, які треба писати правильно\n"
    "/prompt — додаткові побажання до редагування\n"
    "/reset — скинути все до типових значень\n\n"
    "<b>Порада.</b> Якщо в записах регулярно звучать прізвища, назви компаній чи "
    "технічні терміни — додай їх у /glossary. Це помітно підвищує точність, бо "
    "підказка йде і в розпізнавання, і в редагування."
)

NO_ACCESS = (
    "🔒 Цей бот приватний.\n\n"
    "Твій Telegram ID: <code>{user_id}</code>\n"
    "Якщо це твій бот — додай цей ID у змінну <code>ALLOWED_USER_IDS</code> "
    "і перезапусти його."
)

NOT_AUDIO = (
    "Я обробляю тільки аудіо. Надішли голосове повідомлення, аудіофайл "
    "або відеокружечок 🎙"
)

STATUS_DOWNLOADING = "⏬ Завантажую запис…"
STATUS_TRANSCRIBING = "🎧 Розпізнаю мовлення…"
STATUS_CLEANING = "✨ Причісую текст…"
STATUS_GENERATING = "🎨 Складаю промт…"

EMPTY_RESULT = "🤷 У записі не вдалося розібрати жодного слова."

ERROR_TOO_LONG = (
    "⏱ Запис задовгий: {duration} хв, а ліміт — {limit} хв. "
    "Надішли коротшим фрагментом."
)
ERROR_TOO_BIG = (
    "📦 Telegram не дає ботам завантажувати файли більші за 20 МБ. "
    "Стисни запис або наріж на частини."
)
ERROR_GENERIC = "⚠️ Не вдалося обробити запис.\n\n<code>{error}</code>"

SETTINGS_SAVED = "✅ Збережено."
RESET_DONE = "♻️ Налаштування скинуто до типових."

GLOSSARY_HELP = (
    "<b>Словник власних назв</b>\n\n"
    "Перелічи через кому або з нового рядка імена, назви й терміни, які "
    "звучать у твоїх записах — я писатиму їх правильно.\n\n"
    "Приклад:\n"
    "<code>/glossary Кириленко, ТОВ «Миргородводоканал», Kubernetes, ClickHouse</code>\n\n"
    "Очистити: <code>/glossary -</code>\n\n"
    "Зараз: {current}"
)

PROMPT_HELP = (
    "<b>Додаткові побажання</b>\n\n"
    "Можна дописати власну інструкцію для редагування — вона додається до "
    "стандартних правил.\n\n"
    "Приклад:\n"
    "<code>/prompt Оформлюй списки маркерами, звертання пиши з великої літери</code>\n\n"
    "Очистити: <code>/prompt -</code>\n\n"
    "Зараз: {current}"
)

MODEL_HELP = (
    "<b>Модель обробки тексту</b>\n\n"
    "Обери зі списку нижче або знайди будь-яку модель OpenRouter:\n"
    "<code>/model gemini</code>, <code>/model claude</code>, <code>/model llama</code>\n\n"
    "Щоб задати точний ідентифікатор:\n"
    "<code>/model anthropic/claude-sonnet-4.5</code>\n\n"
    "Зараз: <code>{current}</code>"
)

STT_MODEL_HELP = (
    "<b>Аудіо-модель OpenRouter</b>\n\n"
    "Використовується, коли рушій розпізнавання — OpenRouter. "
    "Показані лише моделі, що приймають аудіо.\n\n"
    "Пошук: <code>/sttmodel gemini</code>\n\n"
    "Зараз: <code>{current}</code>"
)

NO_MATCHES = "Нічого не знайшов за запитом «{query}». Спробуй інше слово."

MODEL_UNKNOWN = (
    "⚠️ Моделі <code>{model}</code> немає в каталозі OpenRouter. "
    "Перевір ідентифікатор на openrouter.ai/models"
)

STT_PICK = "<b>Рушій розпізнавання мови</b>\n\nЗараз: {current}"

STT_NO_KEY = (
    "⚠️ Для цього рушія не заданий API-ключ. "
    "Додай його в .env і перезапусти бота."
)

STYLE_PICK = (
    "<b>Режим обробки</b>\n\n"
    "✍️ <b>Розшифровка</b> — записує сказане охайно, нічого не додаючи.\n"
    "🎬🖼📝 <b>Генерація</b> — навпаки, розгортає надиктовану ідею й свідомо "
    "додає деталі, яких ви не називали.\n\n"
    "Зараз: {current}"
)


def render_settings(user: UserSettings, ffmpeg_ok: bool) -> str:
    style = STYLES.get(user.style, STYLES["clean"])
    provider = PROVIDER_TITLES.get(user.stt_provider, user.stt_provider)

    lines = [
        "<b>Поточні налаштування</b>",
        "",
        f"🎧 Розпізнавання: {escape(provider)}",
        f"   модель: <code>{escape(user.stt_model)}</code>",
        f"🧠 Обробка тексту: <code>{escape(user.llm_model)}</code>",
        f"🎛 Режим: {escape(style['title'])} — {escape(style['hint'])}",
        f"📖 Словник: {_preview(user.glossary)}",
        f"➕ Побажання: {_preview(user.extra_prompt)}",
    ]
    if not ffmpeg_ok:
        lines += [
            "",
            "⚠️ ffmpeg не знайдено: довгі записи не ріжуться, "
            "а рушій OpenRouter недоступний.",
        ]
    return "\n".join(lines)


def _preview(value: str, limit: int = 120) -> str:
    value = value.strip()
    if not value:
        return "—"
    flat = " ".join(value.split())
    if len(flat) > limit:
        flat = flat[:limit] + "…"
    return f"<code>{escape(flat)}</code>"
