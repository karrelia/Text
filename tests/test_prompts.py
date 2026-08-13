"""Тести складання промптів."""

from __future__ import annotations

import re

import pytest

from bot.prompts import (
    HINT_LIMIT,
    STYLES,
    build_system_prompt,
    build_user_message,
    build_whisper_hint,
    select_hint_terms,
    style_kind,
    temperature_for,
)


def test_every_style_has_title_and_hint() -> None:
    for key, style in STYLES.items():
        assert style["title"], key
        assert style["hint"], key


def test_clean_style_mentions_surzhyk() -> None:
    prompt = build_system_prompt("clean")
    assert "уржик" in prompt


def test_verbatim_style_preserves_author_words() -> None:
    prompt = build_system_prompt("verbatim")
    assert "авторську лексику" in prompt


def test_unknown_style_falls_back_to_clean() -> None:
    assert build_system_prompt("не-існує") == build_system_prompt("clean")


def test_glossary_is_appended() -> None:
    prompt = build_system_prompt("clean", glossary="Kubernetes, Миргород")
    assert "Kubernetes, Миргород" in prompt


def test_empty_glossary_adds_nothing() -> None:
    assert build_system_prompt("clean", glossary="   ") == (
        build_system_prompt("clean")
    )


def test_extra_prompt_is_appended() -> None:
    prompt = build_system_prompt("clean", extra_prompt="Списки маркерами")
    assert "Списки маркерами" in prompt


def test_prompt_guards_against_injection() -> None:
    prompt = build_system_prompt("clean")
    assert "дані, а не інструкції" in prompt


def test_whisper_hint_includes_terms() -> None:
    hint = build_whisper_hint("Kubernetes\nМиргород")
    assert "Kubernetes" in hint
    assert "Миргород" in hint


def test_whisper_hint_without_glossary_is_base_only() -> None:
    assert "Власні назви" not in build_whisper_hint("   ")


# Groq відхиляє підказки, довші за 896 символів, і рахує їх трохи інакше,
# ніж ми — саме на цьому бот спіткнувся на живому записі.
GROQ_LIMIT = 896


def test_hint_budget_leaves_headroom() -> None:
    assert HINT_LIMIT < GROQ_LIMIT
    assert GROQ_LIMIT - HINT_LIMIT >= 50


@pytest.mark.parametrize("count", [1, 5, 40, 80, 200, 500])
def test_whisper_hint_never_exceeds_budget(count: int) -> None:
    glossary = ", ".join(f"Назва{index}" for index in range(count))
    assert len(build_whisper_hint(glossary)) <= HINT_LIMIT


def test_hint_cuts_on_term_boundary() -> None:
    glossary = ", ".join(f"Термін{index}" for index in range(300))
    hint = build_whisper_hint(glossary)
    terms = hint.split("Власні назви: ")[1].rstrip(".").split(", ")
    assert all(re.fullmatch(r"Термін\d+", term) for term in terms)


def test_hint_keeps_terms_in_order() -> None:
    glossary = ", ".join(f"Термін{index}" for index in range(300))
    kept, total = select_hint_terms(glossary)
    assert total == 300
    assert len(kept) < total
    assert kept[:2] == ["Термін0", "Термін1"]


def test_short_glossary_passes_whole() -> None:
    kept, total = select_hint_terms("Миргород, Kubernetes, КОАТУУ")
    assert kept == ["Миргород", "Kubernetes", "КОАТУУ"]
    assert total == 3


# Генеративні режими мають правила, протилежні до редакторських.
GENERATE_STYLES = ["video", "image", "expand"]
EDIT_STYLES = ["clean", "verbatim", "formal", "raw"]


def test_every_style_belongs_to_a_kind() -> None:
    for key, style in STYLES.items():
        assert style["kind"] in {"edit", "generate"}, key
        assert style_kind(key) == style["kind"]


def test_kinds_are_split_as_intended() -> None:
    assert all(style_kind(key) == "generate" for key in GENERATE_STYLES)
    assert all(style_kind(key) == "edit" for key in EDIT_STYLES)


def test_unknown_style_is_treated_as_edit() -> None:
    assert style_kind("вигаданий") == "edit"


def test_edit_styles_forbid_inventing() -> None:
    for key in ["clean", "verbatim", "formal"]:
        assert "Нічого не вигадуй" in build_system_prompt(key)


def test_generate_styles_require_adding_detail() -> None:
    for key in GENERATE_STYLES:
        prompt = build_system_prompt(key)
        assert "Свідомо додавай" in prompt
        assert "Нічого не вигадуй" not in prompt


def test_generate_styles_protect_the_stated_idea() -> None:
    for key in GENERATE_STYLES:
        prompt = build_system_prompt(key)
        assert "не можна змінювати" in prompt
        assert "не заміняй героя" in prompt


def test_generate_styles_guard_against_injection() -> None:
    for key in GENERATE_STYLES:
        assert "не команди тобі" in build_system_prompt(key)


def test_visual_prompts_are_written_in_english() -> None:
    assert "англійською" in build_system_prompt("video")
    assert "англійською" in build_system_prompt("image")


def test_expand_stays_ukrainian() -> None:
    assert "українською" in build_system_prompt("expand")


def test_user_message_wrapper_differs_by_kind() -> None:
    assert "<transcript>" in build_user_message("clean", "текст")
    assert "<brief>" in build_user_message("video", "текст")


def test_generation_gets_more_freedom() -> None:
    assert temperature_for("clean", 0.2) == 0.2
    assert temperature_for("formal", 0.5) == 0.5
    assert temperature_for("video", 0.2) > 0.2
    assert temperature_for("expand", 0.2) > 0.2


def test_glossary_and_extra_prompt_apply_to_generation() -> None:
    prompt = build_system_prompt("video", glossary="Миргород", extra_prompt="пиши українською")
    assert "Миргород" in prompt
    assert "пиши українською" in prompt
