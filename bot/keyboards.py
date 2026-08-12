"""Інлайн-клавіатури та кеш варіантів вибору."""

from __future__ import annotations

from collections import OrderedDict

from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from .config import STT_PROVIDERS, Settings
from .prompts import STYLES
from .services.openrouter import ModelInfo
from .services.stt import PROVIDER_TITLES

#: Моделі-«за замовчуванням», які показуються без пошуку.
PRESET_LLM_MODELS = (
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-haiku-4.5",
    "openai/gpt-5-mini",
    "openai/gpt-5",
    "meta-llama/llama-3.3-70b-instruct",
    "qwen/qwen3-235b-a22b",
)

PRESET_AUDIO_MODELS = (
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "openai/gpt-4o-audio-preview",
)


class Pick(CallbackData, prefix="pick"):
    """Вибір варіанта з кешованого списку (id моделей задовгі для callback_data)."""

    kind: str
    index: int


class SetValue(CallbackData, prefix="set"):
    """Вибір значення з короткого фіксованого набору."""

    kind: str
    value: str


class _ChoiceCache:
    """Останні показані користувачу списки. Обмежений розмір, без БД."""

    def __init__(self, max_entries: int = 256) -> None:
        self._data: OrderedDict[tuple[int, str], list[str]] = OrderedDict()
        self._max_entries = max_entries

    def put(self, user_id: int, kind: str, values: list[str]) -> None:
        key = (user_id, kind)
        self._data[key] = values
        self._data.move_to_end(key)
        while len(self._data) > self._max_entries:
            self._data.popitem(last=False)

    def get(self, user_id: int, kind: str, index: int) -> str | None:
        values = self._data.get((user_id, kind))
        if values is None or not 0 <= index < len(values):
            return None
        return values[index]


choice_cache = _ChoiceCache()


def models_keyboard(
    user_id: int, kind: str, models: list[ModelInfo] | list[str], current: str
) -> InlineKeyboardMarkup:
    ids = [m.id if isinstance(m, ModelInfo) else m for m in models]
    choice_cache.put(user_id, kind, ids)

    builder = InlineKeyboardBuilder()
    for index, model_id in enumerate(ids):
        mark = "✅ " if model_id == current else ""
        builder.row(
            InlineKeyboardButton(
                text=f"{mark}{model_id}",
                callback_data=Pick(kind=kind, index=index).pack(),
            )
        )
    return builder.as_markup()


def providers_keyboard(current: str, settings: Settings) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for provider in STT_PROVIDERS:
        mark = "✅ " if provider == current else ""
        lock = "" if settings.key_for_provider(provider) else " 🔒"
        builder.row(
            InlineKeyboardButton(
                text=f"{mark}{PROVIDER_TITLES[provider]}{lock}",
                callback_data=SetValue(kind="provider", value=provider).pack(),
            )
        )
    return builder.as_markup()


def styles_keyboard(current: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for key, style in STYLES.items():
        mark = "✅ " if key == current else ""
        builder.row(
            InlineKeyboardButton(
                text=f"{mark}{style['title']}",
                callback_data=SetValue(kind="style", value=key).pack(),
            )
        )
    return builder.as_markup()
