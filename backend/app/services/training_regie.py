"""The Regie of an Übung: Autopilot, tempo, pause, «Halten» and «Vorhin».

One Regie per installation, stored as `RegieRun` JSON in the `training_regie.state` settings
row (a write for another Übung starts a fresh one). The page reads `build_state` through
`GET /api/training/events/{id}/regie` and refetches on the `training_regie` broadcast.

- The field lifecycle (which step is next, when it is due) is `services/training_lifecycle.py`.
- `run_step` executes a step through `services/training_steps.py`. Manual «Jetzt»
  (`POST …/regie/step/{incident_id}`) and the Autopilot run the same path.
- `RegieAutopilotTask` (started in the app lifespan, not in demo mode) runs every due primary
  step of the Regie's Übung every few seconds while the Autopilot is on and not paused. It
  leaves held incidents and Mitspieler incidents alone, and acts in the name of the trainer
  who switched it on.
- Pause freezes everything: the Autopilot and the Automatik skip, every due time and the
  Automatik interval count only un-paused time, GPS drives stand still
  (`GpsSimulation.pause()`), and the check-in trickle waits (`sleep_unpaused`).
  `gps_simulation.paused_at` is this process's pause clock; the task re-applies the row's
  pause after a restart.
"""

import asyncio
import contextlib
import logging
import random
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Request
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.crud import incidents as incidents_crud
from app.crud.locking import lock_incident_with_group
from app.database import after_commit, async_session_maker
from app.models import Event, FeldDeviceClaim, Incident, IncidentAssignment, Setting, User
from app.schemas.training import (
    RegieBy,
    RegieHistoryItem,
    RegieIncident,
    RegieRun,
    RegieStateResponse,
    RegieStep,
    RegieStepKey,
    RegieUpdateRequest,
)
from app.services import incident_display
from app.services.gps_simulation import SimulatedDrive, gps_simulation
from app.services.settings import get_station_coordinates, update_setting
from app.services.training import file_simulated_rapport
from app.services.training_autogen_task import automatik_next_at, read_autogen_state
from app.services.training_lifecycle import (
    DRIVE_KMH,
    TEMPO_FACTOR,
    IncidentFacts,
    Pause,
    PlannedStep,
    all_pauses,
    due_at,
    plan_steps,
    unpaused_seconds,
)
from app.services.training_steps import (
    DriveTarget,
    StepRefusedError,
    file_reko_report,
    mark_reko_arrived,
    report_field_complete,
    report_vehicle_on_scene,
    start_incident_drives,
)
from app.websocket_manager import broadcast_incident_update, broadcast_message

logger = logging.getLogger(__name__)

STATE_KEY = "training_regie.state"
HISTORY_MAX = 20
TICK_SECONDS = 5

# «Vorhin» wording per step (the page's button labels).
STEP_LABELS: dict[RegieStepKey, str] = {
    "reko_arrived": "Reko vor Ort",
    "reko_report": "Reko-Meldung",
    "drive_to_incident": "Fahrt zu Einsatz",
    "vehicle_on_scene": "Fahrzeug vor Ort",
    "field_complete": "Einsatz beendet",
    "drive_to_magazin": "Rückfahrt Magazin",
    "rapport": "Rapport eingetroffen",
}
_DRIVE_STEPS: dict[RegieStepKey, DriveTarget] = {"drive_to_incident": "incident", "drive_to_magazin": "magazin"}


class NotCurrentStepError(Exception):
    """The step is not one of the incident's current steps (the page was behind)."""


def place(incident: Incident) -> str:
    """How «Vorhin» names an incident: its address, else its title."""
    return incident.location_address or incident.title


# ── The state row ───────────────────────────────────────────────────────────


async def _stored_run(db: AsyncSession) -> RegieRun | None:
    raw = await db.scalar(select(Setting.value).where(Setting.key == STATE_KEY))
    if not raw:
        return None
    with contextlib.suppress(ValidationError):
        return RegieRun.model_validate_json(raw)
    return None


async def read_regie_run(db: AsyncSession, event_id: UUID) -> RegieRun | None:
    """The stored Regie when it belongs to this Übung, else None."""
    run = await _stored_run(db)
    return run if run and run.event_id == event_id else None


async def regie_run(db: AsyncSession, event_id: UUID) -> RegieRun:
    """The Regie of this Übung – the stored one, or a fresh one (not stored until a write)."""
    return await read_regie_run(db, event_id) or RegieRun(event_id=event_id)


async def _save(db: AsyncSession, run: RegieRun, user_id: UUID | None) -> None:
    stored = await _stored_run(db)
    if stored and stored.event_id != run.event_id and stored.paused_at and not run.paused_at:
        after_commit(db, gps_simulation.resume)  # the other Übung's ⏸ ends with its Regie
    await update_setting(db, STATE_KEY, run.model_dump_json(), user_id)


def _push_history(run: RegieRun, text: str, incident_id: UUID | None, by: RegieBy, at: datetime) -> None:
    item = RegieHistoryItem(at=at, incident_id=incident_id, text=text, by=by)
    run.history = [item, *run.history][:HISTORY_MAX]


async def record_history(
    db: AsyncSession, event_id: UUID, text: str, *, incident_id: UUID | None = None, by: RegieBy = "trainer"
) -> None:
    """Add a line to «Vorhin» and tell the page. Flushes; the caller commits.

    Used by the injects and alarm endpoints. Skipped while the Regie belongs to another
    Übung – an inject elsewhere must not reset a running Autopilot.
    """
    stored = await _stored_run(db)
    if stored and stored.event_id != event_id:
        return
    run = stored or RegieRun(event_id=event_id)
    _push_history(run, text, incident_id, by, datetime.now(UTC))
    await _save(db, run, None)
    after_commit(db, broadcast_regie_state, await build_state(db, event_id))


# ── The computed state ──────────────────────────────────────────────────────


def _facts(incident: Incident) -> IncidentFacts:
    """Lifecycle facts of an incident loaded by `crud.get_incident(s)` (derived fields set)."""
    return IncidentFacts(
        incident_id=incident.id,
        status=incident.status,
        status_changed_at=incident.status_changed_at,
        reko_arrived_at=incident.reko_arrived_at,
        field_complete_reported_at=incident.field_complete_reported_at,
        has_rapport=incident.has_schadenplatz_rapport,
        has_coordinates=incident.location_lat is not None and incident.location_lng is not None,
        vehicle_ids=tuple(v.vehicle_id for v in incident.assigned_vehicles),
    )


def leg_drives(facts: IncidentFacts, target: DriveTarget) -> list[SimulatedDrive]:
    """The simulated drives of this incident's vehicles on this leg (rolling or parked at the goal)."""
    return [
        d
        for d in gps_simulation.list_drives()
        if d.kind == target and d.vehicle_id in facts.vehicle_ids and d.incident_id in (facts.incident_id, None)
    ]


async def _mitspieler_ids(db: AsyncSession, event_id: UUID) -> set[UUID]:
    """Incidents with a crew member whose phone is on /feld for this Übung (a live claim).

    The crew plays the field themselves, so the Autopilot leaves the incident alone. A closed
    incident has released its crew, so there any assignment counts (the Rapport is theirs).
    """
    result = await db.execute(
        select(IncidentAssignment.incident_id)
        .distinct()
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .join(FeldDeviceClaim, FeldDeviceClaim.personnel_id == IncidentAssignment.resource_id)
        .where(
            Incident.event_id == event_id,
            IncidentAssignment.resource_type == "personnel",
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.revoked_at.is_(None),
            or_(IncidentAssignment.unassigned_at.is_(None), Incident.status == "complete"),
        )
    )
    return set(result.scalars().all())


def _step(
    facts: IncidentFacts,
    planned: PlannedStep,
    *,
    scheduled: bool,
    run: RegieRun,
    pauses: list[Pause],
    magazin: bool,
    now: datetime,
) -> RegieStep:
    """One step as the page shows it. Only a scheduled step gets a due time.

    A drive step whose drives already exist is under way (or waits on the operator's prompt)
    and is not due again; «Rückfahrt Magazin» without Magazin coordinates is never due.
    """
    target = _DRIVE_STEPS.get(planned.key)
    drives = leg_drives(facts, target) if target else []
    clock = gps_simulation.clock()
    rolling = [d for d in drives if not d.arrived(clock)]
    if drives or (planned.key == "drive_to_magazin" and not magazin):
        scheduled = False
    return RegieStep(
        incident_id=facts.incident_id,
        key=planned.key,
        due_at=due_at(facts, planned, tempo=run.tempo, pauses=pauses, now=now) if scheduled else None,
        rolling=bool(rolling),
        progress=min(d.progress(clock) for d in rolling) if rolling else None,
        eta_seconds=max(d.eta_seconds(clock) for d in rolling) if rolling else None,
    )


async def build_state(db: AsyncSession, event_id: UUID, *, now: datetime | None = None) -> RegieStateResponse:
    """The Regie page for one Übung: every open incident (+ closed ones owing a Rapport) with its steps.

    Only the primary step of an incident is scheduled (gets a `due_at`), and not while the
    incident is held or Mitspieler; the others are levers for «Jetzt». While paused, due
    times are computed as if the pause ended now, so `due_at - now` is the frozen countdown.
    """
    now = now or datetime.now(UTC)
    run = await regie_run(db, event_id)
    gps = not settings.demo_mode
    magazin = await get_station_coordinates(db) is not None
    mitspieler = await _mitspieler_ids(db, event_id)
    pauses = all_pauses(run.pauses, run.paused_at, now)

    incidents: list[RegieIncident] = []
    for incident in await incidents_crud.get_incidents(db, event_id, limit=None):
        facts = _facts(incident)
        planned = plan_steps(facts, gps=gps)
        if not planned and incident.status == "complete":
            continue
        held = incident.id in run.held
        is_mitspieler = incident.id in mitspieler
        steps = [
            _step(
                facts,
                p,
                scheduled=index == 0 and not held and not is_mitspieler,
                run=run,
                pauses=pauses,
                magazin=magazin,
                now=now,
            )
            for index, p in enumerate(planned)
        ]
        incidents.append(RegieIncident(incident_id=incident.id, held=held, mitspieler=is_mitspieler, steps=steps))

    automatik = await read_autogen_state(db)
    return RegieStateResponse(
        event_id=event_id,
        autopilot=run.autopilot,
        tempo=run.tempo,
        paused_at=run.paused_at,
        started_at=run.started_at,
        running_seconds=unpaused_seconds(run.started_at, now, pauses) if run.started_at else None,
        automatik=automatik,
        automatik_next_at=await automatik_next_at(db, automatik, run),
        incidents=incidents,
        history=run.history,
        gps_available=gps,
        magazin_configured=magazin,
    )


async def broadcast_regie_state(state: RegieStateResponse) -> None:
    """Tell every open Regie page what changed (it refetches `GET …/regie`)."""
    await broadcast_message({"type": "training_regie", **state.model_dump(mode="json")})


# ── Writes from the page ────────────────────────────────────────────────────


async def _repace_drives(factor: float) -> None:
    for drive in gps_simulation.list_drives():
        await gps_simulation.set_speed(drive.vehicle_name, DRIVE_KMH * factor)


async def update_regie(db: AsyncSession, event_id: UUID, change: RegieUpdateRequest, user: User) -> RegieStateResponse:
    """Switch the Autopilot, set the tempo, pause or resume. Flushes; the in-memory effects run after the commit."""
    run = await regie_run(db, event_id)
    now = datetime.now(UTC)
    if change.autopilot is not None:
        run.autopilot = change.autopilot
        if change.autopilot:
            run.autopilot_by = user.id
            run.started_at = run.started_at or now
    if change.tempo is not None and change.tempo != run.tempo:
        run.tempo = change.tempo
        after_commit(db, _repace_drives, TEMPO_FACTOR[change.tempo])
    if change.paused is True and run.paused_at is None:
        run.paused_at = now
        after_commit(db, gps_simulation.pause, now)
    elif change.paused is False and run.paused_at is not None:
        run.pauses.append((run.paused_at, now))
        run.paused_at = None
        after_commit(db, gps_simulation.resume)
    await _save(db, run, user.id)
    return await _announce(db, event_id)


async def set_held(db: AsyncSession, event_id: UUID, incident_id: UUID, held: bool, user: User) -> RegieStateResponse:
    """«Halten»: the Autopilot leaves this incident alone until released."""
    run = await regie_run(db, event_id)
    run.held = [i for i in run.held if i != incident_id] + ([incident_id] if held else [])
    await _save(db, run, user.id)
    return await _announce(db, event_id)


async def mark_started(db: AsyncSession, event_id: UUID, user_id: UUID) -> None:
    """The Automatik went on for this Übung: «Übung läuft» counts from its first switch-on."""
    run = await regie_run(db, event_id)
    if run.started_at is None:
        run.started_at = datetime.now(UTC)
        await _save(db, run, user_id)
        await _announce(db, event_id)


async def _announce(db: AsyncSession, event_id: UUID) -> RegieStateResponse:
    state = await build_state(db, event_id)
    after_commit(db, broadcast_regie_state, state)
    return state


# ── Steps ───────────────────────────────────────────────────────────────────


async def run_step(
    db: AsyncSession,
    incident: Incident,
    key: RegieStepKey,
    *,
    run: RegieRun,
    user: User,
    pickup_needed: bool | None = None,
    request: Request | None = None,
) -> None:
    """Execute one field step now – the one path for «Jetzt» and the Autopilot. Flushes.

    Drives run at DRIVE_KMH × tempo factor; without GPS (demo mode) «Fahrt zu Einsatz»
    falls back to «Fahrzeug vor Ort». Raises `StepRefusedError` when the step cannot run.
    """
    speed = DRIVE_KMH * TEMPO_FACTOR[run.tempo]
    match key:
        case "reko_arrived":
            await mark_reko_arrived(db, incident)
        case "reko_report":
            await file_reko_report(db, incident)
        case "drive_to_incident" if settings.demo_mode:
            await report_vehicle_on_scene(db, incident, user=user, request=request)
        case "drive_to_incident":
            await start_incident_drives(db, incident, target="incident", speed_kmh=speed)
        case "vehicle_on_scene":
            await report_vehicle_on_scene(db, incident, user=user, request=request)
        case "field_complete":
            await report_field_complete(
                db, incident, user=user, pickup_needed=pickup_needed, pickup_note=None, request=request
            )
        case "drive_to_magazin":
            await start_incident_drives(db, incident, target="magazin", speed_kmh=speed)
        case "rapport":
            await file_simulated_rapport(db, incident, current_user=user, rng=random.Random(), request=request)


async def _step_and_record(
    db: AsyncSession,
    event_id: UUID,
    incident_id: UUID,
    key: RegieStepKey,
    *,
    user: User,
    by: RegieBy,
    pickup_needed: bool | None = None,
    request: Request | None = None,
) -> None:
    """Check that `key` is current, run it, write «Vorhin» and queue the board broadcast.

    The incident is locked first (crud/locking order), so a «Jetzt» and an Autopilot tick on
    the same incident run one after the other – the second sees the step done and refuses.
    """
    await lock_incident_with_group(db, incident_id)
    incident = await incidents_crud.get_incident(db, incident_id)
    if incident is None or incident.event_id != event_id or incident.deleted_at is not None:
        raise NotCurrentStepError("Einsatz nicht in dieser Übung")
    current = [p.key for p in plan_steps(_facts(incident), gps=not settings.demo_mode)]
    if key not in current:
        raise NotCurrentStepError(f"«{STEP_LABELS[key]}» ist für diesen Einsatz gerade kein Schritt")

    run = await regie_run(db, event_id)
    await run_step(db, incident, key, run=run, user=user, pickup_needed=pickup_needed, request=request)
    _push_history(run, f"{STEP_LABELS[key]} · {place(incident)}", incident.id, by, datetime.now(UTC))
    await _save(db, run, user.id)
    if key not in _DRIVE_STEPS:
        refreshed = await incident_display.incident_with_display(db, incident)
        after_commit(db, broadcast_incident_update, refreshed.model_dump(mode="json"), "update")


async def step_now(
    db: AsyncSession,
    event_id: UUID,
    incident_id: UUID,
    key: RegieStepKey,
    *,
    user: User,
    pickup_needed: bool | None,
    request: Request | None,
) -> RegieStateResponse:
    """«Jetzt»: the trainer runs a step by hand (also for held and Mitspieler incidents)."""
    await _step_and_record(
        db, event_id, incident_id, key, user=user, by="trainer", pickup_needed=pickup_needed, request=request
    )
    return await _announce(db, event_id)


async def sleep_unpaused(seconds: float) -> None:
    """Sleep `seconds` of un-paused time: the check-in trickle waits while the Übung is paused."""
    remaining = seconds
    while remaining > 0:
        chunk = min(0.5, remaining)
        await asyncio.sleep(chunk)
        if gps_simulation.paused_at is None:
            remaining -= chunk


# ── The Autopilot ───────────────────────────────────────────────────────────


async def autopilot_tick(db: AsyncSession) -> int:
    """Run every due primary step of the Regie's Übung; returns how many ran.

    The task owns `db`: each step commits on its own (a failing one rolls back alone), and
    one `training_regie` broadcast follows the round.
    """
    run = await _stored_run(db)
    if run is None or not run.autopilot or run.paused_at is not None or run.autopilot_by is None:
        return 0
    event = await db.get(Event, run.event_id)
    user = await db.get(User, run.autopilot_by)
    if event is None or not event.training_flag or event.archived_at is not None or user is None:
        return 0

    now = datetime.now(UTC)
    state = await build_state(db, run.event_id, now=now)
    due = sorted(
        (s for i in state.incidents for s in i.steps if s.due_at is not None and s.due_at <= now),
        key=lambda s: s.due_at or now,
    )
    ran = 0
    for step in due:
        try:
            await _step_and_record(db, run.event_id, step.incident_id, step.key, user=user, by="autopilot")
            await db.commit()  # the task owns this session; the boards refetch on the broadcast
            ran += 1
        except (StepRefusedError, NotCurrentStepError) as exc:
            await db.rollback()
            logger.info("Autopilot skipped %s for %s: %s", step.key, step.incident_id, exc)
        except Exception:
            await db.rollback()
            logger.exception("Autopilot step %s failed for %s", step.key, step.incident_id)
    if ran:
        await broadcast_regie_state(await build_state(db, run.event_id))
    return ran


class RegieAutopilotTask:
    """Background loop of the Autopilot; started once from the app lifespan (not in demo mode)."""

    def __init__(self) -> None:
        self.running = False
        self.task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self.running:
            return
        self.running = True
        # A restart forgets the in-memory pause clock; the row still knows.
        with contextlib.suppress(Exception):
            async with async_session_maker() as db:
                run = await _stored_run(db)
            if run and run.paused_at:
                await gps_simulation.pause(run.paused_at)
        self.task = asyncio.create_task(self._loop())
        logger.info("Regie Autopilot task started")

    async def stop(self) -> None:
        self.running = False
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        logger.info("Regie Autopilot task stopped")

    async def _loop(self) -> None:
        while self.running:
            try:
                async with async_session_maker() as db:
                    await autopilot_tick(db)
            except Exception as e:
                logger.error("Error in Regie Autopilot: %s", e)
            await asyncio.sleep(TICK_SECONDS)


regie_autopilot_task = RegieAutopilotTask()
