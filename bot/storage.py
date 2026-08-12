"""Персональні налаштування користувачів у SQLite."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Any

import aiosqlite

_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_settings (
    user_id       INTEGER PRIMARY KEY,
    llm_model     TEXT,
    stt_provider  TEXT,
    stt_model     TEXT,
    style         TEXT,
    glossary      TEXT NOT NULL DEFAULT '',
    extra_prompt  TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Поля, що можуть бути NULL і тоді беруться з глобального конфігу.
_INHERITED = ("llm_model", "stt_provider", "stt_model", "style")


@dataclass(frozen=True, slots=True)
class UserSettings:
    user_id: int
    llm_model: str
    stt_provider: str
    stt_model: str
    style: str
    glossary: str = ""
    extra_prompt: str = ""


class SettingsStorage:
    """Тонка обгортка над SQLite. Одне з'єднання на процес."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        directory = os.path.dirname(self._db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("SettingsStorage.connect() не був викликаний")
        return self._db

    async def get(self, user_id: int, defaults: UserSettings) -> UserSettings:
        """Повертає налаштування користувача, підставляючи defaults для порожніх полів."""
        async with self.db.execute(
            "SELECT * FROM user_settings WHERE user_id = ?", (user_id,)
        ) as cursor:
            row = await cursor.fetchone()

        if row is None:
            return replace(defaults, user_id=user_id)

        values: dict[str, Any] = {
            "user_id": user_id,
            "glossary": row["glossary"] or "",
            "extra_prompt": row["extra_prompt"] or "",
        }
        for field in _INHERITED:
            values[field] = row[field] or getattr(defaults, field)
        return UserSettings(**values)

    async def update(self, user_id: int, **fields: str) -> None:
        unknown = set(fields) - {*_INHERITED, "glossary", "extra_prompt"}
        if unknown:
            raise ValueError(f"Невідомі поля налаштувань: {sorted(unknown)}")
        if not fields:
            return

        assignments = ", ".join(f"{name} = ?" for name in fields)
        await self.db.execute(
            "INSERT INTO user_settings (user_id) VALUES (?) "
            "ON CONFLICT(user_id) DO NOTHING",
            (user_id,),
        )
        await self.db.execute(
            f"UPDATE user_settings SET {assignments}, updated_at = datetime('now') "
            "WHERE user_id = ?",
            (*fields.values(), user_id),
        )
        await self.db.commit()

    async def reset(self, user_id: int) -> None:
        await self.db.execute("DELETE FROM user_settings WHERE user_id = ?", (user_id,))
        await self.db.commit()
