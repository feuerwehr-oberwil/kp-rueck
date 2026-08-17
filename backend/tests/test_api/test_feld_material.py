"""The Magazin's own view: every unit, and where it is right now.

Every other read on the `/feld` door is "only what is yours". This one is
deliberately the whole inventory, because a Materialwart who can only see the
units hanging off their own Schadenplätze cannot answer the question they are
actually asked at 02:00 — *wo ist die zweite Tauchpumpe?* The list of
Schadenplätze they used to get answers the wrong question entirely.

So the gate moves from the assignment to the **role**, and that is what most of
this file is about: holding `magazin` in this Ereignis is the whole permission,
and nobody else may read it.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    User,
)
from tests.conftest import feld_device_token


async def _person(db: AsyncSession, name: str = "Frei Andrea") -> Personnel:
    person = Personnel(id=uuid.uuid4(), name=name, role="Materialwart", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _material(db: AsyncSession, name: str, location: str = "Magazin") -> Material:
    material = Material(id=uuid.uuid4(), name=name, type="Sonstiges", location=location, status="available")
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return material


async def _incident(db: AsyncSession, event: Event, user: User, address: str) -> Incident:
    incident = Incident(
        id=uuid.uuid4(),
        title=address,
        type="elementarereignis",
        priority="medium",
        location_address=address,
        status="active",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _magazin(db: AsyncSession, event: Event, person: Personnel) -> None:
    db.add(EventSpecialFunction(event_id=event.id, personnel_id=person.id, function_type="magazin"))
    await db.commit()


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_list_says_where_each_unit_is(
    client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    person = await _person(db_session)
    await _magazin(db_session, test_event, person)
    out = await _material(db_session, "Tauchpumpe 1", "Gestell 1")
    home = await _material(db_session, "Tauchpumpe 2", "Gestell 1")
    incident = await _incident(db_session, test_event, test_user, "Mühlemattstrasse 3")
    db_session.add(IncidentAssignment(incident_id=incident.id, resource_type="material", resource_id=out.id))
    await db_session.commit()

    token = await feld_device_token(db_session, test_event.id, person.id)
    response = await client.get(f"/api/feld/material?token={token}&personnel_id={person.id}")

    assert response.status_code == 200
    rows = {row["name"]: row for row in response.json()["materials"]}

    # The one that is out names the Schadenplatz it is standing on…
    assert rows["Tauchpumpe 1"]["state"] == "out"
    assert rows["Tauchpumpe 1"]["at"] == "Mühlemattstrasse 3"
    assert rows["Tauchpumpe 1"]["home_location"] == "Gestell 1"

    # …and the one that is not is simply in the Magazin. This row is the whole
    # point of the change: the old view could not show it at all, because it
    # hangs off no Schadenplatz and therefore appeared nowhere.
    assert rows["Tauchpumpe 2"]["state"] == "in"
    assert rows["Tauchpumpe 2"]["at"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_released_unit_is_back_in_the_magazin(
    client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    # The board is the authority on where a unit is. A released assignment means
    # it came back, whatever any rapport checklist still says about it.
    from datetime import UTC, datetime

    person = await _person(db_session)
    await _magazin(db_session, test_event, person)
    material = await _material(db_session, "Motorsäge 2")
    incident = await _incident(db_session, test_event, test_user, "Kirchgasse 8")
    db_session.add(
        IncidentAssignment(
            incident_id=incident.id,
            resource_type="material",
            resource_id=material.id,
            unassigned_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    token = await feld_device_token(db_session, test_event.id, person.id)
    response = await client.get(f"/api/feld/material?token={token}&personnel_id={person.id}")

    row = next(r for r in response.json()["materials"] if r["name"] == "Motorsäge 2")
    assert row["state"] == "in"
    assert row["at"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_somebody_without_the_role_may_not_read_the_inventory(
    client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    # The gate that replaces "only what is yours". Widening a login-less door to
    # the whole inventory is only defensible while it is the Magazin's door, so
    # this is the assertion the widening rests on.
    person = await _person(db_session, "Keller Simon")
    incident = await _incident(db_session, test_event, test_user, "Hauptstrasse 12")
    db_session.add(
        IncidentAssignment(
            incident_id=incident.id,
            resource_type="personnel",
            resource_id=person.id,
            purpose="crew",
        )
    )
    await db_session.commit()

    token = await feld_device_token(db_session, test_event.id, person.id)
    response = await client.get(f"/api/feld/material?token={token}&personnel_id={person.id}")

    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_device_cannot_read_it_in_somebody_elses_name(
    client: AsyncClient, db_session: AsyncSession, test_event: Event
):
    # The binding holds here like everywhere else: holding the Magazin function
    # is not enough, the device has to BE that person.
    magazin = await _person(db_session)
    await _magazin(db_session, test_event, magazin)
    other = await _person(db_session, "Wyss Peter")

    token = await feld_device_token(db_session, test_event.id, other.id)
    response = await client.get(f"/api/feld/material?token={token}&personnel_id={magazin.id}")

    assert response.status_code == 403
