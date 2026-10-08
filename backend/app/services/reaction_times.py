"""Reaktionszeiten — the one computation behind the PDF table and the live Kennzahlen.

The Einsatzbericht's «Reaktionszeiten» table (per incident) and the board's
Kennzahlen view (median / P90 per priority) used to be one PDF-only loop. Both now
read the same stage times from here, so a number on the wall and the number in the
debrief can never disagree about what «Disponiert» means.

**What a stage time is.** Seconds from Eingang (``incident.created_at``) to the
first time the incident reached that stage *or a later one of the same work*:

* ``reko``       — first ``reko`` / ``reko_done``
* ``dispatched`` — first ``enroute`` / ``active`` / ``returning`` («Disponiert»)
* ``on_scene``   — first ``active`` / ``returning`` («Vor Ort»)
* ``closed``     — the LAST ``complete``, and only while the incident is still
  complete («Abschluss»)

Why the «or later» sets: a card dragged straight from Eingegangen to «Im Einsatz»
was dispatched — it just skipped a column. Counting it only where it landed left it
out of the Disponiert median entirely, and those are typically the fast ones.
``complete`` deliberately does NOT count as dispatched or on scene: a Meldung closed
without anybody going out (telefonisch erledigt, Fehlalarm) has no reaction time.

Why the last completion: a reopened incident was not finished at its first
«Abgeschlossen». While it is open again it has no Abschluss at all; once it is closed
again, the closing that stuck is the one that counts. The first two stages keep the
FIRST reach — they measure how fast the KP reacted, and a later re-entry (Rückfahrt →
Einsatz) does not undo that.

A transition stamped before the incident's own ``created_at`` (clock skew, a backfilled
alarm) clamps to 0 rather than producing a negative reaction time.

**Aggregates.** Median and P90 per priority. P90 is nearest-rank (the value nine in
ten incidents did not exceed — always an observed time, never an interpolation), and
every cell carries its ``count`` so «P90 of 2 incidents» is visible as such.
"""

from __future__ import annotations

import math
import statistics
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, StatusTransition

Stage = Literal["reko", "dispatched", "on_scene", "closed"]

STAGE_STATUSES: dict[Stage, frozenset[str]] = {
    "reko": frozenset({"reko", "reko_done"}),
    "dispatched": frozenset({"enroute", "active", "returning"}),
    "on_scene": frozenset({"active", "returning"}),
    "closed": frozenset({"complete"}),
}

#: Not yet dispatched — waiting for a crew (a Reko on the way counts as waiting).
WAITING_STATUSES = frozenset({"incoming", "reko", "reko_done"})
#: Somebody is on it.
IN_PROGRESS_STATUSES = frozenset({"enroute", "active", "returning"})
DONE_STATUSES = frozenset({"complete"})

PRIORITIES = ("high", "medium", "low")


class _IncidentLike(Protocol):
    """Read-only view of an incident — a model row, or a plain object in a test."""

    @property
    def id(self) -> uuid.UUID: ...
    @property
    def status(self) -> str: ...
    @property
    def priority(self) -> str: ...
    @property
    def title(self) -> str: ...
    @property
    def created_at(self) -> datetime | None: ...


class _TransitionLike(Protocol):
    @property
    def incident_id(self) -> uuid.UUID: ...
    @property
    def to_status(self) -> str: ...
    @property
    def timestamp(self) -> datetime | None: ...


@dataclass(frozen=True)
class StageTimes:
    """Seconds from Eingang to each stage, ``None`` where it was never reached."""

    reko: float | None = None
    dispatched: float | None = None
    on_scene: float | None = None
    closed: float | None = None

    def get(self, stage: Stage) -> float | None:
        value: float | None = getattr(self, stage)
        return value


@dataclass(frozen=True)
class StageSummary:
    count: int
    median_seconds: float | None
    p90_seconds: float | None


@dataclass(frozen=True)
class PrioritySummary:
    priority: str  # "high" | "medium" | "low" | "all"
    total: int
    waiting: int
    in_progress: int
    done: int
    dispatched: StageSummary
    on_scene: StageSummary
    closed: StageSummary


@dataclass(frozen=True)
class OldestWaiting:
    incident_id: uuid.UUID
    title: str
    created_at: datetime


@dataclass(frozen=True)
class EventFigures:
    """Everything the Kennzahlen view shows, for one Ereignis."""

    total: int
    waiting: int
    in_progress: int
    done: int
    overall: PrioritySummary
    by_priority: list[PrioritySummary]
    oldest_waiting_high: OldestWaiting | None


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _seconds_since(start: datetime, at: datetime) -> float:
    """Seconds from ``start`` to ``at``, clamped at 0 (a transition before Eingang)."""
    return max(0.0, (at - start).total_seconds())


def stage_times(
    incidents: Iterable[_IncidentLike],
    transitions: Iterable[_TransitionLike],
) -> dict[uuid.UUID, StageTimes]:
    """Stage times per incident — the shared core of the PDF table and the Kennzahlen."""
    # (when, to_status) per incident, timestamps normalised; a row without one is dropped.
    by_incident: dict[uuid.UUID, list[tuple[datetime, str]]] = {}
    for t in transitions:
        if t.timestamp is not None:
            by_incident.setdefault(t.incident_id, []).append((_utc(t.timestamp), t.to_status))

    result: dict[uuid.UUID, StageTimes] = {}
    for inc in incidents:
        if inc.created_at is None:
            result[inc.id] = StageTimes()
            continue
        start = _utc(inc.created_at)
        first: dict[Stage, float] = {}
        last_complete: datetime | None = None
        for at, to_status in sorted(by_incident.get(inc.id, [])):
            for stage in ("reko", "dispatched", "on_scene"):
                if stage not in first and to_status in STAGE_STATUSES[stage]:
                    first[stage] = _seconds_since(start, at)
            if to_status in STAGE_STATUSES["closed"]:
                last_complete = at
        closed = (
            _seconds_since(start, last_complete) if last_complete is not None and inc.status in DONE_STATUSES else None
        )
        result[inc.id] = StageTimes(
            reko=first.get("reko"),
            dispatched=first.get("dispatched"),
            on_scene=first.get("on_scene"),
            closed=closed,
        )
    return result


def p90(values: Sequence[float]) -> float | None:
    """Nearest-rank 90th percentile: an observed value, never interpolated."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.9 * len(ordered)) - 1)]


def summarize(values: Sequence[float]) -> StageSummary:
    if not values:
        return StageSummary(count=0, median_seconds=None, p90_seconds=None)
    return StageSummary(count=len(values), median_seconds=float(statistics.median(values)), p90_seconds=p90(values))


def _priority_summary(
    priority: str, incidents: Sequence[_IncidentLike], times: dict[uuid.UUID, StageTimes]
) -> PrioritySummary:
    def stage(name: Stage) -> StageSummary:
        return summarize([v for i in incidents if (v := times[i.id].get(name)) is not None])

    return PrioritySummary(
        priority=priority,
        total=len(incidents),
        waiting=sum(1 for i in incidents if i.status in WAITING_STATUSES),
        in_progress=sum(1 for i in incidents if i.status in IN_PROGRESS_STATUSES),
        done=sum(1 for i in incidents if i.status in DONE_STATUSES),
        dispatched=stage("dispatched"),
        on_scene=stage("on_scene"),
        closed=stage("closed"),
    )


def event_figures(
    incidents: Sequence[_IncidentLike],
    transitions: Iterable[_TransitionLike],
) -> EventFigures:
    """Counts, reaction times per priority and the oldest waiting «hoch» card.

    ``incidents`` are the Ereignis's non-deleted incidents; an unknown priority is
    read as ``low`` like the board does (``operation.priority || "low"``).
    """
    times = stage_times(incidents, transitions)

    def prio(inc: _IncidentLike) -> str:
        return inc.priority if inc.priority in PRIORITIES else "low"

    overall = _priority_summary("all", incidents, times)
    by_priority = [_priority_summary(p, [i for i in incidents if prio(i) == p], times) for p in PRIORITIES]

    waiting_high = [i for i in incidents if prio(i) == "high" and i.status in WAITING_STATUSES and i.created_at]
    oldest = min(waiting_high, key=lambda i: _utc(i.created_at), default=None)  # type: ignore[arg-type]
    return EventFigures(
        total=overall.total,
        waiting=overall.waiting,
        in_progress=overall.in_progress,
        done=overall.done,
        overall=overall,
        by_priority=by_priority,
        oldest_waiting_high=(
            OldestWaiting(incident_id=oldest.id, title=oldest.title, created_at=_utc(oldest.created_at))  # type: ignore[arg-type]
            if oldest is not None
            else None
        ),
    )


async def load_event_figures(db: AsyncSession, incidents: Sequence[Incident]) -> EventFigures:
    """`event_figures` for already-loaded incidents: one query for their transitions."""
    ids = [i.id for i in incidents]
    transitions: Sequence[StatusTransition] = []
    if ids:
        result = await db.execute(select(StatusTransition).where(StatusTransition.incident_id.in_(ids)))
        transitions = result.scalars().all()
    return event_figures(incidents, transitions)
