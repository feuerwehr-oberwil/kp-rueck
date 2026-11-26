"""A Reko person's order: `POST /api/reko/personnel/{id}/order` (feedback 19.11.2026, #19).

The Reko-Modus on the map lets the KP put one Reko person's Rekos in order, the way an
Auftrag's stops are ordered. New Rekos join at the end, the drag is guarded by
`expected_ids` (409 when the list changed meanwhile), the write holds the person's row
lock, and /feld lists the Rekos in that order.
"""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.crud import reko_assignment as reko_crud
from app.crud.manual_order import OrderChangedError
from app.models import Event, EventSpecialFunction, Incident, IncidentAssignment, Personnel, User
from tests.conftest import feld_device_token, wait_until_blocked

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


def _incident(event: Event, user: User, title: str, position: int) -> Incident:
    return Incident(
        id=uuid.uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        status="incoming",
        location_address=f"{title} 1",
        event_id=event.id,
        created_by=user.id,
        position=position,
    )


@pytest_asyncio.fixture
async def reko_person(db_session: AsyncSession, test_event: Event) -> Personnel:
    """A person holding the Reko function in the test Ereignis."""
    person = Personnel(id=uuid.uuid4(), name="Keller Marco", role="Offizier", status="available")
    db_session.add(person)
    await db_session.commit()
    db_session.add(EventSpecialFunction(event_id=test_event.id, personnel_id=person.id, function_type="reko"))
    await db_session.commit()
    return person


@pytest_asyncio.fixture
async def three_rekos(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User, reko_person: Personnel
) -> list[uuid.UUID]:
    """Bahnhof, Haupt, Allschwiler – assigned to the Reko person through the board, in that order.

    Their kanban positions run the other way round, so an order that follows them would show.
    """
    incidents = [
        _incident(test_event, test_user, title, position)
        for title, position in (("Bahnhof", 2), ("Haupt", 1), ("Allschwiler", 0))
    ]
    db_session.add_all(incidents)
    await db_session.commit()
    for incident in incidents:
        response = await editor_client.post(
            f"/api/reko/incidents/{incident.id}/assign-reko", json={"personnel_id": str(reko_person.id)}
        )
        assert response.status_code == 201, response.text
    return [incident.id for incident in incidents]


async def _order(db: AsyncSession, event_id: uuid.UUID, person_id: uuid.UUID) -> list[uuid.UUID]:
    return [row.incident_id for row in await reko_crud.person_reko_rows(db, event_id, person_id)]


async def test_new_rekos_join_the_end_and_a_drag_reorders_them(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, reko_person: Personnel, three_rekos
):
    bahnhof, haupt, allschwiler = three_rekos
    assert await _order(db_session, test_event.id, reko_person.id) == three_rekos
    # The board reads the number off its assignment rows.
    rows = (await editor_client.get(f"/api/assignments/by-event/{test_event.id}")).json()
    assert [rows[str(i)][0]["reko_position"] for i in three_rekos] == [0, 1, 2]

    response = await editor_client.post(
        f"/api/reko/personnel/{reko_person.id}/order",
        json={
            "event_id": str(test_event.id),
            "ordered_ids": [str(bahnhof), str(allschwiler), str(haupt)],
            "expected_ids": [str(i) for i in three_rekos],
        },
    )

    assert response.status_code == 204, response.text
    assert await _order(db_session, test_event.id, reko_person.id) == [bahnhof, allschwiler, haupt]


async def test_an_unnumbered_reko_keeps_its_place_before_a_new_one(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_user: User,
    reko_person: Personnel,
):
    # A row from before the order existed (or a crew row of somebody made Reko later).
    old, new = _incident(test_event, test_user, "Alt", 0), _incident(test_event, test_user, "Neu", 1)
    db_session.add_all([old, new])
    await db_session.flush()
    db_session.add(IncidentAssignment(incident_id=old.id, resource_type="personnel", resource_id=reko_person.id))
    await db_session.commit()

    response = await editor_client.post(
        f"/api/reko/incidents/{new.id}/assign-reko", json={"personnel_id": str(reko_person.id)}
    )

    assert response.status_code == 201
    assert await _order(db_session, test_event.id, reko_person.id) == [old.id, new.id]


async def test_a_list_that_changed_meanwhile_is_409_and_keeps_its_order(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_user: User,
    reko_person: Personnel,
    three_rekos,
):
    # Another desk hands the person a fourth Reko after this one read the list.
    extra = _incident(test_event, test_user, "Neu", 3)
    db_session.add(extra)
    await db_session.commit()
    assigned = await editor_client.post(
        f"/api/reko/incidents/{extra.id}/assign-reko", json={"personnel_id": str(reko_person.id)}
    )
    assert assigned.status_code == 201

    response = await editor_client.post(
        f"/api/reko/personnel/{reko_person.id}/order",
        json={
            "event_id": str(test_event.id),
            "ordered_ids": [str(i) for i in reversed(three_rekos)],
            "expected_ids": [str(i) for i in three_rekos],
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Reko-Reihenfolge wurde inzwischen geändert"
    assert await _order(db_session, test_event.id, reko_person.id) == [*three_rekos, extra.id]


async def test_somebody_without_the_reko_function_is_404(
    editor_client: AsyncClient, test_event: Event, test_personnel: Personnel
):
    response = await editor_client.post(
        f"/api/reko/personnel/{test_personnel.id}/order",
        json={"event_id": str(test_event.id), "ordered_ids": [str(uuid.uuid4())]},
    )
    assert response.status_code == 404


async def test_feld_lists_the_rekos_in_that_order(
    editor_client: AsyncClient,
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    reko_person: Personnel,
    three_rekos,
):
    bahnhof, haupt, allschwiler = three_rekos
    new_order = [haupt, bahnhof, allschwiler]
    response = await editor_client.post(
        f"/api/reko/personnel/{reko_person.id}/order",
        json={"event_id": str(test_event.id), "ordered_ids": [str(i) for i in new_order]},
    )
    assert response.status_code == 204

    token = await feld_device_token(db_session, test_event.id, reko_person.id)
    feed = await client.get(f"/api/feld/assignments/{reko_person.id}?token={token}")

    assert feed.status_code == 200, feed.text
    assert [row["incident_id"] for row in feed.json()["assignments"]] == [str(i) for i in new_order]


class TestPersonLock:
    """Real, committed transactions on separate connections."""

    @pytest_asyncio.fixture
    async def committed_rekos(self, test_engine):
        sessions = async_sessionmaker(test_engine, expire_on_commit=False)
        user_id, event_id, person_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        ids = [uuid.uuid4(), uuid.uuid4()]
        async with sessions() as db:
            db.add_all(
                [
                    User(id=user_id, username=f"reko-order-{user_id}", password_hash=None, role="editor"),
                    Event(id=event_id, name="Reko order", training_flag=False, created_at=datetime.now(UTC)),
                    Personnel(id=person_id, name="Brunner Sarah", status="available"),
                ]
            )
            await db.flush()
            db.add(EventSpecialFunction(event_id=event_id, personnel_id=person_id, function_type="reko"))
            for position, incident_id in enumerate(ids):
                db.add(
                    Incident(
                        id=incident_id,
                        title=f"R{position}",
                        type="elementarereignis",
                        priority="medium",
                        status="reko",
                        event_id=event_id,
                        created_by=user_id,
                    )
                )
            await db.flush()
            for position, incident_id in enumerate(ids):
                db.add(
                    IncidentAssignment(
                        incident_id=incident_id,
                        resource_type="personnel",
                        resource_id=person_id,
                        purpose="reko",
                        reko_position=position,
                    )
                )
            await db.commit()
        try:
            yield sessions, event_id, person_id, ids
        finally:
            async with sessions() as db:
                await db.execute(delete(Incident).where(Incident.event_id == event_id))
                await db.execute(delete(EventSpecialFunction).where(EventSpecialFunction.event_id == event_id))
                await db.execute(delete(Event).where(Event.id == event_id))
                await db.execute(delete(Personnel).where(Personnel.id == person_id))
                await db.execute(delete(User).where(User.id == user_id))
                await db.commit()

    async def test_reorder_waits_for_the_person_row_and_then_sees_the_new_reko(self, committed_rekos):
        sessions, event_id, person_id, (first, second) = committed_rekos

        async with sessions() as assigner, sessions() as reorderer:
            # Another desk is mid-way through assigning a third Reko: it holds the person's
            # row lock (as `lock_for_new_assignment` does) and has written, not committed.
            await assigner.execute(select(Personnel.id).where(Personnel.id == person_id).with_for_update())
            third = Incident(title="R2", type="elementarereignis", priority="medium", status="reko", event_id=event_id)
            assigner.add(third)
            await assigner.flush()
            assigner.add(
                IncidentAssignment(
                    incident_id=third.id,
                    resource_type="personnel",
                    resource_id=person_id,
                    purpose="reko",
                    reko_position=await reko_crud.next_reko_position(assigner, event_id, person_id),
                )
            )
            await assigner.flush()

            reorder = asyncio.create_task(
                reko_crud.reorder_reko_assignments(
                    reorderer, event_id, person_id, [second, first], expected_ids=[first, second]
                )
            )
            await wait_until_blocked(sessions)  # the reorder waits for the person's row lock

            await assigner.commit()
            with pytest.raises(OrderChangedError):
                await asyncio.wait_for(reorder, timeout=10)
            await reorderer.rollback()

        async with sessions() as db:
            assert await _order(db, event_id, person_id) == [first, second, third.id]
