"""Measured on-disk usage behind the operator's storage limits.

Two numbers, deliberately measured two different ways because they live in two different
places on a station box:

* **Database** — ``pg_database_size(current_database())``. That is what Postgres itself has
  written for this database (heap, indexes, TOAST), on whatever volume PGDATA sits on. It is
  NOT the free space of that volume, and it does not include WAL or other databases on the
  same cluster.
* **Photos** — the byte sum of the tree under ``photo_storage.photos_dir``. In the compose
  stack that is a bind/volume mount which may well be a different filesystem than PGDATA, so
  the two numbers must not be added together and are reported separately.

Both are read on the notification poll path (``GET /api/notifications/``, hit every ~10 s by
every connected board), so both are cached process-wide for ``CACHE_TTL_SECONDS``: a photo
tree walk is one ``stat`` per file and ``pg_database_size`` stats every relation file of the
database. Disk usage moves in minutes, not seconds — measuring it per poll per client would
be pure waste. A single lock keeps concurrent polls from stampeding into the same measurement.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

#: Binary GB — the unit the settings inputs are labelled in.
BYTES_PER_GB = 1024**3

#: How long a measurement stays fresh. Long enough that a room full of boards polling every
#: 10 s costs one measurement per five minutes, short enough that an operator who just deleted
#: an event sees the alarm clear within a coffee break.
CACHE_TTL_SECONDS = 300.0


@dataclass(frozen=True)
class StorageUsage:
    """Measured bytes, or ``None`` where the measurement was not possible.

    ``None`` is not zero: an unreadable photo directory or a non-Postgres bind must not read
    as «plenty of room left», so callers skip the comparison entirely rather than compare
    against 0.
    """

    database_bytes: int | None
    photo_bytes: int | None


_cache: tuple[float, StorageUsage] | None = None
_lock = asyncio.Lock()


async def _measure_database_bytes(db: AsyncSession) -> int | None:
    """Size of the connected Postgres database, or ``None`` if it cannot be determined."""
    dialect = getattr(db.bind, "dialect", None)
    if dialect is None or dialect.name != "postgresql":
        # Guarded rather than attempted: a failing statement aborts the surrounding
        # transaction, and this runs in the middle of notification evaluation.
        return None

    try:
        result = await db.execute(text("SELECT pg_database_size(current_database())"))
        return int(result.scalar_one())
    except Exception as e:  # pragma: no cover - depends on server permissions
        logger.debug("pg_database_size failed: %s", e)
        return None


def _measure_tree_bytes(root: Path) -> int | None:
    """Sum the file sizes under ``root``. Blocking — call from a worker thread.

    Symlinked directories are not followed (``os.walk`` default), so a stray link cannot
    make the photo volume look like the whole host. Files that vanish mid-walk — an upload
    being replaced, a deleted incident's folder — are skipped rather than raised on.
    """
    if not root.is_dir():
        # No photos yet is a legitimate zero, not a failure.
        return 0 if not root.exists() else None

    total = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            try:
                total += os.lstat(os.path.join(dirpath, name)).st_size
            except OSError:
                continue
    return total


async def _measure_photo_bytes() -> int | None:
    """Byte sum of the photo storage tree, resolved from the photo storage service."""
    from .photo_storage import photo_storage

    try:
        return await asyncio.to_thread(_measure_tree_bytes, photo_storage.photos_dir)
    except OSError as e:
        logger.debug("Photo storage measurement failed: %s", e)
        return None


async def get_storage_usage(db: AsyncSession, *, max_age_seconds: float = CACHE_TTL_SECONDS) -> StorageUsage:
    """Return measured storage usage, re-measuring only once per ``max_age_seconds``.

    Pass ``max_age_seconds=0`` to force a fresh measurement.
    """
    global _cache

    now = time.monotonic()
    cached = _cache
    if cached is not None and now - cached[0] < max_age_seconds:
        return cached[1]

    async with _lock:
        # Another poll may have measured while we waited for the lock.
        cached = _cache
        now = time.monotonic()
        if cached is not None and now - cached[0] < max_age_seconds:
            return cached[1]

        usage = StorageUsage(
            database_bytes=await _measure_database_bytes(db),
            photo_bytes=await _measure_photo_bytes(),
        )
        _cache = (time.monotonic(), usage)
        return usage


def reset_storage_usage_cache() -> None:
    """Drop the cached measurement (tests, and after a bulk delete)."""
    global _cache
    _cache = None


def format_gb(num_bytes: int) -> str:
    """German-formatted GB with one decimal, e.g. ``4,7``."""
    return f"{num_bytes / BYTES_PER_GB:.1f}".replace(".", ",")
