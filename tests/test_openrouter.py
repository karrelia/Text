"""Тести клієнта OpenRouter на замоканому транспорті."""

from __future__ import annotations

import httpx
import pytest

from bot.services.openrouter import OpenRouterClient, OpenRouterError


def make_client(handler) -> OpenRouterClient:
    client = OpenRouterClient(api_key="test")
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client


def reply(payload: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=payload)


def completion(content) -> dict:
    return {"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}


@pytest.mark.asyncio
async def test_returns_plain_content() -> None:
    client = make_client(lambda request: reply(completion("Готовий текст.")))
    assert await client.complete("m", [{"role": "user", "content": "x"}]) == "Готовий текст."
    await client.aclose()


@pytest.mark.asyncio
async def test_joins_content_parts() -> None:
    parts = [{"type": "text", "text": "Перша "}, {"type": "text", "text": "друга."}]
    client = make_client(lambda request: reply(completion(parts)))
    assert await client.complete("m", []) == "Перша друга."
    await client.aclose()


@pytest.mark.asyncio
async def test_raises_on_error_body_with_200() -> None:
    client = make_client(lambda request: reply({"error": {"message": "no credits"}}))
    with pytest.raises(OpenRouterError, match="no credits"):
        await client.complete("m", [])
    await client.aclose()


@pytest.mark.asyncio
async def test_raises_on_client_error() -> None:
    client = make_client(
        lambda request: reply({"error": {"message": "bad model"}}, status=400)
    )
    with pytest.raises(OpenRouterError, match="bad model"):
        await client.complete("m", [])
    await client.aclose()


@pytest.mark.asyncio
async def test_raises_on_empty_choices() -> None:
    client = make_client(lambda request: reply({"choices": []}))
    with pytest.raises(OpenRouterError, match="порожню відповідь"):
        await client.complete("m", [])
    await client.aclose()


@pytest.mark.asyncio
async def test_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("bot.services.openrouter.asyncio.sleep", _no_sleep)
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] == 1:
            return httpx.Response(503, text="overloaded")
        return reply(completion("Нарешті."))

    client = make_client(handler)
    assert await client.complete("m", []) == "Нарешті."
    assert attempts["count"] == 2
    await client.aclose()


@pytest.mark.asyncio
async def test_gives_up_after_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("bot.services.openrouter.asyncio.sleep", _no_sleep)
    client = make_client(lambda request: httpx.Response(429, text="slow down"))
    with pytest.raises(OpenRouterError, match="недоступний"):
        await client.complete("m", [])
    await client.aclose()


@pytest.mark.asyncio
async def test_search_filters_audio_models() -> None:
    catalog = {
        "data": [
            {
                "id": "google/gemini-2.5-flash",
                "name": "Gemini 2.5 Flash",
                "architecture": {"input_modalities": ["text", "image", "audio"]},
            },
            {
                "id": "anthropic/claude-sonnet-4.5",
                "name": "Claude Sonnet 4.5",
                "architecture": {"input_modalities": ["text", "image"]},
            },
        ]
    }
    client = make_client(lambda request: reply(catalog))

    assert [m.id for m in await client.search_models("")] == [
        "anthropic/claude-sonnet-4.5",
        "google/gemini-2.5-flash",
    ]
    assert [m.id for m in await client.search_models("", audio_only=True)] == [
        "google/gemini-2.5-flash"
    ]
    assert [m.id for m in await client.search_models("claude")] == [
        "anthropic/claude-sonnet-4.5"
    ]
    assert await client.model_exists("google/gemini-2.5-flash") is True
    assert await client.model_exists("вигадана/модель") is False
    await client.aclose()


@pytest.mark.asyncio
async def test_model_exists_unknown_when_catalog_unavailable() -> None:
    client = make_client(lambda request: httpx.Response(500, text="down"))
    assert await client.model_exists("будь-яка") is None
    await client.aclose()


async def _no_sleep(_seconds: float) -> None:
    return None
