"""Клієнт OpenRouter: чат-завершення та каталог моделей."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_RETRIABLE_STATUS = {408, 409, 429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3
_MODELS_TTL_SECONDS = 3600


class OpenRouterError(RuntimeError):
    """Помилка виклику OpenRouter, придатна для показу користувачу."""


@dataclass(frozen=True, slots=True)
class ModelInfo:
    id: str
    name: str
    modalities: tuple[str, ...]

    @property
    def supports_audio(self) -> bool:
        return "audio" in self.modalities


class OpenRouterClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://openrouter.ai/api/v1",
        app_url: str = "",
        app_title: str = "",
        timeout: float = 180.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        headers = {"Authorization": f"Bearer {api_key}"}
        if app_url:
            headers["HTTP-Referer"] = app_url
        if app_title:
            headers["X-Title"] = app_title
        self._client = httpx.AsyncClient(headers=headers, timeout=timeout)
        self._models_cache: list[ModelInfo] = []
        self._models_fetched_at = 0.0
        self._models_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ── Чат ──────────────────────────────────────────────────────────────────

    async def complete(
        self,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> str:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        data = await self._post("/chat/completions", payload)

        choices = data.get("choices") or []
        if not choices:
            raise OpenRouterError(
                f"Модель {model} повернула порожню відповідь: {_short(data)}"
            )
        content = (choices[0].get("message") or {}).get("content") or ""
        if isinstance(content, list):
            # Деякі моделі повертають контент частинами.
            content = "".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        if not content.strip():
            finish = choices[0].get("finish_reason")
            raise OpenRouterError(
                f"Модель {model} не повернула тексту (finish_reason={finish})."
            )
        return content

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None

        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = await self._client.post(self._base_url + path, json=payload)
            except httpx.RequestError as exc:
                last_error = exc
                logger.warning("OpenRouter мережева помилка (спроба %s): %s", attempt, exc)
            else:
                if response.status_code in _RETRIABLE_STATUS:
                    last_error = OpenRouterError(
                        f"OpenRouter повернув {response.status_code}: "
                        f"{_short(response.text)}"
                    )
                    logger.warning("OpenRouter %s (спроба %s)", response.status_code, attempt)
                elif response.is_error:
                    raise OpenRouterError(_api_error_text(response))
                else:
                    data = response.json()
                    # OpenRouter може віддати 200 з тілом-помилкою.
                    if isinstance(data.get("error"), dict):
                        raise OpenRouterError(
                            data["error"].get("message") or _short(data["error"])
                        )
                    return data

            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(2**attempt)

        raise OpenRouterError(f"OpenRouter недоступний: {last_error}")

    # ── Каталог моделей ──────────────────────────────────────────────────────

    async def list_models(self, force: bool = False) -> list[ModelInfo]:
        async with self._models_lock:
            fresh = time.monotonic() - self._models_fetched_at < _MODELS_TTL_SECONDS
            if self._models_cache and fresh and not force:
                return self._models_cache

            try:
                response = await self._client.get(self._base_url + "/models")
                response.raise_for_status()
                raw = response.json().get("data") or []
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("Не вдалося отримати каталог моделей: %s", exc)
                return self._models_cache

            models = [
                ModelInfo(
                    id=item["id"],
                    name=item.get("name") or item["id"],
                    modalities=tuple(
                        (item.get("architecture") or {}).get("input_modalities") or ()
                    ),
                )
                for item in raw
                if item.get("id")
            ]
            models.sort(key=lambda m: m.id)
            self._models_cache = models
            self._models_fetched_at = time.monotonic()
            return models

    async def search_models(
        self, query: str, audio_only: bool = False, limit: int = 12
    ) -> list[ModelInfo]:
        models = await self.list_models()
        if audio_only:
            models = [m for m in models if m.supports_audio]

        needle = query.strip().lower()
        if not needle:
            return models[:limit]

        matches = [
            m for m in models if needle in m.id.lower() or needle in m.name.lower()
        ]
        # Точніші збіги (за префіксом id) — вище.
        matches.sort(key=lambda m: (not m.id.lower().startswith(needle), m.id))
        return matches[:limit]

    async def model_exists(self, model_id: str) -> bool | None:
        """True/False, або None якщо каталог недоступний і перевірити нічим."""
        models = await self.list_models()
        if not models:
            return None
        return any(m.id == model_id for m in models)


def _api_error_text(response: httpx.Response) -> str:
    try:
        payload = response.json()
        message = (payload.get("error") or {}).get("message")
        if message:
            return f"OpenRouter {response.status_code}: {message}"
    except ValueError:
        pass
    return f"OpenRouter {response.status_code}: {_short(response.text)}"


def _short(value: object, limit: int = 300) -> str:
    text = str(value)
    return text if len(text) <= limit else text[:limit] + "…"
