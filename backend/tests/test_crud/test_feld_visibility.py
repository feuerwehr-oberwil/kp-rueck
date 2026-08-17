"""The `/feld` visibility union — who may see which Schadenplatz, and why.

Its own file rather than more classes in ``test_feld.py``, because this is the
one rule in the field surface where a mistake is a **data incident** and not a
layout bug: it decides what a login-less door hands to whoever holds the link.

The four sources (plan 26 §2.2):

    crew     personal assignment, purpose='crew'  — active **or released**
    reko     personal assignment, purpose='reko'  — active **or released**
    driver   a vehicle they drive, **only while** it is assigned
    magazin  any Schadenplatz with material still out

and the rule that pays for the ``purpose`` column existing at all: **only crew
can owe a Schadenplatz-Rapport.**
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import feld as crud
from app.models import (
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    User,
    Vehicle,
)


async def _incident(db: AsyncSession, event: Event, user: User, title: str, status: str = "active") -> Incident:
    incident = Incident(
        id=uuid.uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title} 1, Oberwil",
        status=status,
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _person(db: AsyncSession, name: str) -> Personnel:
    person = Personnel(id=uuid.uuid4(), name=name, role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _vehicle(db: AsyncSession, name: str) -> Vehicle:
    vehicle = Vehicle(id=uuid.uuid4(), name=name, type="TLF", status="available")
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return vehicle


async def _assign(
    db: AsyncSession,
    incident: Incident,
    resource_type: str,
    resource_id: uuid.UUID,
    *,
    released: bool = False,
    purpose: str = "crew",
) -> IncidentAssignment:
    assignment = IncidentAssignment(
        incident_id=incident.id,
        resource_type=resource_type,
        resource_id=resource_id,
        purpose=purpose,
        unassigned_at=datetime.now(UTC) if released else None,
    )
    db.add(assignment)
    await db.commit()
    return assignment


async def _function(
    db: AsyncSession,
    event: Event,
    person: Personnel,
    function_type: str,
    vehicle: Vehicle | None = None,
) -> EventSpecialFunction:
    row = EventSpecialFunction(
        event_id=event.id,
        personnel_id=person.id,
        function_type=function_type,
        vehicle_id=vehicle.id if vehicle else None,
    )
    db.add(row)
    await db.commit()
    return row


class TestCrewAndReko:
    """The two personal sources — and the difference the `purpose` column buys."""

    @pytest.mark.asyncio
    async def test_crew_sees_their_incident_and_owes_the_rapport(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Baum")
        person = await _person(db_session, "Brunner Marco")
        await _assign(db_session, incident, "personnel", person.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert set(visible) == {incident.id}
        assert visible[incident.id].kind == crud.SOURCE_CREW
        assert visible[incident.id].is_active is True
        assert visible[incident.id].owes_rapport is True

    @pytest.mark.asyncio
    async def test_a_released_crew_row_stays_visible(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The whole reason released rows count: the Rapport is written *after*
        # the crew has left, often from the next Schadenplatz.
        incident = await _incident(db_session, test_event, test_user, "Keller")
        person = await _person(db_session, "Boss Andrea")
        await _assign(db_session, incident, "personnel", person.id, released=True)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert set(visible) == {incident.id}
        assert visible[incident.id].is_active is False
        assert visible[incident.id].owes_rapport is True

    @pytest.mark.asyncio
    async def test_a_reko_trupp_sees_the_place_but_owes_no_rapport(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The bug this column exists to kill: before `purpose`, this row was
        # indistinguishable from a crew row and the trupp was asked to file a
        # Schadenplatz-Rapport for a place it had only looked at.
        incident = await _incident(db_session, test_event, test_user, "Hangrutsch")
        person = await _person(db_session, "Meier Nina")
        await _assign(db_session, incident, "personnel", person.id, purpose="reko")

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible[incident.id].kind == crud.SOURCE_REKO
        assert visible[incident.id].owes_rapport is False

    @pytest.mark.asyncio
    async def test_the_database_refuses_a_purpose_nobody_defined(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The first line of defence is the CHECK constraint, not the reader:
        # an unknown purpose cannot be stored at all. The reader's fallback to
        # "crew" is for a purpose a LATER release adds and this one has never
        # heard of — where the safe direction is more paperwork, never a
        # silently dropped Rapport.
        incident = await _incident(db_session, test_event, test_user, "Unklar")
        person = await _person(db_session, "Frei Simon")
        assignment = await _assign(db_session, incident, "personnel", person.id)

        assignment.purpose = "something-new"
        with pytest.raises(IntegrityError):
            await db_session.commit()
        await db_session.rollback()


class TestDriver:
    """A driver holds no personnel row at all — the vehicle does."""

    @pytest.mark.asyncio
    async def test_driver_sees_where_their_vehicle_is_sent(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Ziegel")
        person = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, person, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert set(visible) == {incident.id}
        assert visible[incident.id].kind == crud.SOURCE_DRIVER
        # The label the phone shows: "Als Fahrer · TLF 1".
        assert visible[incident.id].vehicle_name == "TLF 1"

    @pytest.mark.asyncio
    async def test_driver_never_owes_a_rapport(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user, "Ast")
        person = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "MTW")
        await _function(db_session, test_event, person, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible[incident.id].owes_rapport is False

    @pytest.mark.asyncio
    async def test_releasing_the_vehicle_takes_the_driver_row_with_it(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Decision 11, and the one place driver rows behave the OPPOSITE of crew
        # rows: the row existed because the vehicle was there. Once it is
        # released the driver owes nothing, so the row must not linger.
        incident = await _incident(db_session, test_event, test_user, "Vorbei")
        person = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 2")
        await _function(db_session, test_event, person, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id, released=True)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible == {}

    @pytest.mark.asyncio
    async def test_a_driver_of_an_unassigned_vehicle_sees_nothing(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        await _incident(db_session, test_event, test_user, "Fremd")
        person = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "DLK")
        await _function(db_session, test_event, person, "driver", vehicle)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible == {}


class TestMagazin:
    """Assigned to nothing, responsible for everything still out."""

    @pytest.mark.asyncio
    async def test_magazin_sees_schadenplaetze_with_material_out(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        with_material = await _incident(db_session, test_event, test_user, "MitMaterial")
        without = await _incident(db_session, test_event, test_user, "OhneMaterial")
        person = await _person(db_session, "Frei Simon")
        await _function(db_session, test_event, person, "magazin")
        material = Material(id=uuid.uuid4(), name="Tauchpumpe", type="Sonstiges", location="Depot", status="available")
        db_session.add(material)
        await db_session.commit()
        await _assign(db_session, with_material, "material", material.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert set(visible) == {with_material.id}
        assert without.id not in visible
        assert visible[with_material.id].kind == crud.SOURCE_MAGAZIN
        assert visible[with_material.id].owes_rapport is False

    @pytest.mark.asyncio
    async def test_returned_material_removes_the_row(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Zurueck")
        person = await _person(db_session, "Frei Simon")
        await _function(db_session, test_event, person, "magazin")
        material = Material(id=uuid.uuid4(), name="Motorsäge", type="Sonstiges", location="Depot", status="available")
        db_session.add(material)
        await db_session.commit()
        await _assign(db_session, incident, "material", material.id, released=True)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible == {}


class TestPrecedence:
    """One person, one Schadenplatz, several claims — the strongest wins."""

    @pytest.mark.asyncio
    async def test_crew_beats_driver_and_keeps_the_rapport(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Somebody who drove the TLF *and* worked the Schadenplatz is crew, and
        # the Rapport must not fall through the gap between the two claims.
        incident = await _incident(db_session, test_event, test_user, "Beides")
        person = await _person(db_session, "Brunner Marco")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, person, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)
        await _assign(db_session, incident, "personnel", person.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible[incident.id].kind == crud.SOURCE_CREW
        assert visible[incident.id].owes_rapport is True

    @pytest.mark.asyncio
    async def test_reko_beats_magazin(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user, "RekoUndMagazin")
        person = await _person(db_session, "Boss Andrea")
        await _function(db_session, test_event, person, "magazin")
        await _assign(db_session, incident, "personnel", person.id, purpose="reko")
        material = Material(id=uuid.uuid4(), name="Besen", type="Sonstiges", location="Depot", status="available")
        db_session.add(material)
        await db_session.commit()
        await _assign(db_session, incident, "material", material.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible[incident.id].kind == crud.SOURCE_REKO

    @pytest.mark.asyncio
    async def test_reassignment_after_release_counts_as_active(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Wiederholt")
        person = await _person(db_session, "Hug Lena")
        await _assign(db_session, incident, "personnel", person.id, released=True)
        await _assign(db_session, incident, "personnel", person.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible[incident.id].is_active is True


class TestAuthorizationDoor:
    """`get_authorized_incident` is the gate every write goes through."""

    @pytest.mark.asyncio
    async def test_driver_reaches_the_incident_but_not_the_rapport(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Hiding the Rapport section in the UI is presentation. THIS is the rule:
        # calling the endpoint directly has to fail too.
        incident = await _incident(db_session, test_event, test_user, "NurFahrer")
        person = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, person, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)

        assert await crud.get_authorized_incident(db_session, test_event.id, person.id, incident.id) is not None
        assert (
            await crud.get_authorized_incident(
                db_session, test_event.id, person.id, incident.id, sources=crud.RAPPORT_SOURCES
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_reko_may_arrive_but_may_not_end_the_einsatz(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "NurReko")
        person = await _person(db_session, "Meier Nina")
        await _assign(db_session, incident, "personnel", person.id, purpose="reko")

        assert (
            await crud.get_authorized_incident(
                db_session, test_event.id, person.id, incident.id, sources=crud.ARRIVAL_SOURCES
            )
            is not None
        )
        assert (
            await crud.get_authorized_incident(
                db_session, test_event.id, person.id, incident.id, sources=crud.WORK_SOURCES
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_a_stranger_reaches_nothing(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user, "Fremd")
        stranger = await _person(db_session, "Niemand Ohne")

        assert await crud.get_authorized_incident(db_session, test_event.id, stranger.id, incident.id) is None
        assert await crud.person_has_event_access(db_session, test_event.id, stranger.id) is False

    @pytest.mark.asyncio
    async def test_a_driver_only_person_has_event_access(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The exact person the old rule could not see: no personnel row anywhere,
        # and yet the event plainly has something for them.
        incident = await _incident(db_session, test_event, test_user, "NurFahren")
        person = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, person, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)

        assert await crud.person_has_event_access(db_session, test_event.id, person.id) is True


class TestPickerAndList:
    """What the two read endpoints do with the union."""

    @pytest.mark.asyncio
    async def test_the_picker_now_contains_drivers_and_magazin(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Sammel")
        crew = await _person(db_session, "Aa Crew")
        driver = await _person(db_session, "Bb Fahrer")
        magazin = await _person(db_session, "Cc Magazin")
        vehicle = await _vehicle(db_session, "TLF 1")
        material = Material(id=uuid.uuid4(), name="Pumpe", type="Sonstiges", location="Depot", status="available")
        db_session.add(material)
        await db_session.commit()

        await _assign(db_session, incident, "personnel", crew.id)
        await _function(db_session, test_event, driver, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)
        await _function(db_session, test_event, magazin, "magazin")
        await _assign(db_session, incident, "material", material.id)

        rows = await crud.get_feld_personnel_for_event(db_session, test_event.id)
        names = [row["name"] for row in rows]

        assert names == ["Aa Crew", "Bb Fahrer", "Cc Magazin"]

    @pytest.mark.asyncio
    async def test_only_crew_rows_count_toward_the_missing_rapport_badge(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # A driver opening /feld must not be greeted by a number they cannot act
        # on — there is no form behind it for them.
        incident = await _incident(db_session, test_event, test_user, "Offen")
        driver = await _person(db_session, "Bb Fahrer")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, driver, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)

        rows = await crud.get_feld_personnel_for_event(db_session, test_event.id)
        row = next(r for r in rows if r["personnel_id"] == driver.id)

        assert row["incident_count"] == 1
        assert row["missing_rapport_count"] == 0

    @pytest.mark.asyncio
    async def test_the_list_row_carries_its_source_and_vehicle(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Beschriftet")
        driver = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, driver, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)

        rows = await crud.get_feld_assignments_for_personnel(db_session, test_event.id, driver.id)

        assert len(rows) == 1
        assert rows[0]["source"] == crud.SOURCE_DRIVER
        assert rows[0]["source_vehicle"] == "TLF 1"

    @pytest.mark.asyncio
    async def test_an_own_assignment_carries_no_vehicle_label(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Eigen")
        person = await _person(db_session, "Brunner Marco")
        await _assign(db_session, incident, "personnel", person.id)

        rows = await crud.get_feld_assignments_for_personnel(db_session, test_event.id, person.id)

        assert rows[0]["source"] == crud.SOURCE_CREW
        assert rows[0]["source_vehicle"] is None


class TestEventIsolation:
    """A `/feld` token names one Ereignis, and the union may not cross it."""

    @pytest.mark.asyncio
    async def test_a_driver_function_in_another_event_grants_nothing_here(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        other = Event(id=uuid.uuid4(), name="Anderes Ereignis")
        db_session.add(other)
        await db_session.commit()

        incident = await _incident(db_session, test_event, test_user, "Hier")
        person = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        # Drives the vehicle in the OTHER event; the vehicle works in this one.
        await _function(db_session, other, person, "driver", vehicle)
        await _assign(db_session, incident, "vehicle", vehicle.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible == {}


class TestTheBoardsOlderRekoSignal:
    """`purpose` is authoritative, the event-wide reko function is the fallback.

    The board has drawn the Reko off `event_special_functions` since long before
    `purpose` existed. Any assignment written before this column — or by a path
    that forgets it — carries the default 'crew' while the board still shows
    that person as the Reko. Two rules for one question, and the field surface
    losing the argument means handing a Reko trupp the working crew's page.
    """

    @pytest.mark.asyncio
    async def test_a_reko_person_reads_as_reko_even_on_a_legacy_crew_row(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "Alt")
        person = await _person(db_session, "Fischer Thomas")
        await _function(db_session, test_event, person, "reko")
        # purpose='crew': exactly what a row written before the column looks like.
        await _assign(db_session, incident, "personnel", person.id, purpose="crew")

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert visible[incident.id].kind == crud.SOURCE_REKO
        assert visible[incident.id].owes_rapport is False

    @pytest.mark.asyncio
    async def test_somebody_without_the_function_is_still_crew(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The fallback must not leak: it keys on the person, not the incident.
        incident = await _incident(db_session, test_event, test_user, "Normal")
        reko = await _person(db_session, "Fischer Thomas")
        worker = await _person(db_session, "Brunner Marco")
        await _function(db_session, test_event, reko, "reko")
        await _assign(db_session, incident, "personnel", reko.id, purpose="reko")
        await _assign(db_session, incident, "personnel", worker.id)

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, worker.id)

        assert visible[incident.id].kind == crud.SOURCE_CREW
        assert visible[incident.id].owes_rapport is True


class TestTheRouteOwnsItsCrew:
    """An Auftrag's resources cover every stop — including for `/feld`.

    `IncidentGroupAssignment` has always said resources belong to the route and
    are shared across its stops, which is how a storm night is actually run: the
    KP assigns the squad to the route, not to each tree. The union rule did not
    read that table, so every crew assigned that way was invisible on the field
    surface — they hold no personnel row on any stop, exactly like a driver
    holds none at all. It looked like a bug in «Neue Meldung» and was older
    and wider than that.
    """

    @pytest.mark.asyncio
    async def test_a_crew_assigned_to_the_route_sees_every_stop(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        from app.models import IncidentGroup, IncidentGroupAssignment

        first = await _incident(db_session, test_event, test_user, "Stop eins")
        second = await _incident(db_session, test_event, test_user, "Stop zwei")
        person = await _person(db_session, "Brunner Marco")
        group = IncidentGroup(event_id=test_event.id, name="Auftrag Brunner", position=0)
        db_session.add(group)
        await db_session.commit()
        first.group_id, first.group_position = group.id, 0
        second.group_id, second.group_position = group.id, 1
        db_session.add(
            IncidentGroupAssignment(incident_group_id=group.id, resource_type="personnel", resource_id=person.id)
        )
        await db_session.commit()

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)

        assert set(visible) == {first.id, second.id}
        # Crew, so the Rapport is theirs on both — the route is the assignment.
        assert all(source.kind == crud.SOURCE_CREW for source in visible.values())
        assert all(source.owes_rapport for source in visible.values())

    @pytest.mark.asyncio
    async def test_the_stop_is_briefed_with_the_routes_crew_vehicle_and_leader(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Being able to SEE the stop was only half of it. The briefing and the
        # Einsatzleiter were built from per-incident rows too, so the crew that
        # could finally find their Schadenplatz opened it to "keine Ressourcen"
        # and "kein EL erfasst" — while standing next to both.
        from app.models import IncidentGroup, IncidentGroupAssignment

        stop = await _incident(db_session, test_event, test_user, "Kirchgasse 8")
        leader = await _person(db_session, "Graf Thomas")
        mate = await _person(db_session, "Suter Elias")
        vehicle = await _vehicle(db_session, "MTW")
        group = IncidentGroup(event_id=test_event.id, name="Auftrag Graf", position=0)
        db_session.add(group)
        await db_session.commit()
        stop.group_id, stop.group_position = group.id, 0
        db_session.add_all(
            [
                IncidentGroupAssignment(
                    incident_group_id=group.id,
                    resource_type="personnel",
                    resource_id=leader.id,
                    is_leader=True,
                ),
                IncidentGroupAssignment(incident_group_id=group.id, resource_type="personnel", resource_id=mate.id),
                IncidentGroupAssignment(incident_group_id=group.id, resource_type="vehicle", resource_id=vehicle.id),
            ]
        )
        await db_session.commit()

        rows = await crud.get_feld_assignments_for_personnel(db_session, test_event.id, leader.id)

        row = next(r for r in rows if r["incident_id"] == stop.id)
        assert set(row["crew"]) == {"Graf Thomas", "Suter Elias"}
        # The route owns it, so it travels with the squad to the next stop.
        assert row["vehicles"] == [{"name": "MTW", "driver": None, "stays": None, "via_auftrag": True}]
        # The Auftrag's leader leads every stop on it.
        assert row["leader_personnel_id"] == leader.id
        assert row["leader_name"] == "Graf Thomas"
        # And the row says which Auftrag it belongs to, so the list can group it.
        assert row["group_id"] == group.id
        assert row["group_name"] == "Auftrag Graf"
        assert row["group_position"] == 0

    @pytest.mark.asyncio
    async def test_a_vehicle_on_the_route_puts_its_driver_on_every_stop(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        from app.models import IncidentGroup, IncidentGroupAssignment

        first = await _incident(db_session, test_event, test_user, "Stop eins")
        second = await _incident(db_session, test_event, test_user, "Stop zwei")
        driver = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, driver, "driver", vehicle)
        group = IncidentGroup(event_id=test_event.id, name="Auftrag Keller", position=0)
        db_session.add(group)
        await db_session.commit()
        first.group_id, first.group_position = group.id, 0
        second.group_id, second.group_position = group.id, 1
        db_session.add(
            IncidentGroupAssignment(incident_group_id=group.id, resource_type="vehicle", resource_id=vehicle.id)
        )
        await db_session.commit()

        visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, driver.id)

        assert set(visible) == {first.id, second.id}
        assert all(source.kind == crud.SOURCE_DRIVER for source in visible.values())
        assert all(source.vehicle_name == "TLF 1" for source in visible.values())

    @pytest.mark.asyncio
    async def test_a_completed_stop_stops_being_live_for_the_route(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        """«Beendet» on one stop has to reach the phones standing at it.

        The per-incident path says so by itself: completing an incident releases
        its crew and its vehicles, so the row goes inactive (crew) or disappears
        (driver) on the next poll. A ROUTE's resources are not released until the
        last stop closes — correctly, they are still out — and that left every
        Auftrag row on `/feld` frozen as live work: the driver of the TLF kept
        reading the stop the KP had closed an hour ago as the current one, with
        nothing on the page to say otherwise (the field surface deliberately does
        not show the Schadenplatz-Status).
        """
        from app.models import IncidentGroup, IncidentGroupAssignment

        first = await _incident(db_session, test_event, test_user, "Stop eins")
        second = await _incident(db_session, test_event, test_user, "Stop zwei")
        crew = await _person(db_session, "Suter Elias")
        driver = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, driver, "driver", vehicle)
        group = IncidentGroup(event_id=test_event.id, name="Auftrag Keller", position=0)
        db_session.add(group)
        await db_session.commit()
        first.group_id, first.group_position = group.id, 0
        second.group_id, second.group_position = group.id, 1
        db_session.add_all(
            [
                IncidentGroupAssignment(incident_group_id=group.id, resource_type="personnel", resource_id=crew.id),
                IncidentGroupAssignment(incident_group_id=group.id, resource_type="vehicle", resource_id=vehicle.id),
            ]
        )
        # The KP closes the first stop. The route's resources stay assigned —
        # the squad is still driving, stop two is open.
        first.status = "complete"
        await db_session.commit()

        for person in (crew, driver):
            visible = await crud.visible_incidents_for_personnel(db_session, test_event.id, person.id)
            # Both stops stay VISIBLE: the crew still owes the first one a
            # Rapport, and the driver reading where they have been is not a leak.
            assert set(visible) == {first.id, second.id}
            assert visible[first.id].is_active is False
            assert visible[second.id].is_active is True

    @pytest.mark.asyncio
    async def test_the_closed_stop_reads_as_past_on_the_phone(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        """…and the field row says so, which is the half the crew sees.

        `is_active_assignment` is what puts a row under «Früher» with «Nicht mehr
        zugeteilt» instead of leaving it at the top as the job in hand.
        """
        from app.models import IncidentGroup, IncidentGroupAssignment

        stop = await _incident(db_session, test_event, test_user, "Kirchgasse 8")
        driver = await _person(db_session, "Keller Thomas")
        vehicle = await _vehicle(db_session, "TLF 1")
        await _function(db_session, test_event, driver, "driver", vehicle)
        group = IncidentGroup(event_id=test_event.id, name="Auftrag Keller", position=0)
        db_session.add(group)
        await db_session.commit()
        stop.group_id, stop.group_position = group.id, 0
        db_session.add(
            IncidentGroupAssignment(incident_group_id=group.id, resource_type="vehicle", resource_id=vehicle.id)
        )
        stop.status = "complete"
        await db_session.commit()

        rows = await crud.get_feld_assignments_for_personnel(db_session, test_event.id, driver.id)

        row = next(r for r in rows if r["incident_id"] == stop.id)
        assert row["source"] == crud.SOURCE_DRIVER
        assert row["is_active_assignment"] is False
