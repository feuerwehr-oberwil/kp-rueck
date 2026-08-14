"""Concurrency guards on the Ereignis lifecycle (`crud/events.py`).

Deleting an Ereignis is the most destructive thing this application does — the cascade takes
every incident under it, with its assignments, Rapporte, status transitions and notifications,
and there is no Undo. The `delete/event` audit entry is the only record that it happened, so
"exactly once" is the whole point of these tests.

Why these tests build their own sessions: the `db_session` and `client` fixtures hand out ONE
session on ONE connection inside an outer transaction that is rolled back afterwards. That
serialises everything by construction, so a test written on top of them can only ever make
two *sequential* calls — which the buggy code passes. These open independent sessions on the
shared test engine, commit for real, and therefore clean up after themselves.
"""

import asyncio
import itertools
from collections.abc import AsyncIterator, Callable, Coroutine
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.crud import events as events_crud
from app.models import AuditLog, Event, Incident

# The lock wait / task completion below is polled, never slept on, but a hung test must still
# fail rather than hang the suite.
TIMEOUT_SECONDS = 15.0


@pytest_asyncio.fixture
async def sessions(test_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Session factory whose sessions really commit, each on its own connection."""
    return async_sessionmaker(bind=test_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def make_event(
    sessions: async_sessionmaker[AsyncSession],
) -> AsyncIterator[Callable[..., Coroutine[Any, Any, UUID]]]:
    """Create throwaway Ereignisse that survive a commit, and remove them again afterwards.

    Everything here is created by the test itself in the test database; nothing pre-existing
    is ever archived or deleted. Cleanup covers the audit rows too, since those deliberately
    outlive the event they describe.
    """
    created: list[UUID] = []

    async def _make(*, archived: bool, incident_titles: tuple[str, ...] = ()) -> UUID:
        event_id = uuid4()
        async with sessions() as session:
            session.add(
                Event(
                    id=event_id,
                    name=f"Nebenläufigkeitstest {event_id.hex[:6]}",
                    training_flag=True,
                    archived_at=datetime.now(UTC) if archived else None,
                )
            )
            for title in incident_titles:
                session.add(
                    Incident(
                        id=uuid4(),
                        event_id=event_id,
                        title=title,
                        type="elementarereignis",
                        priority="medium",
                        status="incoming",
                    )
                )
            await session.commit()
        created.append(event_id)
        return event_id

    yield _make

    async with sessions() as session:
        await session.execute(delete(AuditLog).where(AuditLog.resource_id.in_(created)))
        await session.execute(delete(Event).where(Event.id.in_(created)))
        await session.commit()


async def _wait_until_blocked_or_done(engine: AsyncEngine, task: asyncio.Task[Any]) -> None:
    """Return once `task` is either waiting on a Postgres lock or finished.

    This is what makes the delete test deterministic instead of a sleep-and-hope. With the
    row lock in place the second caller parks on it, which shows up as an ungranted lock in
    this database; without it the second caller runs straight through to completion. Both
    outcomes are observable, so the barrier below releases at the right moment in either
    world — and the assertions, not the timing, decide the result.
    """
    ungranted = text(
        "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid "
        "WHERE NOT l.granted AND a.datname = current_database()"
    )
    async with engine.connect() as conn:
        while not task.done():
            if await conn.scalar(ungranted):
                return
            await conn.rollback()  # fresh view of the live lock state on the next poll
            await asyncio.sleep(0.02)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_concurrent_deletes_delete_once_and_audit_once(
    test_engine: AsyncEngine,
    sessions: async_sessionmaker[AsyncSession],
    make_event: Callable[..., Coroutine[Any, Any, UUID]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two genuinely overlapping DELETEs: one deletes, one 404s, one audit entry exists.

    The two calls are forced to overlap rather than merely started together. The first is
    held inside `delete_event` at the moment it has written the audit entry but not yet run
    the cascade — precisely the window the race lives in — while the second enters the same
    function. The barrier is released only once the second is observably blocked on the row
    lock (or has run to completion, which is what happens when there is no lock).

    Without the `SELECT … FOR UPDATE` this fails at the first assertion below: the second
    call sails past the exists-and-archived check, deletes the event and commits, and the
    first then writes a second `delete/event` audit entry and runs its cascade against a row
    that is already gone — matching nothing, reported only as a SQLAlchemy warning, so BOTH
    callers return success and the one destructive act is recorded twice.
    """
    event_id = await make_event(archived=True, incident_titles=("Wasser im Keller, Hauptstrasse 4",))

    inside_first_call = asyncio.Event()
    release = asyncio.Event()
    call_number = itertools.count()
    real_log_action = events_crud.log_action

    async def gated_log_action(*args: Any, **kwargs: Any) -> Any:
        entry = await real_log_action(*args, **kwargs)
        if next(call_number) == 0:
            inside_first_call.set()
            await release.wait()
        return entry

    monkeypatch.setattr(events_crud, "log_action", gated_log_action)

    async def delete_in_own_session() -> bool:
        async with sessions() as session:
            return await events_crud.delete_event(session, event_id)

    first = asyncio.create_task(delete_in_own_session())
    second: asyncio.Task[bool] | None = None
    try:
        await asyncio.wait_for(inside_first_call.wait(), timeout=TIMEOUT_SECONDS)
        second = asyncio.create_task(delete_in_own_session())
        await asyncio.wait_for(_wait_until_blocked_or_done(test_engine, second), timeout=TIMEOUT_SECONDS)
    finally:
        release.set()

    assert second is not None
    outcomes = await asyncio.wait_for(asyncio.gather(first, second, return_exceptions=True), timeout=TIMEOUT_SECONDS)

    failures = [outcome for outcome in outcomes if isinstance(outcome, BaseException)]
    assert not failures, f"a concurrent delete blew up instead of answering: {failures!r}"
    # One caller deleted it, the other truthfully reported it was not there.
    assert sorted(bool(outcome) for outcome in outcomes) == [False, True]

    async with sessions() as session:
        assert await session.get(Event, event_id) is None
        assert (
            await session.scalar(select(func.count()).select_from(Incident).where(Incident.event_id == event_id)) == 0
        )
        audit_entries = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.resource_type == "event",
                AuditLog.action_type == "delete",
                AuditLog.resource_id == event_id,
            )
        )
    assert audit_entries == 1, "the deletion of an Ereignis must be recorded exactly once"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_concurrent_archives_keep_one_timestamp(
    sessions: async_sessionmaker[AsyncSession],
    make_event: Callable[..., Coroutine[Any, Any, UUID]],
) -> None:
    """Six concurrent archives agree on a single `archived_at`.

    `archived_at` is when the Ereignis was closed; the archive list is sorted and read by it.
    Re-stamping it means every caller gets its own `datetime.now(UTC)` and the last committer
    wins, so the six results disagree with each other and with the row — which is what this
    asserts against.
    """
    event_id = await make_event(archived=False)

    async def archive_in_own_session() -> datetime | None:
        async with sessions() as session:
            event = await events_crud.archive_event(session, event_id)
            assert event is not None
            return event.archived_at

    stamps = await asyncio.wait_for(
        asyncio.gather(*(archive_in_own_session() for _ in range(6))), timeout=TIMEOUT_SECONDS
    )

    async with sessions() as session:
        stored = await session.scalar(select(Event.archived_at).where(Event.id == event_id))

    assert stored is not None
    assert set(stamps) == {stored}, f"concurrent archives disagreed on archived_at: {stamps!r} vs stored {stored!r}"
