"""Middleware доступу: пускаємо лише користувачів із whitelist."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject

from . import texts

logger = logging.getLogger(__name__)


class AccessMiddleware(BaseMiddleware):
    def __init__(self, allowed_user_ids: list[int]) -> None:
        self._allowed = set(allowed_user_ids)

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get("event_from_user")
        if user is None:
            return None

        if user.id in self._allowed:
            return await handler(event, data)

        logger.warning("Відмовлено в доступі: id=%s username=%s", user.id, user.username)
        await self._deny(event, user.id)
        return None

    @staticmethod
    async def _deny(event: TelegramObject, user_id: int) -> None:
        if isinstance(event, Message):
            await event.answer(texts.NO_ACCESS.format(user_id=user_id))
        elif isinstance(event, CallbackQuery):
            await event.answer("Немає доступу", show_alert=True)
