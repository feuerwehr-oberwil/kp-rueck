"""Periodic board-snapshot printing for the paper-fallback routine.

Started once from the app lifespan and idles until ``fallback.auto_print_enabled``
is switched on. While enabled (and the thermal printer is enabled), every live
(non-training, non-archived) event gets a board-snapshot print job queued every
``fallback.auto_print_interval_min`` minutes — but only when the board actually
changed since the last automatic snapshot, so a quiet night doesn't burn a roll
of thermal paper. Automatic jobs carry ``payload["auto"] = true``.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Event, Incident, IncidentAssignment, PrintJob
from app.services import settings as settings_service

logger = logging.getLogger(__name__)

# How often the monitor wakes up to check the setting / due snapshots.
TICK_SECONDS = 60


async def _last_auto_job(db: AsyncSession, event_id) -> PrintJob | None:
    result = await db.execute(
        select(PrintJob)
        .where(
            PrintJob.event_id == event_id,
            PrintJob.job_type == "board",
            PrintJob.payload["auto"].as_boolean().is_(True),
        )
        .order_by(PrintJob.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def _board_changed_since(db: AsyncSession, event_id, since: datetime) -> bool:
    """True if any incident or assignment of the event changed after ``since``."""
    incident_changed = await db.execute(
        select(func.count()).select_from(Incident).where(Incident.event_id == event_id, Incident.updated_at > since)
    )
    if incident_changed.scalar_one() > 0:
        return True

    assignment_changed = await db.execute(
        select(func.count())
        .select_from(IncidentAssignment)
        .join(Incident, IncidentAssignment.incident_id == Incident.id)
        .where(
            Incident.event_id == event_id,
            func.coalesce(IncidentAssignment.unassigned_at, IncidentAssignment.assigned_at) > since,
        )
    )
    return assignment_changed.scalar_one() > 0


class FallbackPrintTask:
    """Queues periodic board-snapshot print jobs while the fallback toggle is on."""

    def __init__(self):
        self.running = False
        self.task: asyncio.Task | None = None

    async def start(self):
        if self.running:
            return
        self.running = True
        self.task = asyncio.create_task(self._monitor_loop())
        logger.info("Fallback auto-print task started")

    async def stop(self):
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        logger.info("Fallback auto-print task stopped")

    async def _monitor_loop(self):
        while self.running:
            try:
                async for db in get_db():
                    try:
                        await self._check_and_print(db)
                    finally:
                        await db.close()
                        break
            except Exception as e:
                logger.error("Error in fallback auto-print monitor: %s", e)

            await asyncio.sleep(TICK_SECONDS)

    async def _check_and_print(self, db: AsyncSession):
        enabled = await settings_service.get_setting_value(db, "fallback.auto_print_enabled", "false")
        if enabled.lower() != "true":
            return
        printer_enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
        if printer_enabled.lower() != "true":
            return

        raw_interval = await settings_service.get_setting_value(db, "fallback.auto_print_interval_min", "15")
        try:
            interval_min = max(5, min(120, int(raw_interval)))
        except ValueError:
            interval_min = 15

        result = await db.execute(select(Event).where(Event.archived_at.is_(None), Event.training_flag.is_(False)))
        events = result.scalars().all()
        now = datetime.now(UTC)

        for event in events:
            last_job = await _last_auto_job(db, event.id)
            if last_job is not None and last_job.created_at > now - timedelta(minutes=interval_min):
                continue
            # First snapshot after enabling prints unconditionally; afterwards
            # only when the board changed — identical prints help nobody.
            if last_job is not None and not await _board_changed_since(db, event.id, last_job.created_at):
                continue

            # Imported lazily: api.print pulls in the FastAPI router machinery,
            # which must not load before the app module itself during startup.
            from app.api.print import _build_board_payload

            payload = await _build_board_payload(
                db,
                event.id,
                include_incidents=True,
                include_completed=False,
                include_vehicles=True,
                include_personnel=True,
            )
            payload["auto"] = True

            job = PrintJob(job_type="board", status="pending", payload=payload, event_id=event.id)
            db.add(job)
            await db.commit()
            logger.info("Queued automatic fallback board snapshot for event %s", event.id)


fallback_print_task = FallbackPrintTask()
