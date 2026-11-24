"""The FIELD lifecycle of a training incident: which step comes next, and when it is due.

Pure functions, no database. The Regie (`services/training_regie.py`) builds an
`IncidentFacts` per incident, asks `plan_steps` what the field does next and `due_at` when,
and the Autopilot runs what is due. Ported from the former client-side
`frontend/lib/training-lifecycle.ts`; this module is now the single source.

The trainer only simulates what happens IN THE FIELD. Command-post decisions (tasking a
Reko, disponieren, closing the incident) stay with the operator on the board:

    Reko vor Ort → Reko-Meldung → Fahrt zu Einsatz → Einsatz beendet + Rückfahrt
    → Rapport (once the operator closed the incident, until it is filed)

Incidents whose ball is in the operator's court (Eingegangen, Reko abgeschlossen) have no
step. Each step has a dwell time (demo-scaled, so a 30–45 min Übung flows), ±20 % jitter
seeded per incident and step, divided by the tempo factor, and counted in un-paused time.
"""

import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from app.schemas.training import RegieStepKey as StepKey
from app.schemas.training import RegieTempo as Tempo

# Ruhig halves the pace, Sturm doubles it: dwell times and the Automatik interval are divided
# by the factor, GPS drives run at DRIVE_KMH × factor.
TEMPO_FACTOR: dict[Tempo, float] = {"ruhig": 0.5, "normal": 1.0, "sturm": 2.0}
DRIVE_KMH = 40.0

# Expected dwell times in seconds, at tempo «normal».
DWELL = {
    "reko_arrived": 120,  # travel time before the Reko crew reaches the scene
    "reko_report": 90,  # assessment time on scene before the report comes in
    "drive_start": 45,  # the field starts driving right after being disponiert
    "vehicle_on_scene": 150,  # travel time before the vehicles reach the scene (no GPS)
    "incident_done": 420,  # working the incident (~7 min) before the crew reports done
    "return_start": 120,  # packing up after «beendet» before the crew drives home
    "rapport": 180,  # paperwork after completion before the rapport comes in
}

JITTER = 0.2

# A closed pause: (paused_at, resumed_at).
Pause = tuple[datetime, datetime]


@dataclass(frozen=True)
class IncidentFacts:
    """What the lifecycle reads off an incident (from `crud.get_incidents`)."""

    incident_id: UUID
    status: str
    status_changed_at: datetime | None
    reko_arrived_at: datetime | None
    field_complete_reported_at: datetime | None
    has_rapport: bool
    has_coordinates: bool
    vehicle_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class PlannedStep:
    key: StepKey
    dwell_s: float  # at tempo «normal», before jitter


def plan_steps(facts: IncidentFacts, *, gps: bool) -> list[PlannedStep]:
    """The field's next steps for an incident, primary first; empty when the operator is next.

    `gps` says whether simulated drives can run (not in demo mode). Without it, or without
    coordinates or vehicles, «Fahrt zu Einsatz» falls back to «Fahrzeug vor Ort» and there is
    no «Rückfahrt Magazin».
    """
    has_vehicles = bool(facts.vehicle_ids)
    match facts.status:
        case "reko":
            if facts.reko_arrived_at is None:
                return [PlannedStep("reko_arrived", DWELL["reko_arrived"])]
            return [PlannedStep("reko_report", DWELL["reko_report"])]
        case "enroute":
            if gps and facts.has_coordinates and has_vehicles:
                return [PlannedStep("drive_to_incident", DWELL["drive_start"])]
            return [PlannedStep("vehicle_on_scene", DWELL["vehicle_on_scene"])]
        case "active":
            # On scene the trainer holds both levers: «Einsatz beendet» (once) and the vehicles
            # driving home. After «beendet» the Rückfahrt is primary (packing-up clock).
            steps: list[PlannedStep] = []
            if facts.field_complete_reported_at is None:
                steps.append(PlannedStep("field_complete", DWELL["incident_done"]))
            if gps and has_vehicles:
                home = PlannedStep("drive_to_magazin", DWELL["return_start"])
                if facts.field_complete_reported_at is not None:
                    steps.insert(0, home)
                else:
                    steps.append(home)
            return steps
        case "returning":
            # The operator moved the card to Rückführung: the vehicles still assigned drive home.
            if gps and has_vehicles:
                return [PlannedStep("drive_to_magazin", DWELL["drive_start"])]
            return []
        case "complete":
            # Closed on the board, but the field still owes its Schadenplatz-Rapport.
            return [] if facts.has_rapport else [PlannedStep("rapport", DWELL["rapport"])]
        case _:
            # "incoming" (operator tasks Reko), "reko_done" (operator disponiert).
            return []


def step_started_at(facts: IncidentFacts) -> datetime | None:
    """When the incident entered its CURRENT step.

    The Reko-Meldung clock runs from the arrival, the Rückfahrt after «beendet» from that
    report; otherwise the last status change.
    """
    if facts.status == "reko" and facts.reko_arrived_at is not None:
        return facts.reko_arrived_at
    if facts.status == "active" and facts.field_complete_reported_at is not None:
        return facts.field_complete_reported_at
    return facts.status_changed_at


def jitter(incident_id: UUID, key: StepKey) -> float:
    """The step's dwell multiplier in [0.8, 1.2] – stable per incident and step, so the countdown never jumps."""
    return random.Random(f"{incident_id}:{key}").uniform(1 - JITTER, 1 + JITTER)


def unpaused_seconds(start: datetime, end: datetime, pauses: list[Pause]) -> float:
    """Seconds between `start` and `end` that fall outside every pause."""
    total = max(0.0, (end - start).total_seconds())
    for p0, p1 in pauses:
        overlap = (min(end, p1) - max(start, p0)).total_seconds()
        if overlap > 0:
            total -= overlap
    return max(0.0, total)


def shift_past_pauses(start: datetime, seconds: float, pauses: list[Pause]) -> datetime:
    """The wall-clock time at which `seconds` of un-paused time have passed since `start`."""
    t, remaining = start, seconds
    for p0, p1 in sorted(pauses):
        if p1 <= t:
            continue
        if p0 > t:
            gap = (p0 - t).total_seconds()
            if remaining <= gap:
                break
            remaining -= gap
        t = p1
    return t + timedelta(seconds=remaining)


def all_pauses(pauses: list[Pause], paused_at: datetime | None, now: datetime) -> list[Pause]:
    """The closed pauses plus a running one, closed at `now`."""
    return [*pauses, (paused_at, now)] if paused_at is not None else list(pauses)


def due_at(facts: IncidentFacts, step: PlannedStep, *, tempo: Tempo, pauses: list[Pause], now: datetime) -> datetime:
    """When `step` falls due: its jittered dwell ÷ tempo, counted in un-paused time from the step start.

    `pauses` must include a running pause closed at `now`, so a paused countdown stays frozen
    (`due_at - now` does not shrink). An unknown step start counts as due now.
    """
    started = step_started_at(facts)
    if started is None:
        return now
    seconds = step.dwell_s * jitter(facts.incident_id, step.key) / TEMPO_FACTOR[tempo]
    return shift_past_pauses(started, seconds, pauses)
