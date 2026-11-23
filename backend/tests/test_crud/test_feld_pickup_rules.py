"""The Abholung rules of the owner round 23.11.2026 (#1, #7, #10).

* A vehicle on site (not «kehrt zurück») only suggests «Wir fahren selbst»: «Abholung
  nötig» is still accepted, because the KP may have forgotten the pill.
* «Wir fahren selbst» is always written down, with the crew member's name.
* Closing an open Abholung while a vehicle is with the crew moves the card to Rückfahrt.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import feld as crud
from app.models import (
    AuditLog,
    Event,
    FieldRequest,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    JournalEntry,
    Personnel,
    StatusTransition,
    User,
    Vehicle,
)

pytestmark = pytest.mark.asyncio


async def _incident(db: AsyncSession, event: Event, user: User, status: str = "active") -> Incident:
    incident = Incident(
        id=uuid.uuid4(),
        title="Keller Wasser",
        type="elementarereignis",
        priority="medium",
        location_address="Keller Wasser 1, Oberwil",
        status=status,
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _crew(db: AsyncSession) -> crud.FieldActor:
    person = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    return crud.FieldActor(personnel_id=person.id, personnel_name=person.name)


async def _vehicle(db: AsyncSession, incident: Incident, *, stays: bool) -> Vehicle:
    vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available")
    db.add(vehicle)
    await db.flush()
    db.add(
        IncidentAssignment(incident_id=incident.id, resource_type="vehicle", resource_id=vehicle.id, driver_stay=stays)
    )
    await db.commit()
    return vehicle


async def test_pickup_is_accepted_while_a_vehicle_stays_on_site(
    db_session: AsyncSession, test_event: Event, test_user: User
):
    # The pill can be wrong (the KP forgot «kehrt zurück»): the crew's answer wins.
    incident = await _incident(db_session, test_event, test_user)
    await _vehicle(db_session, incident, stays=True)

    assert await crud.record_pickup(db_session, incident, actor=await _crew(db_session), needed=True)
    assert incident.pickup_needed


async def test_an_auftrag_vehicle_counts_as_on_site(db_session: AsyncSession, test_event: Event, test_user: User):
    group = IncidentGroup(id=uuid.uuid4(), event_id=test_event.id, name="Sturmholz Nord")
    vehicle = Vehicle(id=uuid.uuid4(), name="Pio", type="Pio", status="available")
    db_session.add_all([group, vehicle])
    await db_session.commit()
    incident = await _incident(db_session, test_event, test_user)
    incident.group_id = group.id
    db_session.add(IncidentGroupAssignment(incident_group_id=group.id, resource_type="vehicle", resource_id=vehicle.id))
    await db_session.commit()

    assert await crud.vehicle_on_site(db_session, incident) == "Pio"


async def test_self_drive_without_an_open_pickup_is_still_written_down(
    db_session: AsyncSession, test_event: Event, test_user: User
):
    incident = await _incident(db_session, test_event, test_user)
    actor = await _crew(db_session)

    # Nothing to close – the state stays, the crew's answer is kept anyway.
    assert not await crud.record_pickup(db_session, incident, actor=actor, needed=False)
    await db_session.commit()

    audit = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.resource_id == incident.id, AuditLog.action_type == "field_pickup_cleared")
        )
    ).scalar_one()
    assert audit.changes_json["personnel_name"] == "Muster Hans"
    assert audit.changes_json["self_drive"] is True
    line = (
        await db_session.execute(
            select(JournalEntry).where(JournalEntry.incident_id == incident.id, JournalEntry.kind == "field")
        )
    ).scalar_one()
    assert line.data["type"] == "field_pickup_self"
    assert line.author_name == "Muster Hans"


async def test_self_drive_closes_the_request_as_the_crews_answer(
    db_session: AsyncSession, test_event: Event, test_user: User
):
    incident = await _incident(db_session, test_event, test_user)
    actor = await _crew(db_session)
    await crud.record_pickup(db_session, incident, actor=actor, needed=True)
    await db_session.commit()

    await crud.record_pickup(db_session, incident, actor=actor, needed=False)
    await db_session.commit()

    row = (await db_session.execute(select(FieldRequest).where(FieldRequest.incident_id == incident.id))).scalar_one()
    assert row.status == "done" and row.done_by_name == "Muster Hans"
    assert row.done_in_field


async def test_pickup_disponiert_with_a_vehicle_moves_the_card_to_rueckfahrt(
    db_session: AsyncSession, test_event: Event, test_user: User
):
    incident = await _incident(db_session, test_event, test_user, status="active")
    await crud.record_pickup(db_session, incident, actor=await _crew(db_session), needed=True)
    await db_session.commit()
    await _vehicle(db_session, incident, stays=False)

    await crud.record_pickup(db_session, incident, actor=crud.FieldActor(user=test_user), needed=False)
    await db_session.commit()

    await db_session.refresh(incident)
    assert incident.status == "returning"
    move = (
        await db_session.execute(select(StatusTransition).where(StatusTransition.incident_id == incident.id))
    ).scalar_one()
    assert (move.from_status, move.to_status, move.user_id) == ("active", "returning", test_user.id)
    assert "Abholung disponiert (TLF 1)" in (move.notes or "")
    # the KP's answer, not the crew's
    row = (await db_session.execute(select(FieldRequest).where(FieldRequest.incident_id == incident.id))).scalar_one()
    assert not row.done_in_field


async def test_pickup_disponiert_without_a_vehicle_leaves_the_status(
    db_session: AsyncSession, test_event: Event, test_user: User
):
    incident = await _incident(db_session, test_event, test_user, status="active")
    await crud.record_pickup(db_session, incident, actor=await _crew(db_session), needed=True)
    await db_session.commit()

    await crud.record_pickup(db_session, incident, actor=crud.FieldActor(user=test_user), needed=False)
    await db_session.commit()

    await db_session.refresh(incident)
    assert incident.status == "active"
