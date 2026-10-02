"""The conditional stop reorder behind «Rückgängig» after a route optimisation.

Optimising a route saves at once and offers an undo. The undo restores the order the
route had before, but only if the route still has exactly the order the optimisation
produced: otherwise another device has reordered, added or removed a stop meanwhile and
restoring the old list would overwrite that newer disposition (or re-insert a stop
somebody took off). The check runs on the server under the Auftrag's row lock, in the
same transaction as the write, so there is no gap between "still the same?" and "write".

The overlap tests use independent sessions that commit for real (see
``test_divera_attach_race.py`` for the pattern): only a genuine second transaction shows
whether the lock is held.
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import schemas
from app.crud import groups as groups_crud
from app.models import AuditLog, Event, Incident, IncidentGroup, User


def _request() -> MagicMock:
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


async def _stop_order(db: AsyncSession, group_id: UUID) -> list[UUID]:
    rows = await db.scalars(
        select(Incident.id)
        .where(Incident.group_id == group_id, Incident.deleted_at.is_(None))
        .order_by(Incident.group_position.asc(), Incident.created_at.asc())
    )
    return list(rows)


@pytest_asyncio.fixture
async def route(db_session: AsyncSession):
    """An Auftrag with three stops A, B, C (in that order) — rolled back after the test."""
    user = User(id=uuid4(), username=f"undo-guard-{uuid4()}", password_hash="x", role="editor")
    event = Event(id=uuid4(), name="Undo guard", training_flag=False)
    db_session.add_all([user, event])
    await db_session.commit()
    group = await groups_crud.create_group(
        db_session, schemas.IncidentGroupCreate(name="Route", event_id=event.id), user, _request()
    )
    stops = []
    for title in ("A", "B", "C"):
        incident = Incident(
            id=uuid4(),
            title=title,
            type="elementarereignis",
            priority="medium",
            status="incoming",
            location_address=f"{title} Strasse 1",
            event_id=event.id,
            created_by=user.id,
        )
        db_session.add(incident)
        stops.append(incident)
    await db_session.commit()
    await groups_crud.add_stops_to_group(db_session, group.id, [s.id for s in stops], user, _request())
    return group, stops, user


class TestGuardedRestore:
    async def test_undo_applies_when_order_is_still_the_optimised_one(self, db_session, route):
        group, (a, b, c), _ = route
        before = [a.id, b.id, c.id]
        optimised = [c.id, a.id, b.id]
        await groups_crud.reorder_group_stops(db_session, group.id, optimised)

        await groups_crud.reorder_group_stops(db_session, group.id, before, expected_ids=optimised)

        assert await _stop_order(db_session, group.id) == before

    async def test_undo_refused_after_another_reorder(self, db_session, route):
        group, (a, b, c), _ = route
        optimised = [c.id, a.id, b.id]
        await groups_crud.reorder_group_stops(db_session, group.id, optimised)
        # Another device drags B to the front.
        newer = [b.id, c.id, a.id]
        await groups_crud.reorder_group_stops(db_session, group.id, newer)

        with pytest.raises(groups_crud.StopOrderConflictError):
            await groups_crud.reorder_group_stops(db_session, group.id, [a.id, b.id, c.id], expected_ids=optimised)

        assert await _stop_order(db_session, group.id) == newer

    async def test_undo_refused_after_a_stop_was_removed(self, db_session, route):
        group, (a, b, c), user = route
        optimised = [c.id, a.id, b.id]
        await groups_crud.reorder_group_stops(db_session, group.id, optimised)
        await groups_crud.remove_stop_from_group(db_session, group.id, a.id, user, _request())

        with pytest.raises(groups_crud.StopOrderConflictError):
            await groups_crud.reorder_group_stops(db_session, group.id, [a.id, b.id, c.id], expected_ids=optimised)

        # A stays off the route: the undo did not re-insert it.
        assert await _stop_order(db_session, group.id) == [c.id, b.id]

    async def test_undo_refused_after_a_stop_was_added(self, db_session, route):
        group, (a, b, c), user = route
        optimised = [c.id, a.id, b.id]
        await groups_crud.reorder_group_stops(db_session, group.id, optimised)
        extra = Incident(
            id=uuid4(),
            title="D",
            type="elementarereignis",
            priority="medium",
            status="incoming",
            location_address="D Strasse 1",
            event_id=a.event_id,
            created_by=user.id,
        )
        db_session.add(extra)
        await db_session.commit()
        await groups_crud.add_stops_to_group(db_session, group.id, [extra.id], user, _request())

        with pytest.raises(groups_crud.StopOrderConflictError):
            await groups_crud.reorder_group_stops(db_session, group.id, [a.id, b.id, c.id], expected_ids=optimised)

        assert await _stop_order(db_session, group.id) == [*optimised, extra.id]

    async def test_second_undo_has_no_effect(self, db_session, route):
        """A double click: the first undo wins, the second finds the order changed."""
        group, (a, b, c), _ = route
        before = [a.id, b.id, c.id]
        optimised = [c.id, a.id, b.id]
        await groups_crud.reorder_group_stops(db_session, group.id, optimised)

        await groups_crud.reorder_group_stops(db_session, group.id, before, expected_ids=optimised)
        with pytest.raises(groups_crud.StopOrderConflictError):
            await groups_crud.reorder_group_stops(db_session, group.id, before, expected_ids=optimised)

        assert await _stop_order(db_session, group.id) == before


class TestOverlap:
    """Real, committed transactions on separate connections."""

    @pytest_asyncio.fixture
    async def committed_route(self, test_engine):
        sessions = async_sessionmaker(test_engine, expire_on_commit=False)
        user_id, event_id = uuid4(), uuid4()
        async with sessions() as db:
            prior_audit_ids = set(await db.scalars(select(AuditLog.id)))
            db.add_all(
                [
                    User(id=user_id, username=f"undo-overlap-{user_id}", password_hash=None, role="editor"),
                    Event(id=event_id, name="Undo overlap", training_flag=False, created_at=datetime.now(UTC)),
                ]
            )
            await db.commit()
            user = await db.get(User, user_id)
            group = await groups_crud.create_group(
                db, schemas.IncidentGroupCreate(name="Route", event_id=event_id), user, _request()
            )
            ids = []
            for title in ("A", "B", "C"):
                incident = Incident(
                    id=uuid4(),
                    title=title,
                    type="elementarereignis",
                    priority="medium",
                    status="incoming",
                    location_address=f"{title} Strasse 1",
                    event_id=event_id,
                    created_by=user_id,
                )
                db.add(incident)
                ids.append(incident.id)
            await db.commit()
            await groups_crud.add_stops_to_group(db, group.id, ids, user, _request())
            # The optimisation result the undo will guard against.
            await groups_crud.reorder_group_stops(db, group.id, [ids[2], ids[0], ids[1]])
        try:
            yield sessions, group.id, ids, user_id
        finally:
            async with sessions() as db:
                await db.execute(delete(Incident).where(Incident.event_id == event_id))
                await db.execute(delete(IncidentGroup).where(IncidentGroup.event_id == event_id))
                await db.execute(delete(AuditLog).where(AuditLog.id.not_in(prior_audit_ids)))
                await db.execute(delete(Event).where(Event.id == event_id))
                await db.execute(delete(User).where(User.id == user_id))
                await db.commit()

    async def test_undo_waits_for_an_in_flight_change_and_then_refuses(self, committed_route):
        sessions, group_id, (a, b, c), _ = committed_route
        optimised = [c, a, b]

        async with sessions() as other, sessions() as undo:
            # Another device is mid-way through taking stop A off the route: it holds
            # the Auftrag lock and has written, but not yet committed.
            await other.execute(select(IncidentGroup.id).where(IncidentGroup.id == group_id).with_for_update())
            stop_a = await other.get(Incident, a)
            stop_a.group_id = None
            await other.flush()

            restore = asyncio.create_task(
                groups_crud.reorder_group_stops(undo, group_id, [a, b, c], expected_ids=optimised)
            )
            await asyncio.sleep(0.3)
            assert not restore.done(), "the guarded restore must wait for the Auftrag lock"

            await other.commit()
            with pytest.raises(groups_crud.StopOrderConflictError):
                await asyncio.wait_for(restore, timeout=10)
            await undo.rollback()

        async with sessions() as db:
            assert await _stop_order(db, group_id) == [c, b]

    async def test_remove_stop_queues_behind_the_auftrag_lock(self, committed_route):
        """Removing a stop takes the same lock, so it cannot slip into a restore."""
        sessions, group_id, (a, _b, _c), user_id = committed_route

        async with sessions() as holder, sessions() as remover:
            await holder.execute(select(IncidentGroup.id).where(IncidentGroup.id == group_id).with_for_update())
            user = await remover.get(User, user_id)
            removal = asyncio.create_task(groups_crud.remove_stop_from_group(remover, group_id, a, user, _request()))
            await asyncio.sleep(0.3)
            assert not removal.done(), "remove_stop_from_group must take the Auftrag lock"
            await holder.rollback()
            assert await asyncio.wait_for(removal, timeout=10) is True
