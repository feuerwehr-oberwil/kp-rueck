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
    Run periodic bidirectional sync: Railway ↔ Local.

    This function:
    1. Checks if Railway URL is configured in database
    2. Checks Railway health
    3. Pulls changes from Railway to Local
    4. Pushes local changes to Railway
    5. Checks if sync interval has changed and reschedules if needed
    """
    global scheduler, last_interval_minutes

    # Get database session
    async for db in get_db():
        try:
            # Check Railway URL from database settings
            railway_url = await get_setting_value(db, "railway_database_url", "")
            if not railway_url:
                print("Sync skipped: No Railway database URL configured in settings")
                return

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

            print(f"[{datetime.now()}] Running scheduled bidirectional sync...")
            sync_service = await create_sync_service(db)

            # Check Railway health first
            railway_healthy = await sync_service.check_railway_health()
            if not railway_healthy:
                print(f"[{datetime.now()}] Sync skipped: Railway is unreachable")
                return

            # Perform bidirectional sync
            results = await sync_service.sync_bidirectional()

            # Report results
            from_railway = results["from_railway"]
            to_railway = results["to_railway"]

            from_count = sum(from_railway.records_synced.values()) if from_railway.success else 0
            to_count = sum(to_railway.records_synced.values()) if to_railway.success else 0

            if from_railway.success and to_railway.success:
                print(
                    f"[{datetime.now()}] Bidirectional sync completed: "
                    f"{from_count} from Railway, {to_count} to Railway"
                )
            else:
                errors = []
                if not from_railway.success:
                    errors.append(f"FROM Railway: {from_railway.errors}")
                if not to_railway.success:
                    errors.append(f"TO Railway: {to_railway.errors}")
                print(f"[{datetime.now()}] Sync had errors: {'; '.join(errors)}")

        except Exception as e:
            print(f"[{datetime.now()}] Sync error: {e}")
        finally:
            break  # Only use one session


def start_sync_scheduler():
    """
    Start the background sync scheduler.

    Called during FastAPI lifespan startup.
    Railway URL is checked from database settings on each sync run.
    Uses config default interval on startup, then dynamically adjusts based on database settings.
    """
    global scheduler, last_interval_minutes

    # Always start scheduler - Railway URL will be checked from database at runtime
    # Initialize with config default (will be updated on first sync if database setting differs)
    last_interval_minutes = settings.sync_interval_minutes
    print(f"Starting sync scheduler (initial interval: {settings.sync_interval_minutes} minutes)...")

    scheduler = AsyncIOScheduler()

    # Add scheduled sync job
    scheduler.add_job(
        scheduled_sync,
        trigger=IntervalTrigger(minutes=settings.sync_interval_minutes),
        id='railway_sync',
        name='Railway ↔ Local bidirectional sync',
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
