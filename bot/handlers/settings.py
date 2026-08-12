"""Команди налаштувань: моделі, рушій STT, стиль, словник, побажання."""

from __future__ import annotations

import logging
from html import escape

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, Message

from .. import texts
from ..config import STT_PROVIDERS
from ..deps import Deps
from ..keyboards import (
    PRESET_AUDIO_MODELS,
    PRESET_LLM_MODELS,
    Pick,
    SetValue,
    choice_cache,
    models_keyboard,
    providers_keyboard,
    styles_keyboard,
)
from ..prompts import STYLES
from ..services.stt import PROVIDER_TITLES

logger = logging.getLogger(__name__)

router = Router(name="settings")

_STALE_CHOICE = "Список застарів — виклич команду ще раз."


# ── Моделі ───────────────────────────────────────────────────────────────────


@router.message(Command("model"))
async def cmd_model(message: Message, command: CommandObject, deps: Deps) -> None:
    await _model_command(
        message,
        command,
        deps,
        kind="llm",
        field="llm_model",
        presets=list(PRESET_LLM_MODELS),
        audio_only=False,
        help_text=texts.MODEL_HELP,
    )


@router.message(Command("sttmodel"))
async def cmd_stt_model(message: Message, command: CommandObject, deps: Deps) -> None:
    await _model_command(
        message,
        command,
        deps,
        kind="stt_model",
        field="stt_model",
        presets=list(PRESET_AUDIO_MODELS),
        audio_only=True,
        help_text=texts.STT_MODEL_HELP,
    )


async def _model_command(
    message: Message,
    command: CommandObject,
    deps: Deps,
    kind: str,
    field: str,
    presets: list[str],
    audio_only: bool,
    help_text: str,
) -> None:
    user_id = message.from_user.id
    user = await deps.user_settings(user_id)
    current = getattr(user, field)
    query = (command.args or "").strip()

    if not query:
        await message.answer(
            help_text.format(current=escape(current)),
            reply_markup=models_keyboard(user_id, kind, presets, current),
        )
        return

    # Схоже на точний ідентифікатор — ставимо одразу.
    if "/" in query and " " not in query:
        exists = await deps.openrouter.model_exists(query)
        if exists is False:
            await message.answer(texts.MODEL_UNKNOWN.format(model=escape(query)))
            return
        await deps.storage.update(user_id, **{field: query})
        await message.answer(f"{texts.SETTINGS_SAVED} Модель: <code>{escape(query)}</code>")
        return

    matches = await deps.openrouter.search_models(query, audio_only=audio_only)
    if not matches:
        await message.answer(texts.NO_MATCHES.format(query=escape(query)))
        return

    await message.answer(
        f"Знайшов за запитом «{escape(query)}»:",
        reply_markup=models_keyboard(user_id, kind, matches, current),
    )


@router.callback_query(Pick.filter(F.kind.in_({"llm", "stt_model"})))
async def on_pick_model(
    callback: CallbackQuery, callback_data: Pick, deps: Deps
) -> None:
    model_id = choice_cache.get(callback.from_user.id, callback_data.kind, callback_data.index)
    if model_id is None:
        await callback.answer(_STALE_CHOICE, show_alert=True)
        return

    field = "llm_model" if callback_data.kind == "llm" else "stt_model"
    await deps.storage.update(callback.from_user.id, **{field: model_id})
    await callback.answer("Збережено")
    if callback.message:
        await callback.message.edit_text(
            f"{texts.SETTINGS_SAVED} Модель: <code>{escape(model_id)}</code>"
        )


# ── Рушій розпізнавання ──────────────────────────────────────────────────────


@router.message(Command("stt"))
async def cmd_stt(message: Message, deps: Deps) -> None:
    user = await deps.user_settings(message.from_user.id)
    current = PROVIDER_TITLES.get(user.stt_provider, user.stt_provider)
    await message.answer(
        texts.STT_PICK.format(current=escape(current)),
        reply_markup=providers_keyboard(user.stt_provider, deps.settings),
    )


@router.callback_query(SetValue.filter(F.kind == "provider"))
async def on_pick_provider(
    callback: CallbackQuery, callback_data: SetValue, deps: Deps
) -> None:
    provider = callback_data.value
    if provider not in STT_PROVIDERS:
        await callback.answer(_STALE_CHOICE, show_alert=True)
        return

    if not deps.settings.key_for_provider(provider):
        await callback.answer(texts.STT_NO_KEY, show_alert=True)
        return

    # Модель прив'язана до провайдера, тож скидаємо її разом із ним.
    await deps.storage.update(
        callback.from_user.id,
        stt_provider=provider,
        stt_model=deps.settings.default_model_for_provider(provider),
    )
    await callback.answer("Збережено")
    if callback.message:
        user = await deps.user_settings(callback.from_user.id)
        await callback.message.edit_text(
            f"{texts.SETTINGS_SAVED}\n\n"
            f"🎧 {escape(PROVIDER_TITLES[provider])}\n"
            f"   модель: <code>{escape(user.stt_model)}</code>"
        )


# ── Стиль ────────────────────────────────────────────────────────────────────


@router.message(Command("style"))
async def cmd_style(message: Message, deps: Deps) -> None:
    user = await deps.user_settings(message.from_user.id)
    style = STYLES.get(user.style, STYLES["clean"])
    await message.answer(
        texts.STYLE_PICK.format(current=escape(style["title"])),
        reply_markup=styles_keyboard(user.style),
    )


@router.callback_query(SetValue.filter(F.kind == "style"))
async def on_pick_style(
    callback: CallbackQuery, callback_data: SetValue, deps: Deps
) -> None:
    style_key = callback_data.value
    if style_key not in STYLES:
        await callback.answer(_STALE_CHOICE, show_alert=True)
        return

    await deps.storage.update(callback.from_user.id, style=style_key)
    await callback.answer("Збережено")
    if callback.message:
        style = STYLES[style_key]
        await callback.message.edit_text(
            f"{texts.SETTINGS_SAVED}\n\n"
            f"✍️ {escape(style['title'])} — {escape(style['hint'])}"
        )


# ── Словник і додаткові побажання ────────────────────────────────────────────


@router.message(Command("glossary"))
async def cmd_glossary(message: Message, command: CommandObject, deps: Deps) -> None:
    await _text_setting(
        message, command, deps, field="glossary", help_text=texts.GLOSSARY_HELP
    )


@router.message(Command("prompt"))
async def cmd_prompt(message: Message, command: CommandObject, deps: Deps) -> None:
    await _text_setting(
        message, command, deps, field="extra_prompt", help_text=texts.PROMPT_HELP
    )


async def _text_setting(
    message: Message,
    command: CommandObject,
    deps: Deps,
    field: str,
    help_text: str,
) -> None:
    user_id = message.from_user.id
    value = (command.args or "").strip()

    if not value:
        user = await deps.user_settings(user_id)
        current = getattr(user, field).strip()
        await message.answer(
            help_text.format(
                current=f"<code>{escape(current)}</code>" if current else "—"
            )
        )
        return

    if value == "-":
        await deps.storage.update(user_id, **{field: ""})
        await message.answer("🧹 Очищено.")
        return

    await deps.storage.update(user_id, **{field: value})
    await message.answer(f"{texts.SETTINGS_SAVED}\n\n<code>{escape(value)}</code>")
