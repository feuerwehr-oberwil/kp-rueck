"""The field lifecycle of the Regie: next steps, dwell, jitter, tempo and pauses."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest

from app.services.training_lifecycle import (
    DWELL,
    IncidentFacts,
    PlannedStep,
    Tempo,
    all_pauses,
    due_at,
    jitter,
    plan_steps,
    unpaused_seconds,
)

T0 = datetime(2026, 11, 24, 19, 0, tzinfo=UTC)


_BASE = IncidentFacts(
    incident_id=uuid4(),
    status="incoming",
    status_changed_at=T0,
    reko_arrived_at=None,
    field_complete_reported_at=None,
    has_rapport=False,
    has_coordinates=True,
    vehicle_ids=(uuid4(),),
)


def _facts(status: str, **overrides: Any) -> IncidentFacts:
    return replace(_BASE, incident_id=uuid4(), status=status, **overrides)


def _keys(facts: IncidentFacts, gps: bool = True) -> list[str]:
    return [s.key for s in plan_steps(facts, gps=gps)]


@pytest.mark.parametrize(
    ("facts", "gps", "expected"),
    [
        (_facts("incoming"), True, []),
        (_facts("reko"), True, ["reko_arrived"]),
        (_facts("reko", reko_arrived_at=T0), True, ["reko_report"]),
        (_facts("reko_done"), True, []),
        (_facts("enroute"), True, ["drive_to_incident"]),
        (_facts("enroute"), False, ["vehicle_on_scene"]),
        (_facts("enroute", has_coordinates=False), True, ["vehicle_on_scene"]),
        (_facts("enroute", vehicle_ids=()), True, ["vehicle_on_scene"]),
        (_facts("active"), True, ["field_complete", "drive_to_magazin"]),
        (_facts("active", field_complete_reported_at=T0), True, ["drive_to_magazin"]),
        (_facts("active"), False, ["field_complete"]),
        (_facts("returning"), True, ["drive_to_magazin"]),
        (_facts("complete"), True, ["rapport"]),
        (_facts("complete", has_rapport=True), True, []),
    ],
)
def test_next_steps(facts: IncidentFacts, gps: bool, expected: list[str]) -> None:
    assert _keys(facts, gps) == expected


def test_the_step_clock_starts_at_the_reko_arrival_and_the_beendet_report() -> None:
    arrived = T0 + timedelta(minutes=3)
    facts = _facts("reko", reko_arrived_at=arrived)
    step = plan_steps(facts, gps=True)[0]
    due = due_at(facts, step, tempo="normal", pauses=[], now=T0)
    assert due - arrived == timedelta(seconds=DWELL["reko_report"] * jitter(facts.incident_id, "reko_report"))

    done = T0 + timedelta(minutes=9)
    facts = _facts("active", field_complete_reported_at=done)
    step = plan_steps(facts, gps=True)[0]
    assert due_at(facts, step, tempo="normal", pauses=[], now=T0) > done


def test_jitter_is_stable_and_within_20_percent() -> None:
    incident_id = uuid4()
    assert jitter(incident_id, "rapport") == jitter(incident_id, "rapport")
    values = [jitter(uuid4(), "reko_arrived") for _ in range(500)]
    assert all(0.8 <= v <= 1.2 for v in values)
    assert max(values) - min(values) > 0.3  # it actually spreads


def test_tempo_divides_the_dwell() -> None:
    facts = _facts("reko")
    step = PlannedStep("reko_arrived", 120)

    def seconds(tempo: Tempo) -> float:
        return (due_at(facts, step, tempo=tempo, pauses=[], now=T0) - T0).total_seconds()

    assert seconds("sturm") == pytest.approx(seconds("normal") / 2, abs=1e-5)
    assert seconds("ruhig") == pytest.approx(seconds("normal") * 2, abs=1e-5)


def test_pauses_shift_the_due_time() -> None:
    facts = _facts("reko")
    step = PlannedStep("reko_arrived", 120)
    plain = due_at(facts, step, tempo="normal", pauses=[], now=T0)

    before_start = [(T0 - timedelta(minutes=5), T0 - timedelta(minutes=4))]
    assert due_at(facts, step, tempo="normal", pauses=before_start, now=T0) == plain

    inside = [(T0 + timedelta(seconds=30), T0 + timedelta(seconds=90))]
    assert due_at(facts, step, tempo="normal", pauses=inside, now=T0) == plain + timedelta(seconds=60)

    after_due = [(plain + timedelta(seconds=1), plain + timedelta(minutes=5))]
    assert due_at(facts, step, tempo="normal", pauses=after_due, now=T0) == plain


def test_a_running_pause_freezes_the_countdown() -> None:
    facts = _facts("reko")
    step = PlannedStep("reko_arrived", 120)
    paused_at = T0 + timedelta(seconds=30)
    left = []
    for later in (40, 300):
        now = T0 + timedelta(seconds=later)
        due = due_at(facts, step, tempo="normal", pauses=all_pauses([], paused_at, now), now=now)
        left.append(due - now)
    assert left[0] == left[1]


def test_unpaused_seconds_counts_around_pauses() -> None:
    pauses = [(T0 + timedelta(seconds=10), T0 + timedelta(seconds=20))]
    assert unpaused_seconds(T0, T0 + timedelta(seconds=60), pauses) == 50
    assert unpaused_seconds(T0 + timedelta(seconds=15), T0 + timedelta(seconds=30), pauses) == 10
