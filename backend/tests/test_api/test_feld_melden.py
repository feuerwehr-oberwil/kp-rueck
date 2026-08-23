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

from app.crud.feld.melden import append_reporter_note, reporter_note_prefix
from app.models import (
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Notification,
    Personnel,
    StatusTransition,
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


async def _report(client: AsyncClient, event: Event, db: AsyncSession, person: Personnel, **overrides: object):
    """Send a Meldung in and hand back the incident it became."""
    response = await _post(client, event, db, person, **overrides)
    assert response.status_code == 201, response.text
    incident = await db.get(Incident, uuid.UUID(response.json()["incident_id"]))
    assert incident is not None
    return incident


async def _correct(
    client: AsyncClient, event: Event, db: AsyncSession, person: Personnel, incident: Incident, **fields: object
):
    """The «Korrektur senden» half — a fresh device token, like a real phone."""
    token = await feld_device_token(db, event.id, person.id)
    return await client.put(
        f"/api/feld/incidents/{incident.id}/report?token={token}&personnel_id={person.id}",
        json=fields,
    )


async def _own_reports(client: AsyncClient, event: Event, db: AsyncSession, person: Personnel) -> list[dict]:
    """«Von mir gemeldet», as the phone reads it."""
    token = await feld_device_token(db, event.id, person.id)
    response = await client.get(f"/api/feld/assignments/{person.id}?token={token}")
    assert response.status_code == 200, response.text
    return response.json()["reports"]


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


class TestMeldungRaisesTheBell:
    """A new Schadenplatz from the field is a notification, like everything else.

    It was the one `/feld` action that raised none: angekommen, beendet, die
    Abholung, eine Meldung im Thread and der Rapport all ring, and the one that
    creates a whole Schadenplatz let a card appear in a column silently.
    """

    @staticmethod
    async def _notifications(db: AsyncSession, incident_id: uuid.UUID) -> list[Notification]:
        rows = await db.execute(select(Notification).where(Notification.incident_id == incident_id))
        return list(rows.scalars().all())

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_plain_meldung_rings_as_info(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # `info`, because the Schadenplatz is sitting in Eingegangen — the column
        # an operator watches for exactly this.
        person = await _person(db_session)
        await _assign(db_session, await _incident(db_session, test_event, test_user, "Baum"), person)

        response = await _post(client, test_event, db_session, person)

        incident_id = uuid.UUID(response.json()["incident_id"])
        rows = await self._notifications(db_session, incident_id)
        assert [(row.type, row.severity) for row in rows] == [("field_report", "info")]
        assert "Rebbergweg 14" in rows[0].message
        assert person.name in rows[0].message

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_taken_over_meldung_rings_louder(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # `warning`, because «wir übernehmen das gleich» puts the Schadenplatz
        # straight into `enroute`: it never passes through Eingegangen, so a
        # crew is driving to an address the KP has not been shown.
        person = await _person(db_session)
        await _assign(db_session, await _incident(db_session, test_event, test_user, "Baum"), person)

        response = await _post(client, test_event, db_session, person, take_over=True)

        incident_id = uuid.UUID(response.json()["incident_id"])
        rows = await self._notifications(db_session, incident_id)
        assert [(row.type, row.severity) for row in rows] == [("field_report", "warning")]
        assert "direkt hin" in rows[0].message


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
    async def test_a_crew_assigned_to_the_route_itself_is_still_on_a_route(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The field failure this test exists for: the board can assign a squad to
        # the AUFTRAG rather than to one of its stops, and then nobody has an
        # `IncidentAssignment` row at all. The lookup only read those rows, so
        # the reporter arrived here as "on nothing" — and «wir übernehmen das
        # gleich» quietly assigned the Einsatzleiter alone to a Schadenplatz
        # that never reached their Auftrag.
        leader = await _person(db_session)
        mate = await _person(db_session, "Frey Marc")
        stop = await _incident(db_session, test_event, test_user, "Sturmholz 1")
        group = IncidentGroup(event_id=test_event.id, name="Sturmholz Nord", position=0)
        db_session.add(group)
        await db_session.commit()
        stop.group_id = group.id
        stop.group_position = 0
        for person, is_leader in ((leader, True), (mate, False)):
            db_session.add(
                IncidentGroupAssignment(
                    incident_group_id=group.id,
                    resource_type="personnel",
                    resource_id=person.id,
                    is_leader=is_leader,
                )
            )
        await db_session.commit()

        response = await _post(client, test_event, db_session, leader, take_over=True)

        assert response.json()["takeover"] == "stop"
        new = await db_session.get(Incident, uuid.UUID(response.json()["incident_id"]))
        assert new is not None
        assert new.group_id == group.id
        assert new.group_position == 1
        # Nobody was assigned to the incident directly — the route already covers
        # it, and the whole squad comes with it because the route is what they
        # were on.
        direct = (
            (await db_session.execute(select(IncidentAssignment).where(IncidentAssignment.incident_id == new.id)))
            .scalars()
            .all()
        )
        assert direct == []
        route = (
            (
                await db_session.execute(
                    select(IncidentGroupAssignment).where(
                        IncidentGroupAssignment.incident_group_id == group.id,
                        IncidentGroupAssignment.unassigned_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {row.resource_id for row in route} == {leader.id, mate.id}

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_whole_squad_comes_along_not_just_the_reporter(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Everything they have in use, not only the person holding the phone:
        # crew, the vehicle and the material on the job they are standing on all
        # reach the new Auftrag, so the second stop arrives with what the first
        # one has.
        leader = await _person(db_session)
        mate = await _person(db_session, "Frey Marc")
        vehicle = Vehicle(id=uuid.uuid4(), name="TLF 2", type="TLF", status="available")
        db_session.add(vehicle)
        await db_session.commit()
        first = await _incident(db_session, test_event, test_user, "Einzelner Baum")
        await _assign(db_session, first, leader, is_leader=True)
        await _assign(db_session, first, mate)
        db_session.add(
            IncidentAssignment(
                incident_id=first.id,
                resource_type="vehicle",
                resource_id=vehicle.id,
                purpose="crew",
            )
        )
        await db_session.commit()

        response = await _post(client, test_event, db_session, leader, take_over=True)

        assert response.json()["takeover"] == "auftrag"
        new = await db_session.get(Incident, uuid.UUID(response.json()["incident_id"]))
        await db_session.refresh(first)
        assert new is not None
        # The job they were on is stop 1, the one they just took on is stop 2.
        assert (first.group_position, new.group_position) == (0, 1)
        route = (
            (
                await db_session.execute(
                    select(IncidentGroupAssignment).where(IncidentGroupAssignment.incident_group_id == new.group_id)
                )
            )
            .scalars()
            .all()
        )
        assert {(row.resource_type, row.resource_id) for row in route} == {
            ("personnel", leader.id),
            ("personnel", mate.id),
            ("vehicle", vehicle.id),
        }
        # One Einsatzleiter on the route, and it is the one the stop already had.
        assert [row.resource_id for row in route if row.is_leader] == [leader.id]

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


class TestKorrektur:
    """Fix a Meldung you sent in yourself — until the KP takes it over.

    Same window and same rule as the `/alarm` receipt (`report_is_editable`
    plus `never_left_the_window`); the difference is only who holds the phone.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_meldung_can_be_corrected_while_it_sits_in_eingegangen(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        person = await _person(db_session)
        incident = await _report(client, test_event, db_session, person)

        response = await _correct(
            client, test_event, db_session, person, incident, location_address="Rebbergweg 41, Oberwil"
        )

        assert response.status_code == 200, response.text
        assert response.json()["editable"] is True
        await db_session.refresh(incident)
        assert incident.location_address == "Rebbergweg 41, Oberwil"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_undispatch_does_not_reopen_the_window(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """Dragging a card back to «Eingegangen» must not hand the phone the pen again.

        `report_is_editable` is stateful, so on its own it would say yes here.
        By this point the KP may have refined the Meldung, and the phone sends
        its whole cached form back — «Meldung» is assign-semantics, so a stale
        tab would silently overwrite that text.
        """
        person = await _person(db_session)
        incident = await _report(client, test_event, db_session, person)

        # disponiert, then dragged back by the operator
        incident.status = "enroute"
        db_session.add(StatusTransition(incident_id=incident.id, from_status="incoming", to_status="enroute"))
        await db_session.commit()
        incident.status = "incoming"
        db_session.add(StatusTransition(incident_id=incident.id, from_status="enroute", to_status="incoming"))
        await db_session.commit()

        operator_text = "Baum auf Fahrbahn, Höhe Einfahrt Werkhof, halbseitig gesperrt"
        incident.description = operator_text
        await db_session.commit()

        # The phone is told so too, or the button and the 409 disagree.
        assert [row["editable"] for row in await _own_reports(client, test_event, db_session, person)] == [False]

        response = await _correct(client, test_event, db_session, person, incident, description="Durchfahrt blockiert")

        assert response.status_code == 409
        assert response.json()["detail"] == "Der KP hat diese Meldung bereits übernommen. Änderungen bitte per Funk."
        await db_session.refresh(incident)
        assert incident.description == operator_text

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("status", ["reko", "reko_done"])
    async def test_reko_does_not_shut_the_window(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, status: str
    ):
        """A reporter still typing while the Reko-Trupp looks is *adding* information."""
        person = await _person(db_session)
        incident = await _report(client, test_event, db_session, person)
        incident.status = status
        db_session.add(StatusTransition(incident_id=incident.id, from_status="incoming", to_status=status))
        await db_session.commit()

        response = await _correct(client, test_event, db_session, person, incident, location_address="Doch Nummer 7")

        assert response.status_code == 200, response.text
        await db_session.refresh(incident)
        assert incident.location_address == "Doch Nummer 7"


class TestNotizenAreSharedWithTheOperator:
    """A reporter may add to «Notizen». They may never take anything out.

    The column is the KP's as well as theirs, and the phone posts its whole
    cached form back on every correction — so assigning it meant a crew fixing
    a house number silently deleted whatever the operator had typed since.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_correction_cannot_overwrite_what_the_kp_typed(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        person = await _person(db_session)
        incident = await _report(client, test_event, db_session, person, internal_notes="Zufahrt über den Hinterhof")
        operator_note = "Werkhof avisiert, kommt um 14:00"
        incident.internal_notes = f"{incident.internal_notes}\n{operator_note}"
        await db_session.commit()

        response = await _correct(
            client, test_event, db_session, person, incident, internal_notes="Zufahrt doch frei, Hund im Haus"
        )

        assert response.status_code == 200, response.text
        await db_session.refresh(incident)
        assert incident.internal_notes is not None
        # The operator keeps every word – including the hint they were reading.
        assert operator_note in incident.internal_notes
        assert "Zufahrt über den Hinterhof" in incident.internal_notes
        # And the correction arrives marked as the Nachtrag it is, by name.
        assert incident.internal_notes.endswith(f"{reporter_note_prefix(person.name)}Zufahrt doch frei, Hund im Haus")
        # The phone is not handed the shared column back: it would show the crew
        # what the KP typed, and the next correction would post the whole blob
        # straight back in.
        assert response.json()["internal_notes"] is None
        assert operator_note not in response.text

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_empty_hint_does_not_clear_the_column(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """`""` clears the reporter's own fields. It cannot clear this one.

        The form prefills «Weitere Hinweise» empty on a correction, so an empty
        string is what a crew fixing the address sends — not an instruction to
        delete the KP's notes.
        """
        person = await _person(db_session)
        incident = await _report(client, test_event, db_session, person, internal_notes="Zufahrt über den Hinterhof")

        response = await _correct(client, test_event, db_session, person, incident, internal_notes="")

        assert response.status_code == 200, response.text
        await db_session.refresh(incident)
        assert incident.internal_notes == "Zufahrt über den Hinterhof"

    def test_resending_the_same_nachtrag_adds_nothing_but_a_short_one_still_appends(self):
        """Dedup is entry-exact, not substring.

        A double tap must not stutter; «12» occurring inside «Hausnummer 12 …»
        is not the same Nachtrag having been sent before, and dropping it would
        swallow a genuine correction.
        """
        existing = "Zufahrt über Hausnummer 12 gesperrt"
        prefix = reporter_note_prefix("Brunner Marco")

        appended = append_reporter_note(existing, "12", reporter="Brunner Marco")
        assert appended == f"{existing}\n{prefix}12"
        assert append_reporter_note(appended, "12", reporter="Brunner Marco") == appended
