"""The guest door under real concurrency (Sol review of phone sweep 24.11.2026, 7A).

On SEPARATE connections, like `test_print_claim_race.py`: the shared `db_session` is one
connection, so a `gather` over it serialises and proves nothing. Each call runs the link check
and the CRUD the route runs, then commits like `commit_request`.
"""

import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.crud import personnel_checkin as crud
from app.models import AuditLog, Event, EventAttendance, Personnel
from app.services import share_links
from app.services.tokens import generate_checkin_token


async def _guest(engine: AsyncEngine, token: str, name: str) -> UUID:
    async with AsyncSession(bind=engine, expire_on_commit=False) as session:
        event_id = await share_links.event_of(session, "checkin", token, lock=True)
        assert event_id is not None
        person, _created = await crud.check_in_guest(session, event_id=event_id, name=name)
        await session.commit()
        return person.id


async def _tablet(engine: AsyncEngine, event_id: UUID, personnel_id: UUID) -> None:
    async with AsyncSession(bind=engine, expire_on_commit=False) as session:
        assert await crud.check_in_personnel(session, event_id=event_id, personnel_id=personnel_id)
        await session.commit()


@pytest.mark.asyncio
async def test_a_crowd_typing_one_new_name_makes_one_guest_and_a_roster_name_one_attendance(test_engine):
    event_id, roster_id = uuid4(), uuid4()
    async with AsyncSession(bind=test_engine, expire_on_commit=False) as setup:
        setup.add(Event(id=event_id, name="Sturm", training_flag=False))
        await setup.flush()
        setup.add(Personnel(id=roster_id, name="Baumann Michael", status="available"))
        await setup.commit()
    token = generate_checkin_token(event_id)

    try:
        ids = await asyncio.gather(*(_guest(test_engine, token, "Gast Peter") for _ in range(5)))
        assert len(set(ids)) == 1, f"one name, one guest – got {len(set(ids))}"

        # The door and the tablet checking in the same roster person at once: no unique-
        # constraint 500, one attendance row.
        await asyncio.gather(
            _guest(test_engine, token, "Baumann Michael"),
            _tablet(test_engine, event_id, roster_id),
            _guest(test_engine, token, "baumann michael"),
            _tablet(test_engine, event_id, roster_id),
        )

        async with AsyncSession(bind=test_engine) as check:
            guests = await check.scalar(select(func.count()).where(Personnel.guest_event_id == event_id))
            rows = await check.scalar(
                select(func.count()).where(
                    EventAttendance.event_id == event_id, EventAttendance.personnel_id == roster_id
                )
            )
            assert (guests, rows) == (1, 1)
    finally:
        async with AsyncSession(bind=test_engine) as cleanup:
            ids_of_event = select(Personnel.id).where(Personnel.guest_event_id == event_id)
            await cleanup.execute(
                delete(AuditLog).where(AuditLog.resource_id.in_([roster_id, *(await cleanup.scalars(ids_of_event))]))
            )
            await cleanup.execute(delete(EventAttendance).where(EventAttendance.event_id == event_id))
            await cleanup.execute(delete(Personnel).where(Personnel.guest_event_id == event_id))
            await cleanup.execute(delete(Personnel).where(Personnel.id == roster_id))
            await cleanup.execute(delete(Event).where(Event.id == event_id))
            await cleanup.commit()


@pytest.mark.asyncio
async def test_a_revoke_waits_for_a_write_in_flight_and_the_next_one_is_refused(test_engine):
    event_id = uuid4()
    async with AsyncSession(bind=test_engine, expire_on_commit=False) as setup:
        setup.add(Event(id=event_id, name="Sturm", training_flag=False))
        await setup.commit()
    token = generate_checkin_token(event_id)

    try:
        async with AsyncSession(bind=test_engine, expire_on_commit=False) as door:
            assert await share_links.event_of(door, "checkin", token, lock=True) == event_id

            async def revoke() -> None:
                async with AsyncSession(bind=test_engine) as board:
                    assert await share_links.revoke(board, "checkin", event_id)
                    await board.commit()

            revoking = asyncio.create_task(revoke())
            await asyncio.sleep(0.3)
            assert not revoking.done(), "the revoke must wait for the write that already passed the check"
            await crud.check_in_guest(door, event_id=event_id, name="Gast Peter")
            await door.commit()
            await asyncio.wait_for(revoking, timeout=5)

        async with AsyncSession(bind=test_engine) as later:
            assert await share_links.event_of(later, "checkin", token, lock=True) is None
    finally:
        async with AsyncSession(bind=test_engine) as cleanup:
            guest_ids = list(await cleanup.scalars(select(Personnel.id).where(Personnel.guest_event_id == event_id)))
            await cleanup.execute(delete(AuditLog).where(AuditLog.resource_id.in_(guest_ids)))
            await cleanup.execute(delete(EventAttendance).where(EventAttendance.event_id == event_id))
            await cleanup.execute(delete(Personnel).where(Personnel.guest_event_id == event_id))
            await cleanup.execute(delete(Event).where(Event.id == event_id))
            await cleanup.commit()
