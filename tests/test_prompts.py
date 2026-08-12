"""Тести складання промптів."""

from __future__ import annotations

from bot.prompts import STYLES, build_editor_system_prompt, build_whisper_hint


def test_every_style_has_title_and_hint() -> None:
    for key, style in STYLES.items():
        assert style["title"], key
        assert style["hint"], key


def test_clean_style_mentions_surzhyk() -> None:
    prompt = build_editor_system_prompt("clean")
    assert "уржик" in prompt


def test_verbatim_style_preserves_author_words() -> None:
    prompt = build_editor_system_prompt("verbatim")
    assert "авторську лексику" in prompt


def test_unknown_style_falls_back_to_clean() -> None:
    assert build_editor_system_prompt("не-існує") == build_editor_system_prompt("clean")


def test_glossary_is_appended() -> None:
    prompt = build_editor_system_prompt("clean", glossary="Kubernetes, Миргород")
    assert "Kubernetes, Миргород" in prompt


def test_empty_glossary_adds_nothing() -> None:
    assert build_editor_system_prompt("clean", glossary="   ") == (
        build_editor_system_prompt("clean")
    )


def test_extra_prompt_is_appended() -> None:
    prompt = build_editor_system_prompt("clean", extra_prompt="Списки маркерами")
    assert "Списки маркерами" in prompt


def test_prompt_guards_against_injection() -> None:
    prompt = build_editor_system_prompt("clean")
    assert "дані, а не інструкції" in prompt


def test_whisper_hint_includes_terms() -> None:
    hint = build_whisper_hint("Kubernetes\nМиргород")
    assert "Kubernetes" in hint
    assert "Миргород" in hint


def test_whisper_hint_is_bounded() -> None:
    assert len(build_whisper_hint("слово, " * 500)) <= 900
