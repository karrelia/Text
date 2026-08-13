"""Редагування сирого транскрипту через LLM та підготовка тексту до відправки."""

from __future__ import annotations

import logging
import re

from ..prompts import build_system_prompt, build_user_message, temperature_for
from ..storage import UserSettings
from .openrouter import OpenRouterClient
from .stt import CHUNK_MARKER

logger = logging.getLogger(__name__)

TELEGRAM_LIMIT = 4096
_SAFE_CHUNK = 3900

_FENCE_RE = re.compile(r"^```[a-zA-Z]*\n(.*)\n?```$", re.DOTALL)
_PREAMBLE_WORDS = (
    "текст",
    "розшифров",
    "транскрип",
    "версі",
    "результат",
    "варіант",
    "ось",
    "here",
    "transcript",
)


def strip_wrapper(text: str) -> str:
    """Прибирає markdown-огорожу, зайві лапки та службову преамбулу моделі."""
    cleaned = text.strip()

    fence = _FENCE_RE.match(cleaned)
    if fence:
        cleaned = fence.group(1).strip()

    if len(cleaned) > 1 and cleaned[0] in '"«“' and cleaned[-1] in '"»”':
        inner = cleaned[1:-1]
        # Знімаємо лапки лише якщо вони обгортають увесь текст, а не цитату всередині.
        if inner.count('"') == 0 and inner.count("«") == 0:
            cleaned = inner.strip()

    head, sep, tail = cleaned.partition("\n")
    if sep and head.rstrip().endswith(":") and len(head) <= 80:
        lowered = head.lower()
        if any(word in lowered for word in _PREAMBLE_WORDS):
            cleaned = tail.strip()

    return cleaned


_MARKER_RE = re.compile(rf"\s*{re.escape(CHUNK_MARKER.strip())}\s*")


def normalize_raw(text: str) -> str:
    """Прибирає технічні маркери зі склеєного транскрипту."""
    return _MARKER_RE.sub(" ", text).strip()


async def process_transcript(
    transcript: str,
    user: UserSettings,
    client: OpenRouterClient,
    temperature: float = 0.2,
) -> str:
    """Повертає оброблений текст. Для стилю `raw` LLM не викликається."""
    transcript = transcript.strip()
    if not transcript:
        return ""

    if user.style == "raw":
        return normalize_raw(transcript)

    system = build_system_prompt(
        style=user.style, glossary=user.glossary, extra_prompt=user.extra_prompt
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": build_user_message(user.style, transcript)},
    ]

    result = await client.complete(
        model=user.llm_model,
        messages=messages,
        temperature=temperature_for(user.style, temperature),
    )
    cleaned = strip_wrapper(result)

    if not cleaned:
        logger.warning("Модель повернула порожній текст, віддаю сирий транскрипт")
        return normalize_raw(transcript)
    return cleaned


def split_for_telegram(text: str, limit: int = _SAFE_CHUNK) -> list[str]:
    """Ріже довгий текст на повідомлення, не розриваючи абзаци й речення."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]

    parts: list[str] = []
    remainder = text

    while len(remainder) > limit:
        window = remainder[:limit]
        cut = window.rfind("\n\n")
        if cut < limit // 2:
            cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
            cut = cut + 1 if cut != -1 else -1
        if cut < limit // 2:
            cut = window.rfind(" ")
        if cut <= 0:
            cut = limit

        parts.append(remainder[:cut].strip())
        remainder = remainder[cut:].strip()

    if remainder:
        parts.append(remainder)
    return parts
