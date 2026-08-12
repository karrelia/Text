"""STT через мультимодальні моделі OpenRouter (audio input)."""

from __future__ import annotations

import base64
from pathlib import Path

from ...prompts import AUDIO_TRANSCRIBE_PROMPT
from ..openrouter import OpenRouterClient, OpenRouterError
from .base import TranscriptionBackend, TranscriptionError

# OpenRouter приймає в input_audio лише wav та mp3.
_SUPPORTED_FORMATS = {".mp3": "mp3", ".wav": "wav"}


class OpenRouterAudioBackend(TranscriptionBackend):
    provider = "OpenRouter"
    needs_mp3 = True
    # Base64 роздуває файл на ~33%, тож тримаємо запас за розміром запиту.
    max_file_bytes = 15 * 1024 * 1024

    def __init__(self, model: str, client: OpenRouterClient) -> None:
        super().__init__(model)
        self._client = client

    async def transcribe(self, path: Path, hint: str = "") -> str:
        audio_format = _SUPPORTED_FORMATS.get(path.suffix.lower())
        if audio_format is None:
            raise TranscriptionError(
                f"OpenRouter приймає лише mp3 та wav, а не {path.suffix or 'файл без розширення'}."
            )

        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        instruction = AUDIO_TRANSCRIBE_PROMPT
        if hint:
            instruction += f"\n\nПідказка щодо власних назв: {hint}"

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": instruction},
                    {
                        "type": "input_audio",
                        "input_audio": {"data": encoded, "format": audio_format},
                    },
                ],
            }
        ]

        try:
            text = await self._client.complete(
                model=self.model, messages=messages, temperature=0.0
            )
        except OpenRouterError as exc:
            raise TranscriptionError(str(exc)) from exc
        return text.strip()
