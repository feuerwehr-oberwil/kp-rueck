"""The screenshot fixture (app.seed_visual) puts nothing on the wall clock.

The visual regression tests (docs/VISUAL_TESTS.md) freeze the browser at VISUAL_NOW and
compare pixels; one timestamp from the seed run's own clock is one «vor 2141 h» on a
screenshot, and a suite that fails a different way every day.
"""

from datetime import timedelta

import pytest
from sqlalchemy import select, text

from app import models
from app.seed_visual import VISUAL_EVENT_NAME, VISUAL_NOW, seed_visual


@pytest.fixture(autouse=True)
def _passwords(monkeypatch):
    monkeypatch.setenv("ADMIN_SEED_PASSWORD", "visual-admin-password")
    monkeypatch.setenv("VIEWER_PASSWORD", "visual-viewer-password")


@pytest.mark.asyncio
async def test_every_timestamp_is_at_or_before_the_frozen_instant(db_session):
    event = await seed_visual(db_session)

    # The story starts 185 minutes back; frontend/tests/visual/visual.fixture.ts checks the same.
    assert event.name == VISUAL_EVENT_NAME
    assert event.created_at == VISUAL_NOW - timedelta(minutes=185)

    columns = (
        await db_session.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'"
            )
        )
    ).all()
    later = []
    for table, column in columns:
        count = (
            await db_session.execute(
                text(f'SELECT count(*) FROM "{table}" WHERE "{column}" > :now'),
                {"now": VISUAL_NOW},
            )
        ).scalar_one()
        if count:
            later.append(f"{table}.{column}")
    assert later == []

    incidents = (await db_session.execute(select(models.Incident))).scalars().all()
    assert len(incidents) > 15
    # Distinct creation times: nothing on screen orders by a tie.
    assert len({i.created_at for i in incidents}) == len(incidents)


@pytest.mark.asyncio
async def test_refuses_a_database_that_has_anything_in_it(db_session):
    await seed_visual(db_session)
    with pytest.raises(RuntimeError, match="EMPTY"):
        await seed_visual(db_session)


@pytest.mark.asyncio
async def test_refuses_production(db_session, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(RuntimeError, match="production"):
        await seed_visual(db_session)
