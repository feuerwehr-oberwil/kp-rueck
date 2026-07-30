"""Alembic ↔ models drift test (audit point 14).

Schema truth is Alembic only — create_all was removed from the boot path.
This test builds a fresh database purely from migrations and compares it to
Base.metadata: a model change without a migration (or vice versa) fails here
instead of crash-looping the next production deploy with DuplicateTable.
"""

import asyncio
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import command
from app import models  # noqa: F401 — register all models on Base.metadata
from app.config import settings as app_settings
from app.database import Base
from tests.conftest import create_scratch_database, drop_scratch_database, worker_database_url

BACKEND_DIR = Path(__file__).resolve().parents[2]

# Derived from TEST_DATABASE_URL, never hardcoded: this test used to pin
# localhost:5433, so every run against a Postgres on any other port failed HERE and read
# like real schema drift until someone opened the file. The `_drift` suffix keeps the
# scratch database separate from the one the rest of the suite uses, and under pytest-xdist
# the worker id is appended too (`kprueck_test_drift_gw0`) so parallel workers do not each
# drop the database another one is migrating.
DRIFT_URL = worker_database_url(suffix="_drift")


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
    return not (entry[0] == "remove_table" and entry[1].name == "alembic_version")


# Intentionally a SYNC test: alembic's async env.py calls asyncio.run(),
# which would blow up inside an already-running pytest-asyncio loop.
def test_migrations_match_models(monkeypatch):
    asyncio.run(create_scratch_database(DRIFT_URL))

    # alembic/env.py builds its engine from app settings — point it at the
    # scratch database for the upgrade run. Config() WITHOUT the ini file:
    # loading alembic.ini would run fileConfig(), which reconfigures global
    # logging and silently breaks log-assertion tests later in the run.
    monkeypatch.setattr(app_settings, "database_url", DRIFT_URL)
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    try:
        command.upgrade(cfg, "head")
        diffs = [d for d in asyncio.run(_collect_diffs()) if _is_relevant(d)]
    finally:
        # Under -n this would otherwise leave one scratch database per worker behind.
        asyncio.run(drop_scratch_database(DRIFT_URL))

    assert diffs == [], (
        "Schema drift between migrations and models detected. Every model "
        'change needs a migration (just db new "..."), and every migration '
        "must match the model. Diffs:\n" + "\n".join(repr(d) for d in diffs)
    )
