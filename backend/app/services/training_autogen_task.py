"""Background task for training emergency auto-generation."""

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Event, Incident, Setting
from app.services.training import TrainingGenerator

logger = logging.getLogger(__name__)


class TrainingAutoGenTask:
    """Manages auto-generation background task for training events."""

    def __init__(self):
        self.running = False
        self.task = None
        self.current_event_id = None

    async def start(self):
        """Start the background task monitoring loop."""
        if self.running:
            return

        self.running = True
        self.task = asyncio.create_task(self._monitor_loop())
        logger.info("Training auto-generation task started")

    async def stop(self):
        """Stop the background task."""
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        logger.info("Training auto-generation task stopped")

    async def _monitor_loop(self):
        """Monitor settings and manage auto-generation."""
        while self.running:
            try:
                async for db in get_db():
                    try:
                        await self._check_and_run(db)
                    finally:
                        await db.close()
                        break
            except Exception as e:
                logger.error("Error in training auto-gen monitor: %s", e)

            # Check every 5 seconds
            await asyncio.sleep(5)

    async def _check_and_run(self, db: AsyncSession):
        """Check if auto-gen is enabled and run generation if needed."""
        # Get settings
        result = await db.execute(
            select(Setting).where(
                Setting.key.in_(
                    [
                        "training_autogen_enabled",
                        "training_autogen_interval_min",
                        "training_boost_multiplicator",
                        "training_boost_duration_min",
                        "training_autogen_max_emergencies",
                    ]
                )
            )
        )
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

        # Check max emergencies limit
        max_emergencies = int(settings.get("training_autogen_max_emergencies", 50))
        incident_count_result = await db.execute(select(Incident).where(Incident.event_id == event.id))
        incident_count = len(incident_count_result.scalars().all())

        if incident_count >= max_emergencies:
            # Max reached - stop auto-generation
            if self.current_event_id == event.id:
                logger.info(
                    "Training auto-gen stopped: Max emergencies (%d) reached for event %s", max_emergencies, event.id
                )
                self.current_event_id = None
            return

        # Get interval in minutes
        interval_min = int(settings.get("training_autogen_interval_min", 5))
        boost_mult = float(settings.get("training_boost_multiplicator", 2.0))
        boost_duration_min = int(settings.get("training_boost_duration_min", 30))

        # Calculate if we're in boost period
        event_age_minutes = (datetime.now(UTC) - event.created_at).total_seconds() / 60
        if event_age_minutes < boost_duration_min:
            # Apply boost multiplier (shorter interval)
            actual_interval_min = interval_min / boost_mult
        else:
            actual_interval_min = interval_min

        # Check last incident creation time
        last_incident_result = await db.execute(
            select(Incident).where(Incident.event_id == event.id).order_by(Incident.created_at.desc()).limit(1)
        )
        last_incident = last_incident_result.scalar_one_or_none()

        should_generate = False
        if not last_incident:
            # No incidents yet, generate first one
            should_generate = True
        else:
            # Check if enough time has passed
            time_since_last = (datetime.now(UTC) - last_incident.created_at).total_seconds() / 60
            if time_since_last >= actual_interval_min:
                should_generate = True

        if should_generate:
            try:
                # Generate emergency
                generator = TrainingGenerator(db)
                incident = await generator.generate_emergency(event.id, settings=settings)
                logger.info(
                    "Auto-generated training emergency: %s (interval: %.1f min)", incident.title, actual_interval_min
                )
            except Exception as e:
                logger.error("Failed to auto-generate emergency: %s", e)


# Global task instance
training_autogen_task = TrainingAutoGenTask()
