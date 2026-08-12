"""Вибір рушія STT та розпізнавання файлу цілком (з нарізкою за потреби)."""

from __future__ import annotations

import logging
from pathlib import Path

from ...config import Settings
from ..audio import AudioError, convert_to_mp3, ffmpeg_available, split_audio
from ..openrouter import OpenRouterClient
from .base import TranscriptionBackend, TranscriptionError
from .openrouter_audio import OpenRouterAudioBackend
from .whisper_api import WhisperApiBackend

logger = logging.getLogger(__name__)

#: Маркер межі між шматками одного запису — редактор його прибирає.
CHUNK_MARKER = "\n[...]\n"

PROVIDER_TITLES = {
    "openai_whisper": "Whisper (OpenAI)",
    "groq_whisper": "Whisper (Groq)",
    "openrouter": "OpenRouter (аудіо-модель)",
}

__all__ = [
    "CHUNK_MARKER",
    "PROVIDER_TITLES",
    "TranscriptionBackend",
    "TranscriptionError",
    "build_backend",
    "transcribe_audio",
]


def build_backend(
    provider: str,
    model: str,
    settings: Settings,
    openrouter: OpenRouterClient,
) -> TranscriptionBackend:
    if provider == "openrouter":
        return OpenRouterAudioBackend(model=model, client=openrouter)

    if provider == "openai_whisper":
        if not settings.openai_api_key:
            raise TranscriptionError(
                "Для Whisper через OpenAI не заданий OPENAI_API_KEY. "
                "Обери інший рушій командою /stt."
            )
        return WhisperApiBackend(
            model=model,
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            provider="OpenAI",
        )

    if provider == "groq_whisper":
        if not settings.groq_api_key:
            raise TranscriptionError(
                "Для Whisper через Groq не заданий GROQ_API_KEY. "
                "Обери інший рушій командою /stt."
            )
        return WhisperApiBackend(
            model=model,
            api_key=settings.groq_api_key,
            base_url=settings.groq_base_url,
            provider="Groq",
        )

    raise TranscriptionError(f"Невідомий рушій розпізнавання: {provider}")


async def transcribe_audio(
    path: Path,
    backend: TranscriptionBackend,
    workdir: Path,
    chunk_target_seconds: int,
    hint: str = "",
) -> str:
    """Готує файл під вимоги рушія, розпізнає і склеює результат."""
    has_ffmpeg = ffmpeg_available()
    too_big = path.stat().st_size > backend.max_file_bytes
    source = path

    if backend.needs_mp3 or too_big:
        if not has_ffmpeg:
            raise AudioError(
                "Для цього запису потрібен ffmpeg (конвертація або нарізка), "
                "але його немає в системі. Запусти бота через Docker або "
                "встанови ffmpeg."
            )
        source = await convert_to_mp3(path, workdir / f"{path.stem}.mp3")

    if has_ffmpeg:
        parts = await split_audio(
            source,
            target_seconds=chunk_target_seconds,
            workdir=workdir,
            to_mp3=backend.needs_mp3,
        )
    else:
        parts = [source]

    oversized = [p for p in parts if p.stat().st_size > backend.max_file_bytes]
    if oversized:
        raise AudioError(
            "Запис завеликий навіть після стиснення. Спробуй зменшити "
            "CHUNK_TARGET_SECONDS або надіслати коротший фрагмент."
        )

    chunks: list[str] = []
    for index, part in enumerate(parts, start=1):
        logger.info(
            "Розпізнаю шматок %s/%s через %s (%s)",
            index,
            len(parts),
            backend.provider,
            backend.model,
        )
        text = await backend.transcribe(part, hint=hint)
        if text.strip():
            chunks.append(text.strip())

    return CHUNK_MARKER.join(chunks)
