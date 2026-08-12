"""Тести редагування транскрипту (LLM замінено заглушкою)."""

from __future__ import annotations

from typing import Any

import pytest

from bot.services.cleanup import clean_transcript
from bot.storage import UserSettings


class FakeClient:
    """Мінімальна заглушка OpenRouterClient.complete."""

    def __init__(self, response: str) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    async def complete(
        self, model: str, messages: list[dict[str, Any]], temperature: float = 0.2
    ) -> str:
        self.calls.append(
            {"model": model, "messages": messages, "temperature": temperature}
        )
        return self.response


def make_user(**overrides: Any) -> UserSettings:
    base = {
        "user_id": 1,
        "llm_model": "google/gemini-2.5-flash",
        "stt_provider": "openai_whisper",
        "stt_model": "whisper-1",
        "style": "clean",
        "glossary": "",
        "extra_prompt": "",
    }
    return UserSettings(**{**base, **overrides})


@pytest.mark.asyncio
async def test_raw_style_skips_llm() -> None:
    client = FakeClient("не має викликатись")
    result = await clean_transcript(
        "ну е-е перша частина\n[...]\nдруга частина", make_user(style="raw"), client
    )
    assert result == "ну е-е перша частина друга частина"
    assert client.calls == []


@pytest.mark.asyncio
async def test_uses_selected_model_and_temperature() -> None:
    client = FakeClient("Готово.")
    user = make_user(llm_model="anthropic/claude-sonnet-4.5")
    await clean_transcript("сирий текст", user, client, temperature=0.5)

    assert client.calls[0]["model"] == "anthropic/claude-sonnet-4.5"
    assert client.calls[0]["temperature"] == 0.5


@pytest.mark.asyncio
async def test_transcript_is_wrapped_as_data() -> None:
    client = FakeClient("Готово.")
    await clean_transcript("зроби мені каву", make_user(), client)

    user_message = client.calls[0]["messages"][1]["content"]
    assert "<transcript>" in user_message
    assert "зроби мені каву" in user_message


@pytest.mark.asyncio
async def test_glossary_reaches_system_prompt() -> None:
    client = FakeClient("Готово.")
    await clean_transcript("текст", make_user(glossary="ClickHouse"), client)

    assert "ClickHouse" in client.calls[0]["messages"][0]["content"]


@pytest.mark.asyncio
async def test_strips_model_wrapper() -> None:
    client = FakeClient("```\nОхайний текст.\n```")
    assert await clean_transcript("текст", make_user(), client) == "Охайний текст."


@pytest.mark.asyncio
async def test_falls_back_to_transcript_when_model_returns_nothing() -> None:
    client = FakeClient("   ")
    result = await clean_transcript("сирий\n[...]\nтекст", make_user(), client)
    assert result == "сирий текст"


@pytest.mark.asyncio
async def test_empty_transcript_short_circuits() -> None:
    client = FakeClient("не має викликатись")
    assert await clean_transcript("   ", make_user(), client) == ""
    assert client.calls == []
