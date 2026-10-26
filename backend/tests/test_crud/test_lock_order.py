"""The lock order of ``crud/locking.py``, checked with real overlapping transactions.

Auftrag before incident before resource: completing a stop used to lock the stop and
then its Auftrag while a reorder locked them the other way round (audit 2026-10, F08),
and an archive did not lock the resource an assignment was being written for (F02).
Independent, committed sessions (pattern from ``test_group_stop_undo_guard.py``) –
only a genuine second transaction shows who waits for whom.
"""

import asyncio
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.crud import group_assignments as group_assignments_crud
from app.crud import groups as groups_crud
from app.crud import incidents as incidents_crud
from app.crud import materials as materials_crud
from app.crud.locking import lock_incident_with_group
from app.models import AuditLog, Event, Incident, IncidentGroup, IncidentGroupAssignment, Material, User


def _request() -> MagicMock:
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


@dataclass
class Board:
    sessions: async_sessionmaker[AsyncSession]
    user_id: UUID
    group_id: UUID
    stop_id: UUID
    loose_id: UUID
    material_id: UUID


async def _wait_until_blocked(sessions: async_sessionmaker[AsyncSession]) -> None:
    """Until some other backend waits on a row lock – i.e. the task under test is queued."""
    async with sessions() as probe:
        for _ in range(100):
            waiting = await probe.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"
                    " AND pid <> pg_backend_pid()"
                )
            )
            if waiting:
                return
            await asyncio.sleep(0.05)
    raise AssertionError("nothing ever waited for a lock")


@pytest_asyncio.fixture
async def board(test_engine: AsyncEngine) -> AsyncGenerator[Board]:
    """One Auftrag with one stop, an ungrouped incident and a material – committed for real."""
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id, event_id, group_id, stop_id, loose_id, material_id = (uuid4() for _ in range(6))
    async with sessions() as db:
        prior_audit_ids = set(await db.scalars(select(AuditLog.id)))
        db.add_all(
            [
                User(id=user_id, username=f"lock-order-{user_id}", password_hash=None, role="editor"),
                Event(id=event_id, name="Lock order", training_flag=False, created_at=datetime.now(UTC)),
                Material(id=material_id, name="Pumpe", type="Pumpe", location="Depot", status="available"),
            ]
        )
        await db.flush()
        db.add(IncidentGroup(id=group_id, event_id=event_id, name="Route"))
        await db.flush()
        for incident_id, grouped in ((stop_id, True), (loose_id, False)):
            db.add(
                Incident(
                    id=incident_id,
                    title="Stopp" if grouped else "Lose",
                    type="elementarereignis",
                    priority="medium",
                    status="active",
                    event_id=event_id,
                    created_by=user_id,
                    group_id=group_id if grouped else None,
                    group_position=0 if grouped else None,
                )
            )
        await db.commit()
    try:
        yield Board(sessions, user_id, group_id, stop_id, loose_id, material_id)
    finally:
        async with sessions() as db:
            await db.execute(delete(IncidentGroupAssignment).where(IncidentGroupAssignment.resource_id == material_id))
            await db.execute(delete(Incident).where(Incident.event_id == event_id))
            await db.execute(delete(IncidentGroup).where(IncidentGroup.event_id == event_id))
            await db.execute(delete(Material).where(Material.id == material_id))
            await db.execute(delete(AuditLog).where(AuditLog.id.not_in(prior_audit_ids)))
            await db.execute(delete(Event).where(Event.id == event_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()


async def test_completing_a_stop_queues_behind_a_reorder_instead_of_deadlocking(board: Board):
    async with board.sessions() as reorder, board.sessions() as completion:
        # A reorder is under way: it holds the Auftrag and is about to write the stop.
        await reorder.execute(select(IncidentGroup.id).where(IncidentGroup.id == board.group_id).with_for_update())
        user = await completion.get(User, board.user_id)
        completing = asyncio.create_task(
            incidents_crud.update_incident_status(completion, board.stop_id, "complete", user, _request())
        )
        await _wait_until_blocked(board.sessions)

        # Completion must be waiting for the Auftrag, not sitting on the stop.
        await asyncio.wait_for(groups_crud.reorder_group_stops(reorder, board.group_id, [board.stop_id]), timeout=5)
        await reorder.commit()

        completed = await asyncio.wait_for(completing, timeout=10)
        await completion.commit()

    assert completed is not None
    assert completed.status == "complete"


async def test_a_stop_that_joins_an_auftrag_meanwhile_gets_that_auftrag_locked(board: Board):
    async with board.sessions() as mover, board.sessions() as locker, board.sessions() as probe:
        # Another request attaches the loose incident to the route and has not committed yet.
        await mover.execute(select(IncidentGroup.id).where(IncidentGroup.id == board.group_id).with_for_update())
        loose = await mover.get(Incident, board.loose_id)
        assert loose is not None
        loose.group_id, loose.group_position = board.group_id, 1
        await mover.flush()

        # Reads "no Auftrag", then queues for the incident behind the mover.
        locking = asyncio.create_task(lock_incident_with_group(locker, board.loose_id))
        await _wait_until_blocked(board.sessions)
        await mover.commit()
        locked = await asyncio.wait_for(locking, timeout=10)

        assert locked is not None
        assert locked.group_id == board.group_id
        # It started over and now holds the Auftrag it found the stop in.
        held = await probe.execute(
            text("SELECT 1 FROM incident_groups WHERE id = :id FOR UPDATE SKIP LOCKED"), {"id": board.group_id}
        )
        assert held.first() is None
        await locker.rollback()


async def test_archive_waits_for_an_inflight_auftrag_assignment_and_refuses(board: Board):
    async with board.sessions() as assigning, board.sessions() as archiving:
        user = await assigning.get(User, board.user_id)
        assert user is not None
        await group_assignments_crud.assign_group_resource(
            assigning, board.group_id, "material", board.material_id, user, _request()
        )

        archive_user = await archiving.get(User, board.user_id)
        assert archive_user is not None
        archive = asyncio.create_task(
            materials_crud.archive_material(archiving, board.material_id, archive_user, _request())
        )
        await _wait_until_blocked(board.sessions)
        await assigning.commit()

        outcome = await asyncio.wait_for(archive, timeout=10)
        await archiving.rollback()

    assert isinstance(outcome, materials_crud.ArchiveRefused)
    assert outcome.active_incidents == 1
