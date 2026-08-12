"""Головний сценарій: голосове повідомлення → чистий текст."""

from __future__ import annotations

import logging
import mimetypes
import tempfile
from dataclasses import dataclass
from html import escape
from pathlib import Path

from aiogram import F, Router
from aiogram.enums import ChatAction
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import Message

from .. import texts
from ..deps import Deps
from ..prompts import build_whisper_hint
from ..services.audio import AudioError
from ..services.cleanup import clean_transcript, split_for_telegram
from ..services.openrouter import OpenRouterError
from ..services.stt import TranscriptionError, build_backend, transcribe_audio

logger = logging.getLogger(__name__)

router = Router(name="voice")

#: Bot API не віддає файли більші за 20 МБ.
TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024

_AUDIO_CONTENT = (
    F.voice | F.audio | F.video_note | F.document.mime_type.startswith("audio/")
)


@dataclass(frozen=True, slots=True)
class AudioSource:
    file_id: str
    suffix: str
    duration: int | None
    file_size: int | None


def extract_audio(message: Message) -> AudioSource | None:
    """Дістає аудіо з повідомлення будь-якого підтримуваного типу."""
    if message.voice:
        return AudioSource(message.voice.file_id, ".ogg", message.voice.duration, message.voice.file_size)

    if message.video_note:
        return AudioSource(
            message.video_note.file_id, ".mp4", message.video_note.duration, message.video_note.file_size
        )

    if message.audio:
        return AudioSource(
            message.audio.file_id,
            _suffix_for(message.audio.file_name, message.audio.mime_type, ".mp3"),
            message.audio.duration,
            message.audio.file_size,
        )

    document = message.document
    if document and (document.mime_type or "").startswith("audio/"):
        return AudioSource(
            document.file_id,
            _suffix_for(document.file_name, document.mime_type, ".ogg"),
            None,
            document.file_size,
        )

    return None


def _suffix_for(file_name: str | None, mime_type: str | None, fallback: str) -> str:
    if file_name and "." in file_name:
        suffix = Path(file_name).suffix.lower()
        if 1 < len(suffix) <= 6:
            return suffix
    if mime_type:
        guessed = mimetypes.guess_extension(mime_type)
        if guessed:
            return guessed
    return fallback


@router.message(_AUDIO_CONTENT)
async def handle_audio(message: Message, deps: Deps) -> None:
    source = extract_audio(message)
    if source is None:
        await message.answer(texts.NOT_AUDIO)
        return

    limit = deps.settings.max_audio_seconds
    if limit and source.duration and source.duration > limit:
        await message.answer(
            texts.ERROR_TOO_LONG.format(
                duration=round(source.duration / 60), limit=round(limit / 60)
            )
        )
        return

    if source.file_size and source.file_size > TELEGRAM_DOWNLOAD_LIMIT:
        await message.answer(texts.ERROR_TOO_BIG)
        return

    status = await message.answer(texts.STATUS_DOWNLOADING)
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)

    try:
        with tempfile.TemporaryDirectory(prefix="voice2text-") as tmp:
            workdir = Path(tmp)
            audio_path = workdir / f"audio{source.suffix}"

            file = await message.bot.get_file(source.file_id)
            await message.bot.download_file(file.file_path, destination=audio_path)

            user = await deps.user_settings(message.from_user.id)
            backend = build_backend(
                user.stt_provider, user.stt_model, deps.settings, deps.openrouter
            )

            await _edit(status, texts.STATUS_TRANSCRIBING)
            transcript = await transcribe_audio(
                path=audio_path,
                backend=backend,
                workdir=workdir,
                chunk_target_seconds=deps.settings.chunk_target_seconds,
                hint=build_whisper_hint(user.glossary),
            )

        if not transcript.strip():
            await _edit(status, texts.EMPTY_RESULT)
            return

        if user.style != "raw":
            await _edit(status, texts.STATUS_CLEANING)
            await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)

        cleaned = await clean_transcript(
            transcript, user, deps.openrouter, deps.settings.llm_temperature
        )

    except (TranscriptionError, AudioError, OpenRouterError) as exc:
        logger.warning("Обробка не вдалась для %s: %s", message.from_user.id, exc)
        await _edit(status, texts.ERROR_GENERIC.format(error=escape(str(exc))))
        return
    except TelegramBadRequest as exc:
        # Telegram не завжди повідомляє розмір у самому повідомленні,
        # тож ліміт може спливти лише на get_file.
        if "too big" in str(exc).lower():
            await _edit(status, texts.ERROR_TOO_BIG)
        else:
            logger.warning("Telegram відмовив: %s", exc)
            await _edit(status, texts.ERROR_GENERIC.format(error=escape(str(exc))))
        return
    except Exception as exc:  # noqa: BLE001 — користувач має отримати відповідь завжди
        logger.exception("Несподівана помилка обробки запису")
        await _edit(status, texts.ERROR_GENERIC.format(error=escape(repr(exc))))
        return

    parts = split_for_telegram(cleaned)
    if not parts:
        await _edit(status, texts.EMPTY_RESULT)
        return

    await _edit(status, parts[0], as_plain_text=True)
    for part in parts[1:]:
        await message.answer(part, parse_mode=None)


async def _edit(status: Message, text: str, as_plain_text: bool = False) -> None:
    """Оновлює повідомлення-статус, ігноруючи «message is not modified»."""
    try:
        await status.edit_text(text, parse_mode=None if as_plain_text else "HTML")
    except TelegramBadRequest as exc:
        if "message is not modified" not in str(exc):
            logger.warning("Не вдалося оновити статус: %s", exc)


@router.message(F.text & ~F.text.startswith("/"))
async def handle_text(message: Message) -> None:
    await message.answer(texts.NOT_AUDIO)
