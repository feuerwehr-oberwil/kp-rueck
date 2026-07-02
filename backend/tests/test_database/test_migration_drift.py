"""Alembic ↔ models drift test (audit point 14).

Schema truth is Alembic only — create_all was removed from the boot path.
This test builds a fresh database purely from migrations and compares it to
Base.metadata: a model change without a migration (or vice versa) fails here
instead of crash-looping the next production deploy with DuplicateTable.
"""

import asyncio
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app import models  # noqa: F401 — register all models on Base.metadata
from app.config import settings as app_settings
from app.database import Base

BACKEND_DIR = Path(__file__).resolve().parents[2]
ADMIN_URL = "postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck_test"
DRIFT_DB = "kprueck_test_drift"
DRIFT_URL = f"postgresql+asyncpg://kprueck:kprueck@localhost:5433/{DRIFT_DB}"


async def _recreate_drift_database() -> None:
    engine = create_async_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{DRIFT_DB}" (FORCE)'))
            await conn.execute(text(f'CREATE DATABASE "{DRIFT_DB}"'))
    finally:
        await engine.dispose()


def _diff_against_models(sync_conn) -> list:
    ctx = MigrationContext.configure(sync_conn)
    return compare_metadata(ctx, Base.metadata)


async def _collect_diffs() -> list:
    engine = create_async_engine(DRIFT_URL)
    try:
        async with engine.connect() as conn:
            return await conn.run_sync(_diff_against_models)
    finally:
        await engine.dispose()


def _is_relevant(diff) -> bool:
    """Filter autogenerate noise that isn't real drift."""
    # Batched diffs (e.g. modify_type) come as lists; inspect the first entry.
    entry = diff[0] if isinstance(diff, list) else diff
    # alembic's own bookkeeping table isn't in Base.metadata by design.
    if entry[0] == "remove_table" and entry[1].name == "alembic_version":
        return False
    return True


# Intentionally a SYNC test: alembic's async env.py calls asyncio.run(),
# which would blow up inside an already-running pytest-asyncio loop.
def test_migrations_match_models(monkeypatch):
    asyncio.run(_recreate_drift_database())

    # alembic/env.py builds its engine from app settings — point it at the
    # scratch database for the upgrade run.
    monkeypatch.setattr(app_settings, "database_url", DRIFT_URL)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")

    diffs = [d for d in asyncio.run(_collect_diffs()) if _is_relevant(d)]

    assert diffs == [], (
        "Schema drift between migrations and models detected. Every model "
        "change needs a migration (just db new \"...\"), and every migration "
        "must match the model. Diffs:\n" + "\n".join(repr(d) for d in diffs)
    )
