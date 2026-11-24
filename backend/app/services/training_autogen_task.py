"""Background task for training emergency auto-generation.

Started once from the app lifespan (skipped in demo mode) and idles until the
Automatik is switched on. The switch is ``PUT /api/training/events/{id}/autogen``
(``switch_autogen`` below): it sets ``training_autogen_enabled`` and records the
run – which Übung to feed and since when – in the ``training_autogen.run`` row.
The «heisse Phase» (boost) counts from that start. At the max the task switches
itself off and says so (``stopped="max"``), so the page never shows «an» while
nothing comes. A run-less ``enabled=true`` (from before the run row existed)
feeds the newest active training event and boosts from its creation.

Two intake modes (``training_autogen_mode``):
- ``board``  — incidents materialize directly on the board (classic behaviour)
- ``divera`` — simulated alarms drop into the Divera pool so trainees run the
  real alarm-intake workflow (sound, toast, attach) before anything hits the board
"""

import asyncio
import contextlib
import logging
import uuid
from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_maker
from app.models import DiveraEmergency, Event, Incident, Setting
from app.schemas.training import AutogenRun, AutogenStateResponse, RegieRun
from app.services.settings import update_setting
from app.services.training import TrainingGenerator
from app.services.training_lifecycle import TEMPO_FACTOR, all_pauses, shift_past_pauses
from app.websocket_manager import broadcast_message

logger = logging.getLogger(__name__)

_SETTING_KEYS = [
    "training_autogen_enabled",
    "training_autogen_interval_min",
    "training_autogen_mode",
    "training_boost_multiplicator",
    "training_boost_duration_min",
    "training_autogen_max_emergencies",
    "training_normal_weight",
    "training_critical_weight",
]

ENABLED_KEY = "training_autogen_enabled"
RUN_KEY = "training_autogen.run"


async def read_autogen_state(db: AsyncSession) -> AutogenStateResponse:
    """The switch and the current run. An unreadable run row counts as no run."""
    result = await db.execute(select(Setting).where(Setting.key.in_([ENABLED_KEY, RUN_KEY])))
    rows = {s.key: s.value for s in result.scalars().all()}
    run = None
    if raw := rows.get(RUN_KEY):
        with contextlib.suppress(ValidationError):
            run = AutogenRun.model_validate_json(raw)
    return AutogenStateResponse(enabled=rows.get(ENABLED_KEY) == "true", run=run)


async def switch_autogen(
    db: AsyncSession, enabled: bool, *, event_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None
) -> AutogenStateResponse:
    """Switch the Automatik. On = a new run for ``event_id``, starting now. Flushes, does not commit."""
    await update_setting(db, ENABLED_KEY, "true" if enabled else "false", user_id)
    if enabled:
        if event_id is None:
            raise ValueError("switching the Automatik on needs the Übung it feeds")
        run = AutogenRun(event_id=event_id, started_at=datetime.now(UTC))
        await update_setting(db, RUN_KEY, run.model_dump_json(), user_id)
    return await read_autogen_state(db)


async def _read_settings(db: AsyncSession) -> dict[str, str]:
    result = await db.execute(select(Setting).where(Setting.key.in_(_SETTING_KEYS)))
    return {s.key: s.value for s in result.scalars().all()}


async def next_alarm_at(
    db: AsyncSession,
    event: Event,
    run: AutogenRun | None,
    settings: dict[str, str],
    regie: RegieRun | None,
    now: datetime,
) -> datetime:
    """When the Automatik's next alarm falls due; `now` when nothing was generated yet.

    The interval counts from the last alarm – board incidents and simulated pool alarms
    both count, so switching modes does not double-fire. Inside the «heisse Phase» (from the
    switch-on; a run-less legacy switch uses the event's creation) it is divided by the
    boost, and by the Regie's tempo factor; the Regie's pauses do not count.
    """
    last_times: list[datetime] = []
    last_incident_at = (
        await db.execute(select(func.max(Incident.created_at)).where(Incident.event_id == event.id))
    ).scalar_one_or_none()
    if last_incident_at:
        last_times.append(last_incident_at)
    last_pool_at = (
        await db.execute(select(func.max(DiveraEmergency.received_at)).where(DiveraEmergency.is_training.is_(True)))
    ).scalar_one_or_none()
    if last_pool_at:
        last_times.append(last_pool_at)
    if not last_times:
        return now  # nothing generated yet – start the exercise off

    interval_min = float(settings.get("training_autogen_interval_min", 5))
    boost_mult = float(settings.get("training_boost_multiplicator", 2.0))
    boost_duration_min = int(settings.get("training_boost_duration_min", 30))
    boost_from = run.started_at if run else event.created_at
    running_minutes = (now - boost_from).total_seconds() / 60
    if running_minutes < boost_duration_min:
        interval_min /= boost_mult

    if regie is None:
        return max(last_times) + timedelta(minutes=interval_min)
    seconds = interval_min * 60 / TEMPO_FACTOR[regie.tempo]
    return shift_past_pauses(max(last_times), seconds, all_pauses(regie.pauses, regie.paused_at, now))


async def automatik_next_at(db: AsyncSession, state: AutogenStateResponse, regie: RegieRun) -> datetime | None:
    """The next alarm for the Regie's timeline: None unless the Automatik is on and feeds this Übung."""
    if not state.enabled or state.run is None or state.run.event_id != regie.event_id:
        return None
    event = await db.get(Event, regie.event_id)
    if event is None:
        return None
    return await next_alarm_at(db, event, state.run, await _read_settings(db), regie, datetime.now(UTC))


async def broadcast_autogen_state(state: AutogenStateResponse) -> None:
    """Tell every open Übungssteuerung that the Automatik changed (switch, or stop at the max)."""
    await broadcast_message({"type": "training_autogen", **state.model_dump(mode="json")})


class TrainingAutoGenTask:
    """Manages auto-generation background task for training events."""

    def __init__(self) -> None:
        self.running = False
        self.task: asyncio.Task[None] | None = None
        self.current_event_id: uuid.UUID | None = None

    async def start(self) -> None:
        """Start the background task monitoring loop."""
        if self.running:
            return

        self.running = True
        self.task = asyncio.create_task(self._monitor_loop())
        logger.info("Training auto-generation task started")

    async def stop(self) -> None:
        """Stop the background task."""
        self.running = False
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        logger.info("Training auto-generation task stopped")

    async def _monitor_loop(self) -> None:
        """Monitor settings and manage auto-generation."""
        while self.running:
            try:
                async with async_session_maker() as db:
                    await self._check_and_run(db)
            except Exception as e:
                logger.error("Error in training auto-gen monitor: %s", e)

            # Check every 5 seconds
            await asyncio.sleep(5)

    async def _check_and_run(self, db: AsyncSession) -> None:
        """Check if auto-gen is enabled and run generation if needed."""
        from app.services.training_regie import read_regie_run

        settings = await _read_settings(db)
        state = await read_autogen_state(db)
        if not state.enabled:
            self.current_event_id = None
            return

        event = await self._target_event(db, state.run)
        if not event:
            self.current_event_id = None
            return

        # The Regie's ⏸ freezes the Automatik too; its tempo and pauses pace the interval.
        regie = await read_regie_run(db, event.id)
        if regie and regie.paused_at:
            return

        # Check max emergencies limit: incidents on the board plus simulated
        # pool alarms the trainee hasn't attached yet — both are exercise load.
        max_emergencies = int(settings.get("training_autogen_max_emergencies", 50))
        incident_count = (
            await db.execute(select(func.count()).select_from(Incident).where(Incident.event_id == event.id))
        ).scalar_one()
        pool_count = (
            await db.execute(
                select(func.count())
                .select_from(DiveraEmergency)
                .where(DiveraEmergency.is_training.is_(True))
                .where(DiveraEmergency.is_archived.is_(False))
                .where(DiveraEmergency.attached_to_event_id.is_(None))
            )
        ).scalar_one()

        if incident_count + pool_count >= max_emergencies:
            # Max reached: switch off for real, so the page shows «aus» and why.
            logger.info(
                "Training auto-gen stopped: max emergencies (%d) reached for event %s", max_emergencies, event.id
            )
            self.current_event_id = None
            await update_setting(db, ENABLED_KEY, "false", None)
            if state.run:
                stopped = state.run.model_copy(update={"stopped": "max"})
                await update_setting(db, RUN_KEY, stopped.model_dump_json(), None)
            await db.commit()  # the task owns this session; the broadcast below must see the row
            await broadcast_autogen_state(await read_autogen_state(db))
            return

        now = datetime.now(UTC)
        if now < await next_alarm_at(db, event, state.run, settings, regie, now):
            return
        self.current_event_id = event.id
        try:
            await self._generate(db, event, settings)
        except Exception as e:
            logger.error("Failed to auto-generate emergency: %s", e)

    @staticmethod
    async def _target_event(db: AsyncSession, run: AutogenRun | None) -> Event | None:
        """The Übung to feed: the run's, while it is an open training event; without a run the newest one."""
        if run:
            event = await db.get(Event, run.event_id)
            return event if event and event.training_flag and event.archived_at is None else None
        result = await db.execute(
            select(Event)
            .where(Event.training_flag == True)  # noqa: E712
            .where(Event.archived_at.is_(None))
            .order_by(Event.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _generate(self, db: AsyncSession, event: Event, settings: dict[str, str]) -> None:
        """Generate one alarm in the configured intake mode and broadcast it."""
        from app import schemas
        from app.services.divera_intake import broadcast_emergency_received
        from app.websocket_manager import broadcast_incident_update

        generator = TrainingGenerator(db)
        mode = settings.get("training_autogen_mode", "board")

        if mode == "divera":
            emergency = await generator.generate_pool_emergency(event.id, settings=settings)
            await db.commit()  # the boards refetch on the broadcast
            await broadcast_emergency_received(
                schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode="json"),
            )
            logger.info("Auto-generated simulated Divera alarm: %s", emergency.title)
        else:
            incident = await generator.generate_emergency(event.id, settings=settings)
            await db.commit()  # the boards refetch on the broadcast
            await broadcast_incident_update(
                schemas.IncidentResponse.model_validate(incident).model_dump(mode="json"), "create"
            )
            logger.info("Auto-generated training emergency: %s", incident.title)


# Global task instance
training_autogen_task = TrainingAutoGenTask()
