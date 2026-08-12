"""Базові команди: /start, /help, /settings, /reset."""

from __future__ import annotations

from aiogram import Router
from aiogram.filters import Command, CommandStart
from aiogram.types import Message

from .. import texts
from ..deps import Deps
from ..services.audio import ffmpeg_available

router = Router(name="common")


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    await message.answer(texts.START)


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(texts.HELP)


@router.message(Command("settings"))
async def cmd_settings(message: Message, deps: Deps) -> None:
    user = await deps.user_settings(message.from_user.id)
    await message.answer(texts.render_settings(user, ffmpeg_available()))


@router.message(Command("reset"))
async def cmd_reset(message: Message, deps: Deps) -> None:
    await deps.storage.reset(message.from_user.id)
    user = await deps.user_settings(message.from_user.id)
    await message.answer(
        f"{texts.RESET_DONE}\n\n{texts.render_settings(user, ffmpeg_available())}"
    )
