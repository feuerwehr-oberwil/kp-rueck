"""«Neue Meldung» — a Schadenplatz reported from the field (plan 26, decision 14).

The interesting half is "wir übernehmen das gleich". It is deliberately NOT a
transfer of the crew: resources belong to the *Auftrag* and already cover all
its stops, so a squad working a route simply gets another stop. Copying the crew
onto the new incident would leave everyone double-assigned; moving them would
strip the unfinished job of its people. Neither is what a crew driving from one
tree to the next is doing.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Personnel,
    User,
    Vehicle,
)
from tests.conftest import feld_device_token

MELDUNG = {
    "title": "Ast über Zufahrt",
    "type": "elementarereignis",
    "priority": "medium",
    "location_address": "Rebbergweg 14, Oberwil",
    "description": "Durchfahrt blockiert",
}


async def _person(db: AsyncSession, name: str = "Brunner Marco") -> Personnel:
    person = Personnel(id=uuid.uuid4(), name=name, role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _incident(db: AsyncSession, event: Event, user: User, title: str) -> Incident:
    incident = Incident(
        id=uuid.uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title} 1",
        status="active",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _assign(db: AsyncSession, incident: Incident, person: Personnel, **kwargs: object) -> IncidentAssignment:
    row = IncidentAssignment(
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=person.id,
        purpose="crew",
        **kwargs,
    )
    db.add(row)
    await db.commit()
    return row


async def _post(client: AsyncClient, event: Event, db: AsyncSession, person: Personnel, **overrides: object):
    token = await feld_device_token(db, event.id, person.id)
    return await client.post(
        f"/api/feld/incidents?token={token}&personnel_id={person.id}",
        json={**MELDUNG, **overrides},
    )


class TestMelden:
    """The plain case: report it, the KP disposes."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_field_report_lands_with_its_own_provenance(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # source='feld', not 'intake': both are somebody outside the KP saying
        # "there is something here", but one is a phone call an operator took
        # and the other is a firefighter standing in front of it.
        person = await _person(db_session)
        await _assign(db_session, await _incident(db_session, test_event, test_user, "Baum"), person)

        response = await _post(client, test_event, db_session, person)

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["takeover"] == "none"
        incident = await db_session.get(Incident, uuid.UUID(body["incident_id"]))
        assert incident is not None
        assert incident.source == "feld"
        assert incident.status == "incoming"
        # Nobody was put on it — the KP still disposes.
        rows = (
            (await db_session.execute(select(IncidentAssignment).where(IncidentAssignment.incident_id == incident.id)))
            .scalars()
            .all()
        )
        assert rows == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_anybody_in_the_brigade_may_report(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Somebody with no assignment at all can still report — reporting is what
        # you do BEFORE the Ereignis has given you anything, and a Telefondienst
        # is assigned to nothing by definition. They came through the Feld-Code
        # and named themselves; that is the bar.
        await _incident(db_session, test_event, test_user, "Baum")
        newcomer = await _person(db_session, "Neu Hier")

        response = await _post(client, test_event, db_session, newcomer)

        assert response.status_code == 201

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_device_cannot_report_as_somebody_else(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The rule that did not loosen: the binding. A device speaks for its own
        # person and for nobody else, so a report cannot be put in a colleague's
        # name — which is what makes the reporter on the audit row worth reading.
        await _incident(db_session, test_event, test_user, "Baum")
        me = await _person(db_session)
        colleague = await _person(db_session, "Frey Marc")
        token = await feld_device_token(db_session, test_event.id, me.id)

        response = await client.post(
            f"/api/feld/incidents?token={token}&personnel_id={colleague.id}",
            json=MELDUNG,
        )

        assert response.status_code == 403


class TestTakeOver:
    """ "Wir übernehmen das gleich" — the three shapes it can take."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_crew_on_a_route_simply_gets_another_stop(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The clean case, and the reason nothing is transferred: the Auftrag's
        # resources already cover every stop it has.
        person = await _person(db_session)
        first = await _incident(db_session, test_event, test_user, "Sturmholz 1")
        group = IncidentGroup(event_id=test_event.id, name="Sturmholz Nord", position=0)
        db_session.add(group)
        await db_session.commit()
        first.group_id = group.id
        first.group_position = 0
        await db_session.commit()
        await _assign(db_session, first, person)

        response = await _post(client, test_event, db_session, person, take_over=True)

        assert response.json()["takeover"] == "stop"
        new = await db_session.get(Incident, uuid.UUID(response.json()["incident_id"]))
        assert new is not None
        assert new.group_id == group.id
        assert new.group_position == 1
        # The old stop is untouched — it keeps its crew and its status until
        # somebody taps "Einsatz beendet" on it.
        await db_session.refresh(first)
        assert first.group_position == 0

        # …and the crew really does cover the new stop. The Auftrag owned nobody
        # before this call: everybody was assigned to the FIRST stop, which is
        # what the board's own assign flow writes. Appending a stop without
        # lifting them would hand the crew a Schadenplatz their own phone denies.
        route = await db_session.execute(
            select(IncidentGroupAssignment).where(
                IncidentGroupAssignment.incident_group_id == group.id,
                IncidentGroupAssignment.resource_type == "personnel",
                IncidentGroupAssignment.resource_id == person.id,
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
        assert route.scalars().first() is not None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_crew_on_one_job_opens_an_auftrag_and_keeps_working(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        person = await _person(db_session)
        first = await _incident(db_session, test_event, test_user, "Einzelner Baum")
        await _assign(db_session, first, person, is_leader=True)

        response = await _post(client, test_event, db_session, person, take_over=True)

        assert response.json()["takeover"] == "auftrag"
        new = await db_session.get(Incident, uuid.UUID(response.json()["incident_id"]))
        await db_session.refresh(first)
        assert new is not None
        assert new.group_id is not None
        # Both are stops of the same route, in the order they were worked.
        assert first.group_id == new.group_id
        assert (first.group_position, new.group_position) == (0, 1)

        # The crew is MIRRORED to route level, not moved: the person is still on
        # the job they are standing on, and now also covered on the new stop.
        group_rows = (
            (
                await db_session.execute(
                    select(IncidentGroupAssignment).where(IncidentGroupAssignment.incident_group_id == new.group_id)
                )
            )
            .scalars()
            .all()
        )
        assert [r.resource_id for r in group_rows] == [person.id]
        assert group_rows[0].is_leader is True
        original = (
            (await db_session.execute(select(IncidentAssignment).where(IncidentAssignment.incident_id == first.id)))
            .scalars()
            .all()
        )
        assert [r.unassigned_at for r in original] == [None]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_somebody_on_nothing_gets_themselves_and_their_vehicle(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # A driver waiting at the depot spots something on the way. There is no
        # route to extend, so the report is simply theirs.
        person = await _person(db_session)
        vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available")
        db_session.add(vehicle)
        await db_session.commit()
        db_session.add(
            EventSpecialFunction(
                event_id=test_event.id,
                personnel_id=person.id,
                function_type="driver",
                vehicle_id=vehicle.id,
            )
        )
        # Visible to /feld at all: the vehicle is out on something.
        other = await _incident(db_session, test_event, test_user, "Anderswo")
        db_session.add(IncidentAssignment(incident_id=other.id, resource_type="vehicle", resource_id=vehicle.id))
        await db_session.commit()

        response = await _post(client, test_event, db_session, person, take_over=True)

        assert response.json()["takeover"] == "solo"
        new_id = uuid.UUID(response.json()["incident_id"])
        rows = (
            (await db_session.execute(select(IncidentAssignment).where(IncidentAssignment.incident_id == new_id)))
            .scalars()
            .all()
        )
        assert {(r.resource_type, r.resource_id) for r in rows} == {
            ("personnel", person.id),
            ("vehicle", vehicle.id),
        }


class TestTelefondienst:
    """The phone desk is a ROLE now, not a page (plan 26, decision 6).

    A Telefondienst is a known person with an event role, so they pass the
    `/feld` two-step honestly and need no exception path — which is what made
    folding `/alarm` into the field surface possible at all.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_phone_desk_writes_an_intake_with_its_melder(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        person = await _person(db_session, "Hug Lena")
        db_session.add(
            EventSpecialFunction(event_id=test_event.id, personnel_id=person.id, function_type="telefondienst")
        )
        await db_session.commit()

        response = await _post(
            client,
            test_event,
            db_session,
            person,
            as_phone_call=True,
            contact="R. Suter",
            contact_phone="079 123 45 67",
        )

        assert response.status_code == 201, response.text
        incident = await db_session.get(Incident, uuid.UUID(response.json()["incident_id"]))
        assert incident is not None
        # The board draws a call differently from a firefighter
