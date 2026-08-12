"""Тести обробки тексту після LLM."""

from __future__ import annotations

import pytest

from bot.services.cleanup import normalize_raw, split_for_telegram, strip_wrapper


class TestStripWrapper:
    def test_removes_markdown_fence(self) -> None:
        assert strip_wrapper("```\nПривіт, світе.\n```") == "Привіт, світе."

    def test_removes_language_fence(self) -> None:
        assert strip_wrapper("```text\nПривіт.\n```") == "Привіт."

    def test_removes_preamble_line(self) -> None:
        raw = "Ось відредагований текст:\nСьогодні ми запускаємо проєкт."
        assert strip_wrapper(raw) == "Сьогодні ми запускаємо проєкт."

    def test_keeps_legitimate_colon_line(self) -> None:
        raw = "Порядок денний:\nПерше питання — бюджет."
        assert strip_wrapper(raw) == raw

    def test_unwraps_surrounding_quotes(self) -> None:
        assert strip_wrapper("«Текст без лапок усередині.»") == "Текст без лапок усередині."

    def test_keeps_inner_quotes(self) -> None:
        raw = '"Він сказав "так" і пішов."'
        assert strip_wrapper(raw) == raw

    def test_plain_text_untouched(self) -> None:
        raw = "Звичайний текст.\n\nДругий абзац."
        assert strip_wrapper(raw) == raw


class TestNormalizeRaw:
    def test_removes_chunk_markers(self) -> None:
        assert normalize_raw("перша частина\n[...]\nдруга частина") == (
            "перша частина друга частина"
        )


class TestSplitForTelegram:
    def test_short_text_is_single_part(self) -> None:
        assert split_for_telegram("Коротко.") == ["Коротко."]

    def test_empty_text_gives_nothing(self) -> None:
        assert split_for_telegram("   ") == []

    def test_prefers_paragraph_boundary(self) -> None:
        text = "А" * 50 + "\n\n" + "Б" * 60
        parts = split_for_telegram(text, limit=80)
        assert parts == ["А" * 50, "Б" * 60]

    def test_falls_back_to_sentence_boundary(self) -> None:
        text = "Перше речення. " + "Друге речення дуже довге. " * 5
        parts = split_for_telegram(text, limit=60)
        assert all(len(part) <= 60 for part in parts)
        assert all(part.endswith(".") for part in parts)

    def test_hard_cut_when_no_boundary(self) -> None:
        text = "я" * 250
        parts = split_for_telegram(text, limit=100)
        assert [len(part) for part in parts] == [100, 100, 50]

    @pytest.mark.parametrize("limit", [50, 120, 500])
    def test_reassembles_to_original_words(self, limit: int) -> None:
        text = "Слово раз. Слово два. " * 40
        parts = split_for_telegram(text, limit=limit)
        assert " ".join(parts).split() == text.split()
