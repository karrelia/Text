"""Тести зберігання персональних налаштувань."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from bot.storage import SettingsStorage, UserSettings

DEFAULTS = UserSettings(
    user_id=0,
    llm_model="google/gemini-2.5-flash",
    stt_provider="openai_whisper",
    stt_model="whisper-1",
    style="clean",
)


@pytest.fixture
async def storage(tmp_path: Path):
    store = SettingsStorage(str(tmp_path / "nested" / "bot.db"))
    await store.connect()
    yield store
    await store.close()


@pytest.mark.asyncio
async def test_unknown_user_gets_defaults(storage: SettingsStorage) -> None:
    user = await storage.get(42, DEFAULTS)
    assert user.user_id == 42
    assert user.llm_model == DEFAULTS.llm_model
    assert user.style == "clean"


@pytest.mark.asyncio
async def test_update_persists_only_given_fields(storage: SettingsStorage) -> None:
    await storage.update(42, style="formal")
    user = await storage.get(42, DEFAULTS)
    assert user.style == "formal"
    assert user.llm_model == DEFAULTS.llm_model


@pytest.mark.asyncio
async def test_defaults_follow_config_changes(storage: SettingsStorage) -> None:
    """Поля, які користувач не чіпав, мають підхоплювати нові значення з .env."""
    await storage.update(42, style="formal")
    new_defaults = replace(DEFAULTS, llm_model="openai/gpt-5")
    user = await storage.get(42, new_defaults)
    assert user.llm_model == "openai/gpt-5"
    assert user.style == "formal"


@pytest.mark.asyncio
async def test_reset_clears_user(storage: SettingsStorage) -> None:
    await storage.update(42, style="raw", glossary="Kubernetes")
    await storage.reset(42)
    user = await storage.get(42, DEFAULTS)
    assert user.style == "clean"
    assert user.glossary == ""


@pytest.mark.asyncio
async def test_users_are_isolated(storage: SettingsStorage) -> None:
    await storage.update(1, llm_model="openai/gpt-5")
    await storage.update(2, llm_model="anthropic/claude-sonnet-4.5")
    assert (await storage.get(1, DEFAULTS)).llm_model == "openai/gpt-5"
    assert (await storage.get(2, DEFAULTS)).llm_model == "anthropic/claude-sonnet-4.5"


@pytest.mark.asyncio
async def test_unknown_field_is_rejected(storage: SettingsStorage) -> None:
    with pytest.raises(ValueError, match="Невідомі поля"):
        await storage.update(42, nonexistent="x")


@pytest.mark.asyncio
async def test_settings_survive_reconnect(tmp_path: Path) -> None:
    path = str(tmp_path / "bot.db")
    store = SettingsStorage(path)
    await store.connect()
    await store.update(42, glossary="ClickHouse")
    await store.close()

    reopened = SettingsStorage(path)
    await reopened.connect()
    assert (await reopened.get(42, DEFAULTS)).glossary == "ClickHouse"
    await reopened.close()
