"""Background task for training emergency auto-generation.

Started once from the app lifespan (skipped in demo mode) and idles until the
``training_autogen_enabled`` setting is switched on — the Übungssteuerung
exposes the controls. Generation targets the newest active training event.

Two intake modes (``training_autogen_mode``):
- ``board``  — incidents materialize directly on the board (classic behaviour)
- ``divera`` — simulated alarms drop into the Divera pool so trainees run the
  real alarm-intake workflow (sound, toast, attach) before anything hits the board
"""

import asyncio
import contextlib
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DiveraEmergency, Event, Incident, Setting
from app.services.training import TrainingGenerator

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
                async for db in get_db():
                    try:
                        await self._check_and_run(db)
                    finally:
                        await db.close()
                    break  # outside `finally` — there it would swallow the error above
            except Exception as e:
                logger.error("Error in training auto-gen monitor: %s", e)

            # Check every 5 seconds
            await asyncio.sleep(5)

    async def _check_and_run(self, db: AsyncSession) -> None:
        """Check if auto-gen is enabled and run generation if needed."""
        # Get settings
        result = await db.execute(select(Setting).where(Setting.key.in_(_SETTING_KEYS)))
        settings_rows = result.scalars().all()
        settings = {s.key: s.value for s in settings_rows}

        enabled = settings.get("training_autogen_enabled") == "true"

        if not enabled:
            self.current_event_id = None
            return

        # Find active training event
        # Note: Event.archived_at.is_(None) means not archived
        event_result = await db.execute(
            select(Event)
            .where(Event.training_flag == True)  # noqa: E712
            .where(Event.archived_at.is_(None))
            .order_by(Event.created_at.desc())
            .limit(1)
        )
        event = event_result.scalar_one_or_none()

        if not event:
            self.current_event_id = None
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
            # Max reached - stop auto-generation
            if self.current_event_id == event.id:
                logger.info(
                    "Training auto-gen stopped: Max emergencies (%d) reached for event %s", max_emergencies, event.id
                )
                self.current_event_id = None
            return

        # Get interval in minutes
        interval_min = float(settings.get("training_autogen_interval_min", 5))
        boost_mult = float(settings.get("training_boost_multiplicator", 2.0))
        boost_duration_min = int(settings.get("training_boost_duration_min", 30))

        # Calculate if we're in boost period
        event_age_minutes = (datetime.now(UTC) - event.created_at).total_seconds() / 60
        # Inside the boost window the interval is divided by the multiplier (fires sooner).
        actual_interval_min = interval_min / boost_mult if event_age_minutes < boost_duration_min else interval_min

        # Time since the last generated alarm — board incidents and simulated
        # pool alarms both count, so switching modes doesn't double-fire.
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

        should_generate = False
        if not last_times:
            # Nothing generated yet — start the exercise off
            should_generate = True
        else:
            time_since_last = (datetime.now(UTC) - max(last_times)).total_seconds() / 60
            if time_since_last >= actual_interval_min:
                should_generate = True

        if should_generate:
            self.current_event_id = event.id
            try:
                await self._generate(db, event, settings)
            except Exception as e:
                logger.error("Failed to auto-generate emergency: %s", e)

    async def _generate(self, db: AsyncSession, event: Event, settings: dict[str, str]) -> None:
        """Generate one alarm in the configured intake mode and broadcast it."""
        from app import schemas
        from app.services.divera_intake import broadcast_emergency_received
        from app.websocket_manager import broadcast_incident_update

        generator = TrainingGenerator(db)
        mode = settings.get("training_autogen_mode", "board")

        if mode == "divera":
            emergency = await generator.generate_pool_emergency(event.id, settings=settings)
            await broadcast_emergency_received(
                schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode="json"),
            )
            logger.info("Auto-generated simulated Divera alarm: %s", emergency.title)
        else:
            incident = await generator.generate_emergency(event.id, settings=settings)
            await broadcast_incident_update(
                schemas.IncidentResponse.model_validate(incident).model_dump(mode="json"), "create"
            )
            logger.info("Auto-generated training emergency: %s", incident.title)


# Global task instance
training_autogen_task = TrainingAutoGenTask()
