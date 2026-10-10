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

**Where it started.** The status an incident was created in counts as reached at
Eingang (0′): /feld «Wir übernehmen» creates it straight as ``enroute`` without a
transition, and reading only transitions made its Disponiert the crew's arrival. The
initial status is the first transition's ``from_status``, or the current status when
there is none.

**Corrections.** A stage left again *backwards* within two minutes (a mis-drag put
right, an undo) was not reached; the next real entry counts. Moving on (Disponiert →
Im Einsatz a minute later) is progress and keeps the reach.

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
from datetime import UTC, datetime, timedelta
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

#: Board order — «behind» a stage means a lower rank than its first status.
STATUS_RANK = {
    s: i for i, s in enumerate(("incoming", "reko", "reko_done", "enroute", "active", "returning", "complete"))
}

#: A stage left again backwards within this long was a correction (mis-drag, undo),
#: not a reach — the same two minutes the crew's time on duty ignores a release in.
CORRECTION_WINDOW = timedelta(minutes=2)


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
    def from_status(self) -> str | None: ...
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


def _initial_status(inc: _IncidentLike, timeline: Sequence[tuple[datetime, str, str | None]]) -> str:
    """The status the incident was CREATED in.

    Not always «incoming»: /feld «Wir übernehmen» creates the incident straight as
    ``enroute`` and writes no transition for it. The first transition's
    ``from_status`` says where it started; with no transition at all, the current
    status is the one it was created in.
    """
    if timeline:
        return timeline[0][2] or "incoming"
    return inc.status


def _first_reach(stage: Stage, start: datetime, steps: Sequence[tuple[datetime, str]]) -> float | None:
    """First time ``steps`` entered ``stage`` and was not taken back as a correction.

    A reach counts unless the incident went back BEHIND the stage within
    ``CORRECTION_WINDOW`` (a mis-drag put right at once). Moving on to a later
    status — Disponiert → Im Einsatz a minute later — is progress, not a correction.
    """
    statuses = STAGE_STATUSES[stage]
    floor = min(STATUS_RANK[s] for s in statuses)
    for i, (at, status) in enumerate(steps):
        if status not in statuses or (i > 0 and steps[i - 1][1] in statuses):
            continue
        taken_back = False
        for later_at, later_status in steps[i + 1 :]:
            if later_at - at >= CORRECTION_WINDOW:
                break
            if STATUS_RANK.get(later_status, floor) < floor:
                taken_back = True
                break
        if not taken_back:
            return _seconds_since(start, at)
    return None


#: What a merge writes into the surviving card's history (services/merge_work.py):
#: a status raised because crew from the merged card moved in. It happened at merge
#: time, not when anybody was dispatched — timing ignores it.
MERGE_TRANSITION_PREFIX = "Zusammenführung"


@dataclass(frozen=True)
class _FoldedCard:
    id: uuid.UUID
    status: str
    priority: str
    title: str
    created_at: datetime | None


@dataclass(frozen=True)
class _FoldedStep:
    incident_id: uuid.UUID
    from_status: str | None
    to_status: str
    timestamp: datetime | None


def is_merge_transition(t: object) -> bool:
    notes = getattr(t, "notes", None)
    return isinstance(notes, str) and notes.startswith(MERGE_TRANSITION_PREFIX)


def fold_merged(
    incidents: Sequence[_IncidentLike],
    transitions: Iterable[_TransitionLike],
    merged: Sequence[tuple[_IncidentLike, uuid.UUID]] = (),
    merged_transitions: Iterable[_TransitionLike] = (),
) -> tuple[list[_IncidentLike], list[_TransitionLike]]:
    """One Schadenplatz, one clock — a merged card's history counts for the card it went into.

    A card merged into another (R2) was often the FIRST report of the place, or
    the one that was already dispatched. Measured from the surviving card alone,
    its reaction times would start at the later Eingang and its «Disponiert»
    would be the merge itself. So: Eingang is the earliest creation of the
    surviving card and every card merged into it, every merged card's real
    transitions count as the surviving card's, and the synthetic transition a
    merge writes (``MERGE_TRANSITION_PREFIX``) counts for nothing.
    """
    by_live: dict[uuid.UUID, list[_IncidentLike]] = {}
    for card, live_id in merged:
        by_live.setdefault(live_id, []).append(card)
    merged_ids = {card.id: live_id for card, live_id in merged}

    steps: list[_TransitionLike] = [t for t in transitions if not is_merge_transition(t)]
    own_by_merged: dict[uuid.UUID, list[_TransitionLike]] = {}
    for t in merged_transitions:
        if is_merge_transition(t) or t.incident_id not in merged_ids:
            continue
        own_by_merged.setdefault(t.incident_id, []).append(t)
        steps.append(_FoldedStep(merged_ids[t.incident_id], t.from_status, t.to_status, t.timestamp))
    # The status a merged card was CREATED in counts from its own Eingang (a /feld
    # «Wir übernehmen» card starts as «enroute» without a transition).
    for card, live_id in merged:
        if card.created_at is None:
            continue
        own = sorted(
            ((_utc(t.timestamp), t.to_status, t.from_status) for t in own_by_merged.get(card.id, []) if t.timestamp),
            key=lambda row: row[0],
        )
        initial = _initial_status(card, own)
        steps.append(_FoldedStep(live_id, initial, initial, card.created_at))

    folded: list[_IncidentLike] = []
    for inc in incidents:
        extra = by_live.get(inc.id)
        if not extra:
            folded.append(inc)
            continue
        starts = [c.created_at for c in [inc, *extra] if c.created_at is not None]
        folded.append(
            _FoldedCard(
                id=inc.id,
                status=inc.status,
                priority=inc.priority,
                title=inc.title,
                created_at=min(starts, key=_utc) if starts else None,
            )
        )
    return folded, steps


def stage_times(
    incidents: Iterable[_IncidentLike],
    transitions: Iterable[_TransitionLike],
) -> dict[uuid.UUID, StageTimes]:
    """Stage times per incident — the shared core of the PDF table and the Kennzahlen."""
    # (when, to_status, from_status) per incident, timestamps normalised; a row without one is dropped.
    by_incident: dict[uuid.UUID, list[tuple[datetime, str, str | None]]] = {}
    for t in transitions:
        if t.timestamp is not None:
            by_incident.setdefault(t.incident_id, []).append((_utc(t.timestamp), t.to_status, t.from_status))

    result: dict[uuid.UUID, StageTimes] = {}
    for inc in incidents:
        if inc.created_at is None:
            result[inc.id] = StageTimes()
            continue
        start = _utc(inc.created_at)
        timeline = sorted(by_incident.get(inc.id, []), key=lambda row: row[0])
        # The status it was created in counts as reached at Eingang (0′).
        steps = [(start, _initial_status(inc, timeline))] + [(at, to) for at, to, _ in timeline]
        last_complete = next((at for at, status in reversed(steps) if status in DONE_STATUSES), None)
        closed = (
            _seconds_since(start, last_complete) if last_complete is not None and inc.status in DONE_STATUSES else None
        )
        result[inc.id] = StageTimes(
            reko=_first_reach("reko", start, steps),
            dispatched=_first_reach("dispatched", start, steps),
            on_scene=_first_reach("on_scene", start, steps),
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
    """`event_figures` for already-loaded incidents: one query for their transitions.

    Cards merged into one of them lend it their history (``fold_merged``).
    """
    from .merge_links import merged_cards_of_event  # lazy: merge_links imports models only

    ids = [i.id for i in incidents]
    transitions: Sequence[StatusTransition] = []
    merged: list[tuple[Incident, uuid.UUID]] = []
    merged_transitions: Sequence[StatusTransition] = []
    if ids:
        result = await db.execute(select(StatusTransition).where(StatusTransition.incident_id.in_(ids)))
        transitions = result.scalars().all()
        live = set(ids)
        merged = [
            (card, live_id)
            for card, live_id in await merged_cards_of_event(db, incidents[0].event_id)
            if live_id in live
        ]
        if merged:
            merged_result = await db.execute(
                select(StatusTransition).where(StatusTransition.incident_id.in_([c.id for c, _ in merged]))
            )
            merged_transitions = merged_result.scalars().all()
    folded, steps = fold_merged(incidents, transitions, merged, merged_transitions)
    return event_figures(folded, steps)
