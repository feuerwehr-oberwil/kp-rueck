"""Background sync scheduler for periodic Railway ↔ Local synchronization."""
import asyncio
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.database import get_db
from app.services.sync_service import create_sync_service
from app.services.settings import get_setting_value


# Global scheduler instance
scheduler: AsyncIOScheduler | None = None
last_interval_minutes: int | None = None


async def scheduled_sync():
    """
    Run periodic sync from Railway to Local.

    This function:
    1. Checks if Railway URL is configured
    2. Checks Railway health
    3. Syncs from Railway if healthy
    4. Checks if sync interval has changed and reschedules if needed
    """
    global scheduler, last_interval_minutes

    # Skip if no Railway URL configured (local-only mode)
    if not settings.railway_url:
        print("Sync skipped: No Railway URL configured (local-only mode)")
        return

    print(f"[{datetime.now()}] Running scheduled sync from Railway...")

    # Get database session
    async for db in get_db():
        try:
            # Check if sync interval has changed
            interval_str = await get_setting_value(db, "sync_interval_minutes", "2")
            current_interval = int(interval_str)

            if last_interval_minutes != current_interval:
                print(f"[{datetime.now()}] Sync interval changed from {last_interval_minutes} to {current_interval} minutes")
                last_interval_minutes = current_interval

                # Reschedule the job with new interval
                if scheduler and scheduler.running:
                    scheduler.reschedule_job(
                        'railway_sync',
                        trigger=IntervalTrigger(minutes=current_interval)
                    )
                    print(f"[{datetime.now()}] Rescheduled sync job with {current_interval} minute interval")

            sync_service = await create_sync_service(db)

            # Check Railway health first
            railway_healthy = await sync_service.check_railway_health()
            if not railway_healthy:
                print(f"[{datetime.now()}] Sync skipped: Railway is unreachable")
                return

            # Perform sync
            result = await sync_service.sync_from_railway()

            if result.success:
                total_synced = sum(result.records_synced.values())
                print(
                    f"[{datetime.now()}] Sync completed successfully: "
                    f"{total_synced} records synced"
                )
            else:
                print(f"[{datetime.now()}] Sync failed: {result.errors}")

        except Exception as e:
            print(f"[{datetime.now()}] Sync error: {e}")
        finally:
            break  # Only use one session


def start_sync_scheduler():
    """
    Start the background sync scheduler.

    Called during FastAPI lifespan startup.
    Uses config default interval on startup, then dynamically adjusts based on database settings.
    """
    global scheduler, last_interval_minutes

    # Skip if no Railway URL configured
    if not settings.railway_url:
        print("Sync scheduler: Disabled (no Railway URL configured)")
        return

    # Initialize with config default (will be updated on first sync if database setting differs)
    last_interval_minutes = settings.sync_interval_minutes
    print(f"Starting sync scheduler (initial interval: {settings.sync_interval_minutes} minutes)...")

    scheduler = AsyncIOScheduler()

    # Add scheduled sync job
    scheduler.add_job(
        scheduled_sync,
        trigger=IntervalTrigger(minutes=settings.sync_interval_minutes),
        id='railway_sync',
        name='Railway → Local periodic sync',
        replace_existing=True
    )

    scheduler.start()
    print(f"Sync scheduler started (syncing every {settings.sync_interval_minutes} minutes)")


def stop_sync_scheduler():
    """
    Stop the background sync scheduler.

    Called during FastAPI lifespan shutdown.
    """
    global scheduler

    if scheduler and scheduler.running:
        print("Stopping sync scheduler...")
        scheduler.shutdown(wait=True)
        print("Sync scheduler stopped")
