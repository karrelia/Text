"""STT через OpenAI-сумісний /audio/transcriptions (OpenAI або Groq)."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from pathlib import Path

import httpx

from .base import TranscriptionBackend, TranscriptionError

logger = logging.getLogger(__name__)

_RETRIABLE_STATUS = {408, 429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3


class WhisperApiBackend(TranscriptionBackend):
    """Whisper-сумісне API. Приймає ogg/opus напряму, конвертація не потрібна."""

    needs_mp3 = False

    def __init__(
        self,
        model: str,
        api_key: str,
        base_url: str,
        provider: str,
        language: str = "uk",
        timeout: float = 300.0,
    ) -> None:
        super().__init__(model)
        self.provider = provider
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._language = language
        self._timeout = timeout

    async def transcribe(self, path: Path, hint: str = "") -> str:
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = {
            "model": self.model,
            "language": self._language,
            "response_format": "json",
            "temperature": "0",
        }
        if hint:
            data["prompt"] = hint

        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                try:
                    with path.open("rb") as handle:
                        response = await client.post(
                            f"{self._base_url}/audio/transcriptions",
                            headers={"Authorization": f"Bearer {self._api_key}"},
                            data=data,
                            files={"file": (path.name, handle, mime)},
                        )
                except httpx.RequestError as exc:
                    last_error = exc
                    logger.warning("%s: мережева помилка (%s): %s", self.provider, attempt, exc)
                else:
                    if response.status_code in _RETRIABLE_STATUS:
                        last_error = TranscriptionError(
                            f"{self.provider} повернув {response.status_code}"
                        )
                        logger.warning(
                            "%s: %s (спроба %s)", self.provider, response.status_code, attempt
                        )
                    elif response.is_error:
                        raise TranscriptionError(_error_text(self.provider, response))
                    else:
                        return (response.json().get("text") or "").strip()

                if attempt < _MAX_ATTEMPTS:
                    await asyncio.sleep(2**attempt)

        raise TranscriptionError(f"{self.provider} недоступний: {last_error}")


def _error_text(provider: str, response: httpx.Response) -> str:
    try:
        message = (response.json().get("error") or {}).get("message")
        if message:
            return f"{provider} {response.status_code}: {message}"
    except ValueError:
        pass
    body = response.text
    if len(body) > 300:
        body = body[:300] + "…"
    return f"{provider} {response.status_code}: {body}"
