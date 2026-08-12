"""Тести оркестрації розпізнавання: конвертація, нарізка, склеювання."""

from __future__ import annotations

from pathlib import Path

import pytest

from bot.services.audio import AudioError
from bot.services.stt import CHUNK_MARKER, transcribe_audio
from bot.services.stt.base import TranscriptionBackend


class FakeBackend(TranscriptionBackend):
    provider = "Fake"

    def __init__(self, texts: list[str], needs_mp3: bool = False, max_bytes: int = 10**9):
        super().__init__(model="fake-1")
        self.needs_mp3 = needs_mp3
        self.max_file_bytes = max_bytes
        self._texts = texts
        self.seen: list[tuple[str, str]] = []

    async def transcribe(self, path: Path, hint: str = "") -> str:
        self.seen.append((path.name, hint))
        return self._texts[len(self.seen) - 1]


@pytest.fixture
def audio_file(tmp_path: Path) -> Path:
    path = tmp_path / "audio.ogg"
    path.write_bytes(b"x" * 1024)
    return path


@pytest.mark.asyncio
async def test_single_chunk_without_ffmpeg(
    audio_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("bot.services.stt.ffmpeg_available", lambda: False)
    backend = FakeBackend(["Розшифровка."])

    result = await transcribe_audio(
        audio_file, backend, tmp_path, chunk_target_seconds=600, hint="Kubernetes"
    )

    assert result == "Розшифровка."
    assert backend.seen == [("audio.ogg", "Kubernetes")]


@pytest.mark.asyncio
async def test_chunks_are_joined_with_marker(
    audio_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parts = [tmp_path / "p0.ogg", tmp_path / "p1.ogg"]
    for part in parts:
        part.write_bytes(b"x" * 512)

    async def fake_split(src, target_seconds, workdir, to_mp3=False):
        return parts

    monkeypatch.setattr("bot.services.stt.ffmpeg_available", lambda: True)
    monkeypatch.setattr("bot.services.stt.split_audio", fake_split)
    backend = FakeBackend(["Перша частина.", "Друга частина."])

    result = await transcribe_audio(audio_file, backend, tmp_path, chunk_target_seconds=60)

    assert result == f"Перша частина.{CHUNK_MARKER}Друга частина."
    assert [name for name, _ in backend.seen] == ["p0.ogg", "p1.ogg"]


@pytest.mark.asyncio
async def test_empty_chunks_are_dropped(
    audio_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    parts = [tmp_path / "p0.ogg", tmp_path / "p1.ogg"]
    for part in parts:
        part.write_bytes(b"x" * 512)

    monkeypatch.setattr("bot.services.stt.ffmpeg_available", lambda: True)
    monkeypatch.setattr(
        "bot.services.stt.split_audio",
        lambda src, target_seconds, workdir, to_mp3=False: _async(parts),
    )
    backend = FakeBackend(["   ", "Єдина частина."])

    result = await transcribe_audio(audio_file, backend, tmp_path, chunk_target_seconds=60)
    assert result == "Єдина частина."


@pytest.mark.asyncio
async def test_mp3_backend_without_ffmpeg_fails_clearly(
    audio_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("bot.services.stt.ffmpeg_available", lambda: False)
    backend = FakeBackend(["не дійде"], needs_mp3=True)

    with pytest.raises(AudioError, match="ffmpeg"):
        await transcribe_audio(audio_file, backend, tmp_path, chunk_target_seconds=600)


@pytest.mark.asyncio
async def test_oversized_chunk_is_rejected(
    audio_file: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ffmpeg є, але навіть після стиснення шматок не влазить у ліміт API.
    compressed = tmp_path / "audio.mp3"
    compressed.write_bytes(b"x" * 900)

    monkeypatch.setattr("bot.services.stt.ffmpeg_available", lambda: True)
    monkeypatch.setattr(
        "bot.services.stt.convert_to_mp3", lambda src, dst: _async(compressed)
    )
    monkeypatch.setattr(
        "bot.services.stt.split_audio",
        lambda src, target_seconds, workdir, to_mp3=False: _async([compressed]),
    )
    backend = FakeBackend(["не дійде"], max_bytes=10)

    with pytest.raises(AudioError, match="завеликий"):
        await transcribe_audio(audio_file, backend, tmp_path, chunk_target_seconds=600)


async def _async(value):
    return value
