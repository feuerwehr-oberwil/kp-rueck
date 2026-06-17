"""Background scheduler for periodic audit log cleanup."""

from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import delete, select

from app.config import settings
from app.database import async_session_maker
from app.logging_config import get_logger
from app.models import AuditLog

logger = get_logger(__name__)

# Delete in batches to avoid long-running locks/transactions on a hot table
BATCH_SIZE = 10_000

# Demo instances reset frequently; keep their audit trail short regardless
DEMO_MAX_RETENTION_DAYS = 7

# Global state
scheduler: AsyncIOScheduler | None = None
_shutting_down: bool = False


def get_effective_retention_days() -> int:
    """Retention in days, capped in demo mode (explicit smaller override still wins)."""
    retention_days = settings.audit_retention_days
    if settings.demo_mode:
        retention_days = min(retention_days, DEMO_MAX_RETENTION_DAYS)
    return retention_days


async def cleanup_old_audit_logs(session_maker=None) -> int:
    """Delete audit_log rows older than the retention window.

    Deletes in batches of BATCH_SIZE, committing per batch. Never raises
    (background jobs must not crash the scheduler). Returns total deleted.

    session_maker: optional injectable session factory (for tests); defaults
    to the main application session maker.
    """
    if _shutting_down:
        logger.debug("Audit cleanup skipped: shutdown in progress")
        return 0

    maker = session_maker or async_session_maker
    cutoff = datetime.now(UTC) - timedelta(days=get_effective_retention_days())
    total_deleted = 0

    try:
        async with maker() as session:
            while True:
                subquery = select(AuditLog.id).where(AuditLog.timestamp < cutoff).limit(BATCH_SIZE)
                result = await session.execute(delete(AuditLog).where(AuditLog.id.in_(subquery)))
                await session.commit()

                deleted = result.rowcount or 0
                total_deleted += deleted
                if deleted == 0:
                    break

        logger.info(f"Audit cleanup: deleted {total_deleted} rows older than {cutoff.isoformat()}")
    except Exception as e:
        logger.error(f"Audit cleanup failed: {e}", exc_info=True)

    return total_deleted


def start_audit_cleanup_scheduler():
    """Start the audit cleanup scheduler."""
    global scheduler

    interval_hours = settings.audit_cleanup_interval_hours
    logger.info(
        f"Starting audit cleanup scheduler (interval: {interval_hours}h, retention: {get_effective_retention_days()}d)"
    )

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        cleanup_old_audit_logs,
        trigger=IntervalTrigger(hours=interval_hours),
        id="audit_cleanup",
        name="Audit log cleanup",
        replace_existing=True,
    )
    # Catch-up run shortly after startup so long-running instances that
    # predate this feature get cleaned promptly
    scheduler.add_job(
        cleanup_old_audit_logs,
        trigger=DateTrigger(run_date=datetime.now(UTC) + timedelta(minutes=5)),
        id="audit_cleanup_startup",
        name="Audit log cleanup (startup catch-up)",
        replace_existing=True,
    )
    scheduler.start()


def stop_audit_cleanup_scheduler():
    """Stop the audit cleanup scheduler."""
    global scheduler, _shutting_down

    _shutting_down = True
    if scheduler and scheduler.running:
        logger.info("Stopping audit cleanup scheduler...")
        try:
            scheduler.shutdown(wait=False)
            logger.info("Audit cleanup scheduler stopped")
        except Exception as e:
            logger.warning(f"Audit cleanup scheduler shutdown error: {e}")
