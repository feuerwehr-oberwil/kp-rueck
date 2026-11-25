"""Remove stored photos no report points at – the files a crash left behind.

A photo upload writes the JPEG first and commits the report row after it. A refused commit
removes its file (`after_rollback`), but a process killed between the two leaves a file no
row names (hunt 2026-11-24, R4). This job finds those and removes them, every six hours and
once shortly after start.

Never a file a row points at. A file counts as referenced when any of these name it under
its incident's folder: a Reko report, a Schadenplatz-Rapport (KP and /feld), or a Reko row
the one-report migration parked in `reko_reports_folded` (its downgrade puts them back).
Only files at least `MIN_AGE` old by BOTH their modification and their inode-change time
are candidates: an upload whose commit is still on its way is seconds old, and a merge copy
(`copy2` keeps the source's mtime) – or a file a merge keeps and attaches anew
(`copy_photos` refreshes its change time) – is new by its change time. The age is checked
again right before each removal, after the rows were read. Folders that are not an
incident id, and files at the top of the photo folder, are not touched. A standby box does
not run it: its photos follow the mirrored rows. Never raises.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_maker
from app.logging_config import get_logger
from app.services.photo_storage import photo_storage

logger = get_logger(__name__)

#: How old a file must be before it may go – far past any request still on its way.
MIN_AGE = timedelta(hours=24)

scheduler: AsyncIOScheduler | None = None

_REFERENCES = text(
    """
    SELECT incident_id::text, jsonb_array_elements_text(photos_json) FROM reko_reports
      WHERE jsonb_typeof(photos_json) = 'array'
    UNION
    SELECT incident_id::text, jsonb_array_elements_text(photos_json) FROM schadenplatz_reports
      WHERE jsonb_typeof(photos_json) = 'array'
    UNION
    SELECT incident_id::text, jsonb_array_elements_text(row_json -> 'photos_json') FROM reko_reports_folded
      WHERE jsonb_typeof(row_json -> 'photos_json') = 'array'
    """
)


def _is_old(path: Path, cutoff: float) -> bool:
    """Older than `cutoff` by both modification and change time; False once it is gone."""
    try:
        stat = path.stat()
    except FileNotFoundError:
        return False
    return max(stat.st_mtime, stat.st_ctime) < cutoff


def _old_files(photos_dir: Path, cutoff: float) -> list[tuple[str, Path]]:
    """(incident folder, file) for every file older than `cutoff` in an incident folder."""
    found: list[tuple[str, Path]] = []
    if not photos_dir.is_dir():
        return found
    for folder in photos_dir.iterdir():
        try:
            uuid.UUID(folder.name)
        except ValueError:
            continue
        if not folder.is_dir() or folder.is_symlink():
            continue
        for path in folder.iterdir():
            if path.is_file() and not path.is_symlink() and _is_old(path, cutoff):
                found.append((folder.name, path))
    return found


async def sweep_orphan_photos(db: AsyncSession, *, now: datetime | None = None) -> int:
    """Remove every old photo file no row names (see the module header). Returns how many."""
    cutoff = ((now or datetime.now(UTC)) - MIN_AGE).timestamp()
    # Files first, rows second: a row committed in between can only name a file this list
    # already holds if that file is old – and an old file named anew is a merge copy, which
    # is new by its change time and so not in the list.
    candidates = await asyncio.to_thread(_old_files, photo_storage.photos_dir, cutoff)
    if not candidates:
        return 0
    referenced = {(incident_id, name) for incident_id, name in (await db.execute(_REFERENCES)).all()}
    removed = 0
    for incident_id, path in candidates:
        # Still old after the rows were read: a merge that attached it meanwhile made it new.
        if (incident_id, path.name) in referenced or not _is_old(path, cutoff):
            continue
        try:
            path.unlink()
            removed += 1
        except FileNotFoundError:
            continue
        except OSError:
            logger.warning("Orphan photo %s/%s could not be removed", incident_id, path.name)
    return removed


async def run_photo_sweep() -> int:
    try:
        async with async_session_maker() as db:
            removed = await sweep_orphan_photos(db)
        if removed:
            logger.info("Photos: removed %d file(s) no report points at", removed)
        return removed
    except Exception as e:
        logger.warning("Orphan photo sweep failed (non-fatal): %s", type(e).__name__)
        return 0


def start_photo_sweep_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_photo_sweep, IntervalTrigger(hours=6), id="photo_sweep", replace_existing=True)
    scheduler.add_job(
        run_photo_sweep,
        DateTrigger(run_date=datetime.now(UTC) + timedelta(minutes=5)),
        id="photo_sweep_startup",
        replace_existing=True,
    )
    scheduler.start()


def stop_photo_sweep_scheduler() -> None:
    global scheduler
    if scheduler is not None and scheduler.running:
        try:
            scheduler.shutdown(wait=False)
        except Exception as e:
            logger.warning("Photo sweep scheduler shutdown error: %s", e)
    scheduler = None
