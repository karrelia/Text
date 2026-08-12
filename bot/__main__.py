"""Точка входу: запуск бота в режимі polling або webhook."""

from __future__ import annotations

import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from .config import Settings, get_settings
from .deps import Deps
from .handlers import common, settings as settings_handlers, voice
from .middlewares import AccessMiddleware
from .services.audio import ffmpeg_available
from .services.openrouter import OpenRouterClient
from .storage import SettingsStorage

logger = logging.getLogger(__name__)

COMMANDS = [
    BotCommand(command="settings", description="Поточні налаштування"),
    BotCommand(command="model", description="Модель обробки тексту"),
    BotCommand(command="style", description="Стиль обробки"),
    BotCommand(command="stt", description="Рушій розпізнавання мови"),
    BotCommand(command="sttmodel", description="Аудіо-модель OpenRouter"),
    BotCommand(command="glossary", description="Імена й терміни"),
    BotCommand(command="prompt", description="Додаткові побажання"),
    BotCommand(command="reset", description="Скинути налаштування"),
    BotCommand(command="help", description="Довідка"),
]


def build_dispatcher(deps: Deps) -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher["deps"] = deps

    access = AccessMiddleware(deps.settings.allowed_user_ids)
    dispatcher.message.outer_middleware(access)
    dispatcher.callback_query.outer_middleware(access)

    dispatcher.include_router(common.router)
    dispatcher.include_router(settings_handlers.router)
    # Роутер аудіо останній: він містить «спіймай будь-який текст».
    dispatcher.include_router(voice.router)
    return dispatcher


def check_environment(settings: Settings) -> None:
    if not settings.allowed_user_ids:
        logger.warning(
            "ALLOWED_USER_IDS порожній — бот нікого не пустить. "
            "Напиши йому /start, він покаже твій ID."
        )

    if not settings.available_stt_providers():
        logger.error(
            "Немає жодного ключа для STT. Задай OPENAI_API_KEY, GROQ_API_KEY "
            "або залиш OPENROUTER_API_KEY і встанови STT_PROVIDER=openrouter."
        )

    if settings.stt_provider not in settings.available_stt_providers():
        logger.warning(
            "Для рушія за замовчуванням (%s) немає API-ключа — користувачам "
            "доведеться перемкнути рушій командою /stt.",
            settings.stt_provider,
        )

    if not ffmpeg_available():
        logger.warning(
            "ffmpeg/ffprobe не знайдено: нарізка довгих записів і рушій "
            "OpenRouter будуть недоступні."
        )


async def run_polling(bot: Bot, dispatcher: Dispatcher) -> None:
    await bot.delete_webhook(drop_pending_updates=True)
    logger.info("Запуск у режимі polling")
    await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())


async def run_webhook(bot: Bot, dispatcher: Dispatcher, settings: Settings) -> None:
    from aiohttp import web
    from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application

    if not settings.webhook_base_url:
        raise SystemExit("MODE=webhook потребує WEBHOOK_BASE_URL")

    url = settings.webhook_base_url.rstrip("/") + settings.webhook_path
    await bot.set_webhook(
        url=url,
        secret_token=settings.webhook_secret or None,
        drop_pending_updates=True,
        allowed_updates=dispatcher.resolve_used_update_types(),
    )
    logger.info("Webhook встановлено: %s", url)

    app = web.Application()
    SimpleRequestHandler(
        dispatcher=dispatcher,
        bot=bot,
        secret_token=settings.webhook_secret or None,
    ).register(app, path=settings.webhook_path)
    setup_application(app, dispatcher, bot=bot)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, settings.webapp_host, settings.webapp_port)
    await site.start()
    logger.info("Слухаю %s:%s", settings.webapp_host, settings.webapp_port)

    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


async def main() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )
    check_environment(settings)

    storage = SettingsStorage(settings.db_path)
    await storage.connect()

    openrouter = OpenRouterClient(
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        app_url=settings.openrouter_app_url,
        app_title=settings.openrouter_app_title,
    )

    bot = Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = build_dispatcher(Deps(settings, storage, openrouter))

    try:
        await bot.set_my_commands(COMMANDS)
        if settings.mode == "webhook":
            await run_webhook(bot, dispatcher, settings)
        else:
            await run_polling(bot, dispatcher)
    finally:
        await openrouter.aclose()
        await storage.close()
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit) as exc:
        if isinstance(exc, SystemExit) and exc.code:
            print(exc, file=sys.stderr)
            raise
        logger.info("Зупинено")
