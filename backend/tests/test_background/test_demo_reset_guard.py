"""The demo reset must refuse to destroy a database that is not demonstrably disposable.

`scheduled_demo_reset` truncates every table and deletes every photo. Before 2026-07 its
only gate was the caller: `main.py` starts the scheduler when DEMO_MODE is set, and the
function itself checked nothing. The documented force-reseed one-liner imports and awaits
it directly, so it walked past that gate — and its victim was whatever DATABASE_URL named.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.background.demo_reset import (
    NotADisposableDatabaseError,
    assert_disposable_database,
    scheduled_demo_reset,
)
from app.models import Personnel, Setting
from app.services.settings import DISPOSABLE_MARKER_KEY, DISPOSABLE_MARKER_VALUE


class _EngineBoundToTestTransaction:
    """Stands in for `app.database.engine` so the guard sees the test's uncommitted rows.

    The tests run inside a transaction that is rolled back afterwards, so a connection
    opened from the real engine would see an empty database and wave everything through.
    """

    def __init__(self, conn: AsyncConnection) -> None:
        self._conn = conn

    @asynccontextmanager
    async def begin(self):
        yield self._conn


@pytest.mark.asyncio
async def test_refuses_when_demo_mode_is_not_set(db_session: AsyncSession):
    """The cheap check: a process that is not a demo deployment never truncates."""
    with (
        patch("app.background.demo_reset.settings.demo_mode", False),
        pytest.raises(NotADisposableDatabaseError, match="DEMO_MODE"),
    ):
        await assert_disposable_database(await db_session.connection())


@pytest.mark.asyncio
async def test_refuses_a_populated_database_without_the_marker(db_session: AsyncSession):
    """The check that matters: real data + no marker = refuse, even in demo mode.

    This is the mispointed-DATABASE_URL case — a demo deployment aimed at a station's
    database, or a demo .env copied onto a station.
    """
    db_session.add(Personnel(name="Müller Hans", role="Offizier", status="available"))
    await db_session.commit()

    with (
        patch("app.background.demo_reset.settings.demo_mode", True),
        pytest.raises(NotADisposableDatabaseError, match="carries no"),
    ):
        await assert_disposable_database(await db_session.connection())


@pytest.mark.asyncio
async def test_allows_a_database_carrying_the_marker(db_session: AsyncSession):
    """A real demo database is seeded with the marker and proceeds normally."""
    db_session.add(Personnel(name="Demo Person", role="Mannschaft", status="available"))
    db_session.add(Setting(key=DISPOSABLE_MARKER_KEY, value=DISPOSABLE_MARKER_VALUE))
    await db_session.commit()

    with patch("app.background.demo_reset.settings.demo_mode", True):
        await assert_disposable_database(await db_session.connection())  # does not raise


@pytest.mark.asyncio
async def test_allows_an_empty_database_to_bootstrap(db_session: AsyncSession):
    """A fresh demo has no marker yet and nothing to lose."""
    with patch("app.background.demo_reset.settings.demo_mode", True):
        await assert_disposable_database(await db_session.connection())  # does not raise


@pytest.mark.asyncio
async def test_scheduled_reset_refuses_before_touching_anything(db_session: AsyncSession):
    """The guard runs in `scheduled_demo_reset` itself, not only in its callee.

    Importing and awaiting this function is exactly what the force-reseed recipe does.
    """
    db_session.add(Personnel(name="Müller Hans", role="Offizier", status="available"))
    await db_session.commit()

    with (
        patch("app.background.demo_reset.settings.demo_mode", True),
        patch("app.background.demo_reset.engine", _EngineBoundToTestTransaction(await db_session.connection())),
        patch("app.background.demo_reset._truncate_all_tables", new_callable=AsyncMock) as truncate,
        patch("app.background.demo_reset._clear_photos") as clear_photos,
        pytest.raises(NotADisposableDatabaseError),
    ):
        await scheduled_demo_reset()

    truncate.assert_not_awaited()
    clear_photos.assert_not_called()


@pytest.mark.asyncio
async def test_refusal_is_not_swallowed_as_a_generic_failure(db_session: AsyncSession):
    """`scheduled_demo_reset` catches Exception broadly and logs "Demo reset failed".

    A refusal must not disappear into that path: "we declined to destroy your data" and
    "the reset hit a snag" are different events and only one of them is routine.
    """
    db_session.add(Personnel(name="Müller Hans", role="Offizier", status="available"))
    await db_session.commit()

    with (
        patch("app.background.demo_reset.settings.demo_mode", True),
        patch("app.background.demo_reset.engine", _EngineBoundToTestTransaction(await db_session.connection())),
        patch("app.background.demo_reset._truncate_all_tables", new_callable=AsyncMock),
        pytest.raises(NotADisposableDatabaseError),
    ):
        await scheduled_demo_reset()
