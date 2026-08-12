"""Робота з аудіофайлами через ffmpeg: конвертація та нарізка довгих записів."""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

_SILENCE_END_RE = re.compile(r"silence_end:\s*([0-9.]+)")


class AudioError(RuntimeError):
    """Помилка обробки аудіо, придатна для показу користувачу."""


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


async def _run(program: str, *args: str) -> tuple[int, str]:
    process = await asyncio.create_subprocess_exec(
        program,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await process.communicate()
    return process.returncode or 0, output.decode("utf-8", errors="replace")


async def probe_duration(path: Path) -> float | None:
    """Тривалість запису в секундах, або None якщо визначити не вдалось."""
    code, output = await _run(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    )
    if code != 0:
        logger.warning("ffprobe завершився з кодом %s: %s", code, output.strip())
        return None
    try:
        return float(output.strip())
    except ValueError:
        return None


async def convert_to_mp3(src: Path, dst: Path, bitrate: str = "64k") -> Path:
    """Моно 16 кГц mp3 — компактно і достатньо для мовлення."""
    code, output = await _run(
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        bitrate,
        str(dst),
    )
    if code != 0 or not dst.exists():
        raise AudioError(f"ffmpeg не зміг конвертувати аудіо: {output.strip()[-300:]}")
    return dst


async def detect_silence_points(
    path: Path, noise_db: int = -32, min_duration: float = 0.4
) -> list[float]:
    """Моменти (сек), де закінчуються паузи — зручні місця для розрізу."""
    code, output = await _run(
        "ffmpeg",
        "-i",
        str(path),
        "-af",
        f"silencedetect=noise={noise_db}dB:d={min_duration}",
        "-f",
        "null",
        "-",
    )
    if code != 0:
        logger.warning("silencedetect не спрацював, ріжемо за часом")
        return []
    return [float(match) for match in _SILENCE_END_RE.findall(output)]


def plan_cut_points(
    duration: float, silences: list[float], target: float
) -> list[float]:
    """Точки розрізу: якнайближче до target, але по паузі в мовленні.

    Вікно пошуку — [target*0.5, target] від початку поточного шматка. Якщо
    паузи в ньому немає, ріжемо рівно по target.
    """
    if target <= 0 or duration <= target:
        return []

    cuts: list[float] = []
    start = 0.0
    while duration - start > target:
        window_start = start + target * 0.5
        window_end = start + target
        candidates = [s for s in silences if window_start <= s <= window_end]
        cut = max(candidates) if candidates else window_end
        # Захист від зациклення, якщо пауза збіглась із початком шматка.
        if cut <= start + 1.0:
            cut = window_end
        cuts.append(cut)
        start = cut
    return cuts


async def split_audio(
    src: Path, target_seconds: int, workdir: Path, to_mp3: bool = False
) -> list[Path]:
    """Ріже запис на шматки ~target_seconds. Короткий запис повертає як є."""
    duration = await probe_duration(src)
    if duration is None or target_seconds <= 0 or duration <= target_seconds * 1.2:
        return [src]

    silences = await detect_silence_points(src)
    cuts = plan_cut_points(duration, silences, float(target_seconds))
    if not cuts:
        return [src]

    boundaries = [0.0, *cuts, duration]
    suffix = ".mp3" if to_mp3 else src.suffix
    parts: list[Path] = []

    for index in range(len(boundaries) - 1):
        start, end = boundaries[index], boundaries[index + 1]
        part = workdir / f"{src.stem}_part{index:02d}{suffix}"
        args = [
            "-y",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(src),
            "-vn",
        ]
        if to_mp3:
            args += ["-ac", "1", "-ar", "16000", "-b:a", "64k"]
        else:
            args += ["-c", "copy"]
        args.append(str(part))

        code, output = await _run("ffmpeg", *args)
        if code != 0 or not part.exists():
            raise AudioError(f"ffmpeg не зміг нарізати аудіо: {output.strip()[-300:]}")
        parts.append(part)

    logger.info("Запис %.0f с розрізано на %s шматків", duration, len(parts))
    return parts
