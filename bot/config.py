"""Конфігурація бота: змінні оточення та .env."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

SttProvider = Literal["openai_whisper", "groq_whisper", "openrouter"]

STT_PROVIDERS: tuple[SttProvider, ...] = ("openai_whisper", "groq_whisper", "openrouter")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    telegram_bot_token: str
    openrouter_api_key: str
    # NoDecode: інакше pydantic-settings спробує розібрати значення як JSON
    # і "111,222" впаде з помилкою ще до валідатора нижче.
    allowed_user_ids: Annotated[list[int], NoDecode] = Field(default_factory=list)

    stt_provider: SttProvider = "openai_whisper"

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_whisper_model: str = "whisper-1"

    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_whisper_model: str = "whisper-large-v3"

    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_audio_model: str = "google/gemini-2.5-flash"
    openrouter_app_url: str = "https://github.com/karrelia/Text"
    openrouter_app_title: str = "Voice2Text UA Bot"

    llm_model: str = "google/gemini-2.5-flash"
    llm_temperature: float = 0.2

    max_audio_seconds: int = 5400
    chunk_target_seconds: int = 600

    mode: Literal["polling", "webhook"] = "polling"
    webhook_base_url: str = ""
    webhook_path: str = "/telegram/webhook"
    webhook_secret: str = ""
    webapp_host: str = "0.0.0.0"
    webapp_port: int = 8080

    db_path: str = "data/bot.db"
    log_level: str = "INFO"

    @field_validator("allowed_user_ids", mode="before")
    @classmethod
    def _parse_ids(cls, value: object) -> object:
        """Дозволяє задавати список як "111,222" або "111 222"."""
        if isinstance(value, str):
            raw = value.replace(",", " ").split()
            return [int(item) for item in raw]
        return value

    @field_validator("stt_provider", mode="before")
    @classmethod
    def _normalize_provider(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    def key_for_provider(self, provider: str) -> str:
        return {
            "openai_whisper": self.openai_api_key,
            "groq_whisper": self.groq_api_key,
            "openrouter": self.openrouter_api_key,
        }.get(provider, "")

    def default_model_for_provider(self, provider: str) -> str:
        return {
            "openai_whisper": self.openai_whisper_model,
            "groq_whisper": self.groq_whisper_model,
            "openrouter": self.openrouter_audio_model,
        }.get(provider, "")

    def available_stt_providers(self) -> list[str]:
        """Провайдери, для яких є ключ."""
        return [p for p in STT_PROVIDERS if self.key_for_provider(p)]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
