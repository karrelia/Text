"""Спільні залежності хендлерів."""

from __future__ import annotations

from dataclasses import dataclass

from .config import Settings
from .prompts import DEFAULT_STYLE
from .services.openrouter import OpenRouterClient
from .storage import SettingsStorage, UserSettings


@dataclass(slots=True)
class Deps:
    settings: Settings
    storage: SettingsStorage
    openrouter: OpenRouterClient

    def defaults(self) -> UserSettings:
        return UserSettings(
            user_id=0,
            llm_model=self.settings.llm_model,
            stt_provider=self.settings.stt_provider,
            stt_model=self.settings.default_model_for_provider(
                self.settings.stt_provider
            ),
            style=DEFAULT_STYLE,
        )

    async def user_settings(self, user_id: int) -> UserSettings:
        return await self.storage.get(user_id, self.defaults())
