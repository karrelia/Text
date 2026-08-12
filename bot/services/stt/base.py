"""Спільний інтерфейс для рушіїв розпізнавання мови."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class TranscriptionError(RuntimeError):
    """Помилка розпізнавання, придатна для показу користувачу."""


class TranscriptionBackend(ABC):
    #: Людська назва провайдера для повідомлень і логів.
    provider: str = ""

    #: Чи потрібна конвертація в mp3 перед відправкою.
    needs_mp3: bool = False

    #: Максимальний розмір файлу, який приймає API, байтів.
    max_file_bytes: int = 24 * 1024 * 1024

    def __init__(self, model: str) -> None:
        self.model = model

    @abstractmethod
    async def transcribe(self, path: Path, hint: str = "") -> str:
        """Повертає сирий транскрипт одного аудіофайлу."""
