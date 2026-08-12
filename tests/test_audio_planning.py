"""Тести планування точок розрізу довгого запису."""

from __future__ import annotations

from bot.services.audio import plan_cut_points


def test_short_audio_is_not_cut() -> None:
    assert plan_cut_points(duration=300, silences=[100.0], target=600) == []


def test_cuts_at_silence_inside_window() -> None:
    # Вікно пошуку для першого розрізу — [300, 600].
    cuts = plan_cut_points(duration=900, silences=[120.0, 450.0, 580.0], target=600)
    assert cuts == [580.0]


def test_falls_back_to_target_without_silence() -> None:
    assert plan_cut_points(duration=1000, silences=[], target=600) == [600.0]


def test_multiple_cuts_are_increasing() -> None:
    silences = [float(x) for x in range(50, 3000, 37)]
    cuts = plan_cut_points(duration=3000, silences=silences, target=600)
    assert cuts == sorted(cuts)
    assert all(0 < cut < 3000 for cut in cuts)
    assert all(
        second - first <= 600 for first, second in zip(cuts, cuts[1:], strict=False)
    )


def test_last_chunk_never_exceeds_target_by_much() -> None:
    cuts = plan_cut_points(duration=1300, silences=[], target=600)
    boundaries = [0.0, *cuts, 1300.0]
    lengths = [b - a for a, b in zip(boundaries, boundaries[1:], strict=False)]
    assert max(lengths) <= 600


def test_zero_target_disables_cutting() -> None:
    assert plan_cut_points(duration=5000, silences=[10.0], target=0) == []
