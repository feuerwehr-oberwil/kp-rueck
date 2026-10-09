"""Seed for the screenshot regression tests (frontend/tests/visual, docs/VISUAL_TESTS.md).

Run with: uv run python -m app.seed_visual   (on a migrated, EMPTY database)

A screenshot test is only as stable as its data, so this seed has one job: the same
board, to the pixel, on every run. It is the demo scenario (`seed_demo_event_content`:
a storm evening in Oberwil, every column filled, one Auftrag, Rekos, a filed Rapport)
pinned to ONE fixed instant, VISUAL_NOW, instead of the wall clock. The specs freeze
the browser clock at the same instant, so every «vor 35 min», every hh:mm and every
age colour reads the same in 2026 and in 2030.

Two things the demo story does not pin, and this module does:
- columns the database stamps itself (`server_default=now()`, `onupdate=now()`):
  `_pin_server_stamps` moves every one of them off the wall clock after the commit,
  and the seed refuses to finish while any timestamp is still later than VISUAL_NOW.
- the settings: a fixed station, the online map (the specs stub every tile), no logo.

Never in production, never on a database that has anything in it: it is a fixture,
not a migration, and a real board must not learn what the storm evening looked like.
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.environment import is_production_environment

from . import models
from .database import async_session_maker
from .seed import SEED_MARKER_KEY, get_admin_password, get_shared_account_password, production_account_set
from .seed_demo import seed_demo_event_content, seed_demo_shared_resources

# THE instant. frontend/tests/visual/visual.setup.ts freezes the browser clock at the
# same moment (VISUAL_NOW there) and checks it against the event's created_at, so a
# change here without the other fails loudly at the first spec, not as 14 odd diffs.
# A Saturday evening in July, the storm story's own setting: 19:30 in Oberwil (CEST).
VISUAL_NOW = datetime(2026, 7, 11, 17, 30, tzinfo=UTC)

# The story starts 185 minutes back (`event.created_at = ago(185)` in seed_demo);
# rows the story never dates (fleet, roster, templates) existed the day before.
_BEFORE_THE_STORY = VISUAL_NOW - timedelta(days=1)

VISUAL_EVENT_NAME = "Unwetter Oberwil"

_SETTINGS = [
    ("firestation_name", "Feuerwehr Oberwil"),
    ("kommandant_name", "Ackermann Reto"),
    ("firestation_latitude", "47.51637699933488"),
    ("firestation_longitude", "7.561800450458299"),
    ("home_city", "Oberwil, BL"),
    ("polling_interval_ms", "5000"),
    ("training_mode", "false"),
    # Online: the specs route every basemap request to a blank tile, and «online» is the
    # mode that does not probe the local tileserver first.
    ("map_mode", "online"),
    ("incident_time_display", "column"),
    ("auto_archive_timeout_hours", "24"),
    ("notification_enabled", "false"),
]


async def _pin_server_stamps(db: AsyncSession) -> None:
    """Move every database-stamped timestamp off the wall clock.

    Generic on purpose: a column added next year with `server_default=now()` would
    otherwise put today's date on a screenshot and fail the suite on the first day
    nobody remembers this file. Everything later than VISUAL_NOW came from the
    database's own clock, never from the story (which only ever looks back):
    - a table's `created_at` → the day before the story;
    - any other stamp on a row → that row's `created_at` (an `updated_at` that
      follows its creation, not the seed run);
    - a stamp on a table without `created_at` → the day before the story.
    """
    columns = (
        await db.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND data_type = 'timestamp with time zone' "
                "ORDER BY table_name, column_name"
            )
        )
    ).all()
    by_table: dict[str, list[str]] = {}
    for table, column in columns:
        by_table.setdefault(table, []).append(column)

    # Table and column names below come from information_schema (or this module), never from
    # input — they are identifiers, which a bind parameter cannot carry. Hence the noqa.
    params = {"now": VISUAL_NOW, "before": _BEFORE_THE_STORY}
    for table, cols in by_table.items():
        if "created_at" in cols:
            sql = f'UPDATE "{table}" SET created_at = :before WHERE created_at > :now'  # noqa: S608
            await db.execute(text(sql), params)
        for column in cols:
            if column == "created_at":
                continue
            fallback = "created_at" if "created_at" in cols else ":before"
            sql = f'UPDATE "{table}" SET "{column}" = {fallback} WHERE "{column}" > :now'  # noqa: S608
            await db.execute(text(sql), params)

    # Asserted, not assumed: one wall-clock stamp is one flaky screenshot.
    for table, cols in by_table.items():
        for column in cols:
            sql = f'SELECT count(*) FROM "{table}" WHERE "{column}" > :now'  # noqa: S608
            later = (await db.execute(text(sql), params)).scalar_one()
            if later:
                raise RuntimeError(f"{table}.{column}: {later} row(s) still later than VISUAL_NOW")


# (table, the column one list is drawn per) — every list the backend orders by `assigned_at`.
_ASSIGNMENT_LISTS = (("incident_assignments", "incident_id"), ("incident_group_assignments", "incident_group_id"))


async def _break_assignment_ties(db: AsyncSession) -> None:
    """Give rows that share an `assigned_at` within one list distinct ones, in name order.

    The backend orders crews by `assigned_at` alone (crud/assignments.py,
    crud/group_assignments.py), and the demo story assigns a whole crew in the same minute.
    Postgres returns ties in no promised order, so the Auftrag's «Moser Lea · Baumann Michael»
    swapped places between runs. A second apart, by name, is invisible on screen (minutes)
    and the same on every run.
    """
    for table, owner in _ASSIGNMENT_LISTS:  # module constants, not input (see _pin_server_stamps)
        sql = f"""
                UPDATE "{table}" AS a SET assigned_at = a.assigned_at + r.n * interval '1 second'
                FROM (
                    SELECT x.id, row_number() OVER (
                        PARTITION BY x."{owner}", x.assigned_at
                        ORDER BY x.resource_type, coalesce(p.name, v.name, m.name), x.id
                    ) - 1 AS n
                    FROM "{table}" x
                    LEFT JOIN personnel p ON x.resource_type = 'personnel' AND p.id = x.resource_id
                    LEFT JOIN vehicles v ON x.resource_type = 'vehicle' AND v.id = x.resource_id
                    LEFT JOIN materials m ON x.resource_type = 'material' AND m.id = x.resource_id
                ) AS r
                WHERE a.id = r.id AND r.n > 0
                """  # noqa: S608
        await db.execute(text(sql))


async def seed_visual(db: AsyncSession) -> models.Event:
    """Write the visual fixture into ``db`` (empty, migrated) and commit. Returns the event."""
    if is_production_environment():
        raise RuntimeError("app.seed_visual is a test fixture; it refuses to run in production")
    if (await db.execute(select(models.User).limit(1))).scalars().first():
        raise RuntimeError("app.seed_visual wants an EMPTY database (migrated, never seeded)")

    users = production_account_set(
        get_admin_password(),
        get_shared_account_password("VIEWER_PASSWORD", dev_default="viewer"),
    )
    for user in users:
        db.add(user)
    await db.flush()
    admin = next(user for user in users if user.username == "admin")

    for key, value in _SETTINGS:
        db.add(models.Setting(key=key, value=value, updated_by=admin.id))

    await seed_demo_shared_resources(db)

    # A real Ereignis, not a training one: the board an operator reads.
    event = models.Event(name=VISUAL_EVENT_NAME, training_flag=False)
    db.add(event)
    await db.flush()
    await seed_demo_event_content(db, event, now=VISUAL_NOW)
    # The story never touches the event's own activity stamp; «last activity» is the newest
    # Meldung (seed_demo: created ago(5)).
    event.last_activity_at = VISUAL_NOW - timedelta(minutes=5)

    db.add(models.Setting(key=SEED_MARKER_KEY, value=VISUAL_NOW.isoformat()))
    await db.commit()

    await _pin_server_stamps(db)
    await _break_assignment_ties(db)
    await db.commit()
    return event


async def seed_visual_database() -> None:
    async with async_session_maker() as db:
        await seed_visual(db)
    print(f"✅ Visual seed: «{VISUAL_EVENT_NAME}» at {VISUAL_NOW.isoformat()} (admin / ADMIN_SEED_PASSWORD)")


if __name__ == "__main__":
    if not os.getenv("ADMIN_SEED_PASSWORD"):
        raise SystemExit("ADMIN_SEED_PASSWORD must be set: the specs log in with it")
    asyncio.run(seed_visual_database())
