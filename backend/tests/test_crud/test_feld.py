"""CRUD tests for the Schadenplatz-Rapport (plan 25, phase 2).

Two things live here, and neither is reachable through the routers alone:

* **the prefill of §4** — address, Einsatzleiter, Melder, head count and the
  material name suggestions. (The Beginn/Ende chain used to be prefilled here
  too; it is now derived at output time and tested in
  ``test_services/test_rapport_work_windows.py``.)
* **the material reconciliation**, including the answered/unanswered split. That
  rule is the difference between a checklist that remembers what a crew said and
  one that quietly forgets it the moment the board changes.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import feld as crud
from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    SchadenplatzReport,
    User,
    Vehicle,
)
from app.schemas.feld import RapportUpdate

ACTOR = crud.FieldActor(personnel_id=uuid.uuid4(), personnel_name="Muster Hans")


async def _incident(db: AsyncSession, event: Event, user: User, title: str = "Keller Wasser") -> Incident:
    incident = Incident(
        id=uuid.uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title} 1, Oberwil",
        status="active",
        event_id=event.id,
        created_by=user.id,
        contact="A. Bürgin",
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _material(db: AsyncSession, name: str, *, consumable: bool = False, location: str = "Depot") -> Material:
    material = Material(
        id=uuid.uuid4(),
        name=name,
        type="Sonstiges",
        location=location,
        status="available",
        consumable=consumable,
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return material


async def _assign(
    db: AsyncSession,
    incident: Incident,
    resource_type: str,
    resource_id: uuid.UUID,
    *,
    assigned_at: datetime | None = None,
    released: bool = False,
) -> IncidentAssignment:
    assignment = IncidentAssignment(
        incident_id=incident.id,
        resource_type=resource_type,
        resource_id=resource_id,
        unassigned_at=datetime.now(UTC) if released else None,
    )
    if assigned_at is not None:
        assignment.assigned_at = assigned_at
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


async def _report(db: AsyncSession, incident: Incident, **kwargs: object) -> SchadenplatzReport:
    report = SchadenplatzReport(incident_id=incident.id, is_draft=True, **kwargs)
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


class TestPrefillRest:
    """Address, Einsatzleiter, Melder, the head count and the material suggestions."""

    @pytest.mark.asyncio
    async def test_melder_is_offered_for_copying_never_equated(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # "Melder übernehmen" COPIES the contact into the owner block. The
        # owner fields stay empty until somebody taps it — Melder ≠ Eigentümer.
        incident = await _incident(db_session, test_event, test_user)
        incident.contact_phone = "079 111 22 33"
        await db_session.commit()
        view = await crud.get_rapport(db_session, incident, actor=ACTOR)

        assert view["prefill"]["melder_name"] == "A. Bürgin"
        assert view["prefill"]["melder_phone"] == "079 111 22 33"
        assert view.get("owner_name") is None
        assert view.get("owner_phone") is None

    @pytest.mark.asyncio
    async def test_leader_comes_from_the_resolver_not_the_raw_flag(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # A finished incident has no active `is_leader` row left — every one was
        # cleared on release. The leader OF RECORD is what a crew filing after
        # the fact has to see, and it is exactly the state /feld exists for.
        incident = await _incident(db_session, test_event, test_user)
        leader = Personnel(id=uuid.uuid4(), name="Frey Marc", role="Offizier", status="available")
        db_session.add(leader)
        await db_session.commit()
        incident.leader_personnel_id = leader.id
        await db_session.commit()
        await _assign(db_session, incident, "personnel", leader.id, released=True)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["prefill"]["leader_personnel_id"] == leader.id
        assert view["prefill"]["leader_name"] == "Frey Marc"

    @pytest.mark.asyncio
    async def test_head_count_is_distinct_people_and_includes_released_ones(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        person = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available")
        db_session.add_all([person, vehicle])
        await db_session.commit()

        # Assigned, released, re-assigned: one person worked one Einsatz.
        await _assign(db_session, incident, "personnel", person.id, released=True)
        await _assign(db_session, incident, "personnel", person.id)
        await _assign(db_session, incident, "vehicle", vehicle.id, released=True)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["prefill"]["board_personnel_count"] == 1
        # And it is the default the form opens with.
        assert view["personnel_count"] == 1
        # The vehicle half is a LIST now, and its length is the count.
        assert [row["name"] for row in view["vehicles"]] == ["TLF 1"]
        assert "board_vehicle_count" not in view["prefill"]

    @pytest.mark.asyncio
    async def test_material_name_suggestions_are_names_and_nothing_else(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # A naming aid for "Weiteres Material" — deliberately no ids, so no
        # client can turn the autosuggest into a picker that writes assignments.
        incident = await _incident(db_session, test_event, test_user)
        await _material(db_session, "Zulu-Schaufel")
        await _material(db_session, "Alpha-Blache")

        suggestions = (await crud.get_rapport(db_session, incident, actor=ACTOR))["prefill"][
            "material_name_suggestions"
        ]
        assert "Zulu-Schaufel" in suggestions
        assert "Alpha-Blache" in suggestions
        assert suggestions == sorted(suggestions)
        assert all(isinstance(name, str) for name in suggestions)

    @pytest.mark.asyncio
    async def test_a_get_never_creates_a_row(self, db_session: AsyncSession, test_event: Event, test_user: User):
        # "kein Rapport" has to keep meaning something after somebody looked.
        incident = await _incident(db_session, test_event, test_user)
        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["exists"] is False
        assert await crud._rapport_states(db_session, [incident.id]) == {}


class TestMaterialReconciliation:
    """Re-reconciled on every GET, **never replaced** (§4, decision 14)."""

    @pytest.mark.asyncio
    async def test_every_assigned_unit_appears_ticked_including_released_ones(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # A unit that came back early still belongs in the record — the crew
        # that used it is the only one who can say so.
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe TP-4")
        saw = await _material(db_session, "Motorsäge")
        await _assign(db_session, incident, "material", pump.id)
        await _assign(db_session, incident, "material", saw.id, released=True)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        names = {row["name"] for row in view["materials"]}
        assert names == {"Tauchpumpe TP-4", "Motorsäge"}
        # Prefilled *ja* since §18.32 — the unit was sent here, so "gebraucht"
        # is the board's own answer and the crew unticks the exceptions.
        assert all(row["used"] is True and row["left_on_site"] is False for row in view["materials"])

    @pytest.mark.asyncio
    async def test_a_unit_added_after_the_draft_started_appears_ticked(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe TP-4")
        first = await _assign(db_session, incident, "material", pump.id)
        await _report(
            db_session,
            incident,
            materials_json=[
                {
                    "assignment_id": str(first.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe TP-4",
                    "consumable": False,
                    "used": True,
                    "left_on_site": True,
                }
            ],
        )

        # The KP assigns a second pump while the crew is typing.
        second_material = await _material(db_session, "Nassauger")
        await _assign(db_session, incident, "material", second_material.id)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        rows = {row["name"]: row for row in view["materials"]}
        assert rows["Tauchpumpe TP-4"]["used"] is True
        assert rows["Tauchpumpe TP-4"]["left_on_site"] is True
        assert rows["Nassauger"]["used"] is True
        assert rows["Nassauger"]["left_on_site"] is False

    @pytest.mark.asyncio
    async def test_a_removed_unit_keeps_its_row_when_the_crew_contradicted_the_board(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # They looked at it and said it was NOT used. Deleting the row would
        # lose exactly what the checklist exists to capture. Since §18.32 the
        # tick is prefilled ja, so an unticked row is the correction.
        incident = await _incident(db_session, test_event, test_user)
        gone = uuid.uuid4()
        await _report(
            db_session,
            incident,
            materials_json=[
                {
                    "assignment_id": str(gone),
                    "material_id": str(uuid.uuid4()),
                    "name": "Schmutzwasserschlauch",
                    "consumable": False,
                    "used": False,
                    "left_on_site": False,
                }
            ],
        )

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert len(view["materials"]) == 1
        assert view["materials"][0]["name"] == "Schmutzwasserschlauch"
        assert view["materials"][0]["used"] is False
        assert view["materials"][0]["on_board"] is False

    @pytest.mark.asyncio
    async def test_a_removed_unit_drops_when_it_still_carries_the_defaults(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        await _report(
            db_session,
            incident,
            materials_json=[
                {
                    "assignment_id": str(uuid.uuid4()),
                    "material_id": str(uuid.uuid4()),
                    "name": "Nie angefasst",
                    "consumable": False,
                    "used": True,
                    "left_on_site": False,
                }
            ],
        )

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["materials"] == []

    @pytest.mark.asyncio
    async def test_a_legacy_null_used_reads_as_ja(self, db_session: AsyncSession, test_event: Event, test_user: User):
        # A rapport filed before §18.32 (or a database that skipped the
        # normalising migration) must not render a blank third answer.
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe TP-4")
        assignment = await _assign(db_session, incident, "material", pump.id)
        await _report(
            db_session,
            incident,
            materials_json=[
                {
                    "assignment_id": str(assignment.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe TP-4",
                    "consumable": False,
                    "used": None,
                    "left_on_site": False,
                }
            ],
        )

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["materials"][0]["used"] is True

    @pytest.mark.asyncio
    async def test_left_on_site_alone_counts_as_answered(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        await _report(
            db_session,
            incident,
            materials_json=[
                {
                    "assignment_id": str(uuid.uuid4()),
                    "material_id": str(uuid.uuid4()),
                    "name": "Blache",
                    "consumable": False,
                    "used": True,
                    "left_on_site": True,
                }
            ],
        )

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert [row["name"] for row in view["materials"]] == ["Blache"]

    @pytest.mark.asyncio
    async def test_a_consumable_can_never_be_left_on_site(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Decision 26. Enforced in the reconciliation, not only in the UI, so
        # neither door and no later caller can write the impossible state.
        incident = await _incident(db_session, test_event, test_user)
        foam = await _material(db_session, "Ölbindemittel", consumable=True)
        assignment = await _assign(db_session, incident, "material", foam.id)
        await _report(
            db_session,
            incident,
            materials_json=[
                {
                    "assignment_id": str(assignment.id),
                    "material_id": str(foam.id),
                    "name": "Ölbindemittel",
                    "consumable": True,
                    "used": True,
                    "left_on_site": True,
                }
            ],
        )

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["materials"][0]["consumable"] is True
        assert view["materials"][0]["used"] is True
        assert view["materials"][0]["left_on_site"] is False

    @pytest.mark.asyncio
    async def test_units_are_ordered_by_depot(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user)
        b = await _material(db_session, "Nassauger", location="Magazin B")
        a = await _material(db_session, "Tauchpumpe", location="Magazin A")
        await _assign(db_session, incident, "material", b.id)
        await _assign(db_session, incident, "material", a.id)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert [row["location"] for row in view["materials"]] == ["Magazin A", "Magazin B"]


class TestVehicleChecklist:
    """The crew confirms WHICH vehicles — the whole fleet, the assigned ones ticked (§18.33)."""

    async def _actor(self, db: AsyncSession) -> crud.FieldActor:
        """A filer that really exists — `save_rapport` stores the provenance id."""
        person = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db.add(person)
        await db.commit()
        return crud.FieldActor(personnel_id=person.id, personnel_name=person.name)

    async def _vehicle(self, db: AsyncSession, name: str, *, display_order: int = 0) -> Vehicle:
        vehicle = Vehicle(
            id=uuid.uuid4(),
            name=name,
            type="TLF",
            status="available",
            display_order=display_order,
        )
        db.add(vehicle)
        await db.commit()
        await db.refresh(vehicle)
        return vehicle

    @pytest.mark.asyncio
    async def test_every_assigned_vehicle_prefills_ticked_including_released_ones(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The board says the vehicle was there; the crew's job is to contradict
        # that, not to confirm it by hand. A vehicle that drove back early was
        # still at the Schadenplatz.
        incident = await _incident(db_session, test_event, test_user)
        tlf = await self._vehicle(db_session, "TLF 1", display_order=1)
        mtw = await self._vehicle(db_session, "MTW", display_order=2)
        await _assign(db_session, incident, "vehicle", tlf.id)
        await _assign(db_session, incident, "vehicle", mtw.id, released=True)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert [row["name"] for row in view["vehicles"]] == ["TLF 1", "MTW"]
        assert all(row["present"] is True and row["on_board"] is True for row in view["vehicles"])

    @pytest.mark.asyncio
    async def test_the_whole_fleet_is_listed_with_the_unassigned_ones_unticked(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # §18.33: the board is routinely behind reality, so a vehicle that came
        # along without ever being dispatched must be tickable. A list that can
        # only be unticked cannot record it.
        incident = await _incident(db_session, test_event, test_user)
        tlf = await self._vehicle(db_session, "TLF 1", display_order=1)
        await self._vehicle(db_session, "MTW", display_order=2)
        await _assign(db_session, incident, "vehicle", tlf.id)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        rows = {row["name"]: row for row in view["vehicles"]}
        assert set(rows) == {"TLF 1", "MTW"}
        assert rows["TLF 1"]["present"] is True and rows["TLF 1"]["on_board"] is True
        assert rows["MTW"]["present"] is False and rows["MTW"]["on_board"] is False

    @pytest.mark.asyncio
    async def test_ticking_a_vehicle_the_board_never_sent_round_trips(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        tlf = await self._vehicle(db_session, "TLF 1", display_order=1)
        mtw = await self._vehicle(db_session, "MTW", display_order=2)
        await _assign(db_session, incident, "vehicle", tlf.id)
        actor = await self._actor(db_session)

        saved = await crud.save_rapport(
            db_session,
            incident,
            actor=actor,
            payload=RapportUpdate(
                vehicles=[
                    {"vehicle_id": tlf.id, "present": True},
                    {"vehicle_id": mtw.id, "present": True},
                ]
            ),
        )
        assert {row["name"]: row["present"] for row in saved["vehicles"]} == {"TLF 1": True, "MTW": True}

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        rows = {row["name"]: row for row in view["vehicles"]}
        assert rows["MTW"]["present"] is True
        # Still not an assignment — `/feld` never writes one (decision 17).
        assert rows["MTW"]["on_board"] is False

    @pytest.mark.asyncio
    async def test_unticking_one_round_trips(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user)
        tlf = await self._vehicle(db_session, "TLF 1", display_order=1)
        mtw = await self._vehicle(db_session, "MTW", display_order=2)
        await _assign(db_session, incident, "vehicle", tlf.id)
        await _assign(db_session, incident, "vehicle", mtw.id)
        actor = await self._actor(db_session)

        saved = await crud.save_rapport(
            db_session,
            incident,
            actor=actor,
            payload=RapportUpdate(
                vehicles=[
                    {"vehicle_id": tlf.id, "present": True},
                    {"vehicle_id": mtw.id, "present": False},
                ]
            ),
        )
        assert {row["name"]: row["present"] for row in saved["vehicles"]} == {"TLF 1": True, "MTW": False}

        # And it is still there on the next GET, not recomputed from the board.
        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert {row["name"]: row["present"] for row in view["vehicles"]} == {"TLF 1": True, "MTW": False}

    @pytest.mark.asyncio
    async def test_a_vehicle_that_left_the_fleet_survives_when_it_was_ticked(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The crew said it was there; deleting the row would lose exactly the
        # answer the checklist exists to capture.
        incident = await _incident(db_session, test_event, test_user)
        await _report(
            db_session,
            incident,
            vehicles_json=[
                {
                    "vehicle_id": str(uuid.uuid4()),
                    "name": "MTW",
                    "present": True,
                }
            ],
        )

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert len(view["vehicles"]) == 1
        assert view["vehicles"][0]["name"] == "MTW"
        assert view["vehicles"][0]["present"] is True
        assert view["vehicles"][0]["on_board"] is False

    @pytest.mark.asyncio
    async def test_a_vehicle_that_left_the_fleet_drops_when_it_was_unticked(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # An unticked row for a vehicle nobody owns any more says nothing.
        incident = await _incident(db_session, test_event, test_user)
        await _report(
            db_session,
            incident,
            vehicles_json=[
                {
                    "vehicle_id": str(uuid.uuid4()),
                    "name": "Nie angefasst",
                    "present": False,
                }
            ],
        )

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["vehicles"] == []

    @pytest.mark.asyncio
    async def test_the_untouched_rest_of_the_fleet_is_not_written_down(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Storing a whole unticked fleet would freeze a default as a decision:
        # a vehicle the KP assigns ten minutes later would stay unticked.
        incident = await _incident(db_session, test_event, test_user)
        tlf = await self._vehicle(db_session, "TLF 1", display_order=1)
        mtw = await self._vehicle(db_session, "MTW", display_order=2)
        await _assign(db_session, incident, "vehicle", tlf.id)
        actor = await self._actor(db_session)

        await crud.save_rapport(
            db_session,
            incident,
            actor=actor,
            payload=RapportUpdate(vehicles=[{"vehicle_id": tlf.id, "present": True}]),
        )
        stored = (await crud._rapport_states(db_session, [incident.id]))[incident.id]
        assert [row["name"] for row in stored.vehicles_json or []] == ["TLF 1"]

        # …and once the board catches up, the newly assigned vehicle arrives ticked.
        await _assign(db_session, incident, "vehicle", mtw.id)
        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert {row["name"]: row["present"] for row in view["vehicles"]} == {"TLF 1": True, "MTW": True}

    @pytest.mark.asyncio
    async def test_submitting_freezes_the_prefilled_list_even_if_nobody_touched_it(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        tlf = await self._vehicle(db_session, "TLF 1")
        await _assign(db_session, incident, "vehicle", tlf.id)
        actor = await self._actor(db_session)

        await crud.save_rapport(db_session, incident, actor=actor, payload=RapportUpdate(is_draft=False))

        stored = (await crud._rapport_states(db_session, [incident.id]))[incident.id]
        assert [row["name"] for row in stored.vehicles_json or []] == ["TLF 1"]


class TestMaterialReturnUnits:
    """ "Material zurück – freigeben" (decision 17) — a read, never a write."""

    async def _submitted(
        self, db: AsyncSession, incident: Incident, rows: list[dict[str, object]]
    ) -> SchadenplatzReport:
        report = await _report(db, incident, materials_json=rows)
        report.is_draft = False
        report.submitted_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(report)
        return report

    @pytest.mark.asyncio
    async def test_draft_offers_nothing_to_the_release_list(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        """The default stays strict: one click there frees a unit (§18.23)."""
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe")
        assignment = await _assign(db_session, incident, "material", pump.id)
        await _report(
            db_session,
            incident,
            materials_json=[
                {
                    "assignment_id": str(assignment.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe",
                    "consumable": False,
                    "used": True,
                    "left_on_site": False,
                }
            ],
        )

        returned, left = await crud.material_return_units(db_session, incident)
        assert returned == [] and left == []

    @pytest.mark.asyncio
    async def test_splits_returned_from_left_and_excludes_consumables(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe")
        saw = await _material(db_session, "Motorsäge")
        foam = await _material(db_session, "Ölbindemittel", consumable=True)
        pump_a = await _assign(db_session, incident, "material", pump.id)
        saw_a = await _assign(db_session, incident, "material", saw.id)
        foam_a = await _assign(db_session, incident, "material", foam.id)

        await self._submitted(
            db_session,
            incident,
            [
                {
                    "assignment_id": str(pump_a.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe",
                    "consumable": False,
                    "used": True,
                    "left_on_site": True,
                },
                {
                    "assignment_id": str(saw_a.id),
                    "material_id": str(saw.id),
                    "name": "Motorsäge",
                    "consumable": False,
                    "used": True,
                    "left_on_site": False,
                },
                {
                    "assignment_id": str(foam_a.id),
                    "material_id": str(foam.id),
                    "name": "Ölbindemittel",
                    "consumable": True,
                    "used": True,
                    "left_on_site": False,
                },
            ],
        )

        returned, left = await crud.material_return_units(db_session, incident)
        assert [unit["name"] for unit in returned] == ["Motorsäge"]
        assert [unit["name"] for unit in left] == ["Tauchpumpe"]

    @pytest.mark.asyncio
    async def test_already_released_units_are_gone_from_both_lists(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        saw = await _material(db_session, "Motorsäge")
        saw_a = await _assign(db_session, incident, "material", saw.id, released=True)
        await self._submitted(
            db_session,
            incident,
            [
                {
                    "assignment_id": str(saw_a.id),
                    "material_id": str(saw.id),
                    "name": "Motorsäge",
                    "consumable": False,
                    "used": True,
                    "left_on_site": False,
                }
            ],
        )

        returned, left = await crud.material_return_units(db_session, incident)
        assert returned == [] and left == []

    @pytest.mark.asyncio
    async def test_a_filed_rapport_answers_every_unit_on_its_checklist(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        """Since §18.32 the verdict comes from the rapport, not from a third value.

        `used` no longer has a "keine Angabe" state, so an untouched material row
        cannot be told from a deliberate *ja*. Filing the rapport is what settles
        the checklist — that is what filing means — so the completion gate may
        prefill every unit on a submitted one.
        """
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe")
        ladder = await _material(db_session, "Schiebleiter")
        pump_a = await _assign(db_session, incident, "material", pump.id)
        ladder_a = await _assign(db_session, incident, "material", ladder.id)

        await self._submitted(
            db_session,
            incident,
            [
                {
                    "assignment_id": str(pump_a.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe",
                    "consumable": False,
                    "used": True,
                    "left_on_site": False,
                },
                {
                    "assignment_id": str(ladder_a.id),
                    "material_id": str(ladder.id),
                    "name": "Schiebleiter",
                    "consumable": False,
                    "used": False,
                    "left_on_site": False,
                },
            ],
        )

        returned, left = await crud.material_return_units(db_session, incident)
        assert {unit["name"]: unit["answered"] for unit in returned} == {
            "Tauchpumpe": True,
            "Schiebleiter": True,
        }
        assert left == []

    @pytest.mark.asyncio
    async def test_left_on_site_counts_as_answered(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe")
        pump_a = await _assign(db_session, incident, "material", pump.id)
        await self._submitted(
            db_session,
            incident,
            [
                {
                    "assignment_id": str(pump_a.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe",
                    "consumable": False,
                    "used": None,
                    "left_on_site": True,
                }
            ],
        )

        _, left = await crud.material_return_units(db_session, incident)
        assert [unit["answered"] for unit in left] == [True]


class TestMaterialReturnAttribution:
    """ "Aus dem Rapport von Muster Hans" — whose word the operator confirms."""

    @pytest.mark.asyncio
    async def test_a_draft_attributes_nothing(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user)
        person = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()
        await _report(db_session, incident, created_by_personnel_id=person.id)

        assert await crud.material_return_attribution(db_session, incident) == (None, None, False)

    @pytest.mark.asyncio
    async def test_names_the_last_person_to_touch_the_report(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        """Several crews amend one report; the checklist is the last one's work."""
        incident = await _incident(db_session, test_event, test_user)
        first = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        second = Personnel(id=uuid.uuid4(), name="Roth Til", role="Gruppenführer", status="available")
        db_session.add_all([first, second])
        await db_session.commit()

        report = await _report(
            db_session,
            incident,
            created_by_personnel_id=first.id,
            updated_by_personnel_id=second.id,
        )
        report.is_draft = False
        report.submitted_at = datetime.now(UTC)
        await db_session.commit()

        name, submitted_at, is_draft = await crud.material_return_attribution(db_session, incident)
        assert name == "Roth Til"
        assert submitted_at is not None
        assert is_draft is False

    @pytest.mark.asyncio
    async def test_falls_back_to_the_creator(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user)
        person = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()

        report = await _report(db_session, incident, created_by_personnel_id=person.id)
        report.is_draft = False
        await db_session.commit()

        name, _at, _draft = await crud.material_return_attribution(db_session, incident)
        assert name == "Muster Hans"


class TestDraftPrefillsTheCompletionGate:
    """A draft rapport answers the completion gate too (§18.23).

    The bug: a crew fills the material checklist on `/feld` and — on a phone, in
    the rain — never presses *Rapport abschliessen*. The rapport stays a draft,
    ``material_return_units`` refused to look at it, and the operator was asked
    "Material vor Ort oder ins Magazin?" from scratch about units the crew had
    already answered. That is the complaint, and the phone is where it keeps
    happening.

    The two call sites diverge here and nowhere else: the completion gate
    prefills a question the operator still confirms, while the release list in
    the incident detail *releases assignments on one click* and stays
    submitted-only.
    """

    async def _draft_with(
        self, db: AsyncSession, incident: Incident, rows: list[dict[str, object]]
    ) -> SchadenplatzReport:
        return await _report(db, incident, materials_json=rows)

    @pytest.mark.asyncio
    async def test_a_draft_left_on_site_prefills_the_gate(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe Gr.")
        assignment = await _assign(db_session, incident, "material", pump.id)
        await self._draft_with(
            db_session,
            incident,
            [
                {
                    "assignment_id": str(assignment.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe Gr.",
                    "consumable": False,
                    # The crew ticked "vor Ort verblieben" and left `gebraucht`
                    # at its prefilled ja. That is an answered row even in a
                    # draft — it contradicts the board's default.
                    "used": True,
                    "left_on_site": True,
                }
            ],
        )

        returned, left = await crud.material_return_units(db_session, incident, include_draft=True)
        assert returned == []
        assert [unit["name"] for unit in left] == ["Tauchpumpe Gr."]
        assert left[0]["used"] is True
        assert left[0]["answered"] is True

    @pytest.mark.asyncio
    async def test_the_release_list_still_sees_nothing(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Same row, default flag. Releasing against a half-typed checklist is
        # how a pump gets freed while it is still running in a cellar.
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe Gr.")
        assignment = await _assign(db_session, incident, "material", pump.id)
        await self._draft_with(
            db_session,
            incident,
            [
                {
                    "assignment_id": str(assignment.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe Gr.",
                    "consumable": False,
                    "used": True,
                    "left_on_site": True,
                }
            ],
        )

        assert await crud.material_return_units(db_session, incident) == ([], [])

    @pytest.mark.asyncio
    async def test_a_draft_only_answers_what_the_crew_contradicted(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Reading drafts must not turn "nobody looked at it" into "Magazin".
        # In an UNFILED rapport the only evidence somebody looked is a tick that
        # differs from the prefill (§18.32), so that is what `answered` reports.
        incident = await _incident(db_session, test_event, test_user)
        pump = await _material(db_session, "Tauchpumpe")
        saw = await _material(db_session, "Motorsäge")
        pump_a = await _assign(db_session, incident, "material", pump.id)
        await _assign(db_session, incident, "material", saw.id)
        await self._draft_with(
            db_session,
            incident,
            [
                {
                    "assignment_id": str(pump_a.id),
                    "material_id": str(pump.id),
                    "name": "Tauchpumpe",
                    "consumable": False,
                    "used": False,
                    "left_on_site": False,
                }
            ],
        )

        returned, _left = await crud.material_return_units(db_session, incident, include_draft=True)
        answered = {unit["name"]: unit["answered"] for unit in returned}
        assert answered == {"Tauchpumpe": True, "Motorsäge": False}

    @pytest.mark.asyncio
    async def test_the_attribution_says_it_is_a_draft(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        person = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()
        await _report(db_session, incident, created_by_personnel_id=person.id)

        name, submitted_at, is_draft = await crud.material_return_attribution(db_session, incident, include_draft=True)
        assert name == "Muster Hans"
        # Never filed, so there is no filing time to show — only a draft.
        assert submitted_at is None
        assert is_draft is True


class TestConcurrentEditor:
    """Visibility, not a lock (§3, V-4)."""

    @pytest.mark.asyncio
    async def test_another_person_inside_the_window_shows(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        other = Personnel(id=uuid.uuid4(), name="Frey Marc", role="Offizier", status="available")
        db_session.add(other)
        await db_session.commit()
        await _report(db_session, incident, updated_by_personnel_id=other.id)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["concurrent_editor"] is not None
        assert view["concurrent_editor"]["name"] == "Frey Marc"
        assert view["concurrent_editor"]["in_kp"] is False

    @pytest.mark.asyncio
    async def test_my_own_save_is_not_a_concurrent_editor(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(me)
        await db_session.commit()
        await _report(db_session, incident, updated_by_personnel_id=me.id)

        actor = crud.FieldActor(personnel_id=me.id, personnel_name="Muster Hans")
        view = await crud.get_rapport(db_session, incident, actor=actor)
        assert view["concurrent_editor"] is None

    @pytest.mark.asyncio
    async def test_an_old_save_is_not_a_concurrent_editor(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        other = Personnel(id=uuid.uuid4(), name="Frey Marc", role="Offizier", status="available")
        db_session.add(other)
        await db_session.commit()
        report = await _report(db_session, incident, updated_by_personnel_id=other.id)
        report.updated_at = datetime.now(UTC) - timedelta(minutes=30)
        await db_session.commit()

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["concurrent_editor"] is None

    @pytest.mark.asyncio
    async def test_a_kp_editor_is_named_as_such(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user)
        await _report(db_session, incident, updated_by_user_id=test_user.id)

        view = await crud.get_rapport(db_session, incident, actor=ACTOR)
        assert view["concurrent_editor"] is not None
        assert view["concurrent_editor"]["in_kp"] is True


class TestFieldBriefing:
    """What the board knows, on the row a crew opens at the address (§18.22).

    Until the second field test `/feld` carried an address, an EL and two state
    chips — so a crew that arrived somewhere could not find out what had been
    dispatched with it or what the Reko had found.
    """

    @pytest.mark.asyncio
    async def test_the_row_carries_meldung_melder_and_what_was_dispatched(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        incident.description = "Wasser im Keller, Steigleitung defekt"
        incident.contact_phone = "079 000 00 00"
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        mate = Personnel(id=uuid.uuid4(), name="Frey Marc", role="Offizier", status="available")
        vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available")
        db_session.add_all([me, mate, vehicle])
        await db_session.commit()
        await _assign(db_session, incident, "personnel", me.id)
        await _assign(db_session, incident, "personnel", mate.id)
        await _assign(db_session, incident, "vehicle", vehicle.id)
        pump = await _material(db_session, "Tauchpumpe")
        await _assign(db_session, incident, "material", pump.id)
        await _assign(db_session, incident, "material", pump.id)

        rows = await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id)
        assert len(rows) == 1
        row = rows[0]
        assert row["description"] == "Wasser im Keller, Steigleitung defekt"
        assert row["contact"] == "A. Bürgin"
        assert row["contact_phone"] == "079 000 00 00"
        assert sorted(row["crew"]) == ["Frey Marc", "Muster Hans"]
        assert row["vehicles"] == ["TLF 1"]
        # Grouped by NAME: two units of one pump are "Tauchpumpe ×2".
        assert row["materials"] == [{"name": "Tauchpumpe", "count": 2}]

    @pytest.mark.asyncio
    async def test_a_released_crew_still_reads_its_own_briefing(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Completing an incident releases everything while the crew is still at
        # the address filing. A briefing that empties out underneath them is
        # worse than one naming a vehicle that has already driven off.
        incident = await _incident(db_session, test_event, test_user)
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available")
        db_session.add_all([me, vehicle])
        await db_session.commit()
        await _assign(db_session, incident, "personnel", me.id, released=True)
        await _assign(db_session, incident, "vehicle", vehicle.id, released=True)
        pump = await _material(db_session, "Tauchpumpe")
        await _assign(db_session, incident, "material", pump.id, released=True)

        row = (await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id))[0]
        assert row["is_active_assignment"] is False
        assert row["crew"] == ["Muster Hans"]
        assert row["vehicles"] == ["TLF 1"]
        assert row["materials"] == [{"name": "Tauchpumpe", "count": 1}]

    @pytest.mark.asyncio
    async def test_a_person_assigned_twice_is_one_name(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user)
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(me)
        await db_session.commit()
        await _assign(db_session, incident, "personnel", me.id, released=True)
        await _assign(db_session, incident, "personnel", me.id)

        row = (await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id))[0]
        assert row["crew"] == ["Muster Hans"]

    @pytest.mark.asyncio
    async def test_the_reko_is_summarised_with_its_dangers(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        from app.models import RekoReport

        incident = await _incident(db_session, test_event, test_user)
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        scout = Personnel(id=uuid.uuid4(), name="Frey Marc", role="Offizier", status="available")
        db_session.add_all([me, scout])
        await db_session.commit()
        await _assign(db_session, incident, "personnel", me.id)
        db_session.add(
            RekoReport(
                incident_id=incident.id,
                token="t",
                is_draft=False,
                summary_text="Keller 20 cm unter Wasser.",
                additional_notes="Zugang über Hinterhof.",
                dangers_json={"collapse": True, "electrical": True, "fire": False, "other_notes": "Kabel"},
                submitted_by_personnel_id=scout.id,
            )
        )
        await db_session.commit()

        row = (await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id))[0]
        assert row["reko"]["summary"] == "Keller 20 cm unter Wasser."
        assert row["reko"]["notes"] == "Zugang über Hinterhof."
        assert row["reko"]["submitted_by_name"] == "Frey Marc"
        # Only the true flags, and `other_notes` is free text — never a badge.
        assert row["reko"]["dangers"] == ["collapse", "electrical"]

    @pytest.mark.asyncio
    async def test_a_draft_reko_is_not_quoted_at_the_next_crew(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        from app.models import RekoReport

        incident = await _incident(db_session, test_event, test_user)
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(me)
        await db_session.commit()
        await _assign(db_session, incident, "personnel", me.id)
        db_session.add(RekoReport(incident_id=incident.id, token="t", is_draft=True, summary_text="halb getippt"))
        await db_session.commit()

        row = (await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id))[0]
        assert row["reko"] is None

    @pytest.mark.asyncio
    async def test_the_briefing_stays_scoped_to_my_own_schadenplaetze(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The briefing must not become a way around "visibility is only mine":
        # it is built from the SAME row set the list already returns.
        mine = await _incident(db_session, test_event, test_user, title="Meins")
        theirs = await _incident(db_session, test_event, test_user, title="Fremd")
        theirs.description = "Nicht für mich"
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        other = Personnel(id=uuid.uuid4(), name="Frey Marc", role="Offizier", status="available")
        db_session.add_all([me, other])
        await db_session.commit()
        await _assign(db_session, mine, "personnel", me.id)
        await _assign(db_session, theirs, "personnel", other.id)

        rows = await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id)
        assert [row["incident_id"] for row in rows] == [mine.id]
        assert all(row["description"] != "Nicht für mich" for row in rows)


class TestRapportOnlyAfterDisposition:
    """§18.27 — no rapport before the Schadenplatz was disponiert.

    Both `/feld` reads have to agree with the board: the row a crew opens, and
    the badge on the person picker that tells them how much is waiting. A badge
    counting Schadenplätze the crew cannot file for is a number that never
    reaches zero, and a number that never reaches zero stops being read.
    """

    @pytest.mark.asyncio
    async def test_the_row_says_whether_the_schadenplatz_was_ever_disponiert(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        dispatched = await _incident(db_session, test_event, test_user, title="Disponiert")
        never = await _incident(db_session, test_event, test_user, title="Nie")
        never.status = "incoming"
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(me)
        await db_session.commit()
        await _assign(db_session, dispatched, "personnel", me.id)
        await _assign(db_session, never, "personnel", me.id)

        rows = {
            row["incident_title"]: row
            for row in await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id)
        }
        assert rows["Disponiert"]["has_been_dispatched"] is True
        assert rows["Nie"]["has_been_dispatched"] is False

    @pytest.mark.asyncio
    async def test_the_picker_badge_counts_only_what_is_actually_owed(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        dispatched = await _incident(db_session, test_event, test_user, title="Disponiert")
        never = await _incident(db_session, test_event, test_user, title="Nie")
        never.status = "incoming"
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(me)
        await db_session.commit()
        await _assign(db_session, dispatched, "personnel", me.id)
        await _assign(db_session, never, "personnel", me.id)

        rows = await crud.get_feld_personnel_for_event(db_session, test_event.id)
        assert len(rows) == 1
        # Two Schadenplätze on the list, one rapport actually outstanding.
        assert rows[0]["incident_count"] == 2
        assert rows[0]["missing_rapport_count"] == 1

    @pytest.mark.asyncio
    async def test_a_rapport_filed_anyway_is_never_hidden(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Written work beats the gate — on the row and in the count alike.
        never = await _incident(db_session, test_event, test_user, title="Nie")
        never.status = "incoming"
        me = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db_session.add(me)
        await db_session.commit()
        await _assign(db_session, never, "personnel", me.id)
        await _report(db_session, never)

        rows = await crud.get_feld_assignments_for_personnel(db_session, test_event.id, me.id)
        assert rows[0]["rapport_state"] == "draft"
        picker = await crud.get_feld_personnel_for_event(db_session, test_event.id)
        assert picker[0]["missing_rapport_count"] == 1


class TestFieldActionsReachTheBoardLive:
    """Every field write pushes an `incident_update`, in both directions.

    The report was "Abholung erledigt kommt nicht durch". The transport turned
    out to be fine — but nothing asserted it, so the next change to
    ``record_pickup`` could have dropped the broadcast on the clearing path only
    and nobody would have noticed until a badge stayed on a board at 02:00.
    Both directions are the point: setting a pickup and clearing it are two
    different branches, and only one of them is the one people complained about.
    """

    async def _actor(self, db: AsyncSession) -> crud.FieldActor:
        """A filer that really exists — the pickup writes its personnel id."""
        person = Personnel(id=uuid.uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
        db.add(person)
        await db.commit()
        return crud.FieldActor(personnel_id=person.id, personnel_name=person.name)

    @pytest.mark.asyncio
    async def test_setting_and_clearing_a_pickup_both_broadcast(
        self, db_session: AsyncSession, test_event: Event, test_user: User, monkeypatch
    ):
        sent: list[tuple[dict, str]] = []

        async def fake_broadcast(payload, action):
            sent.append((payload, action))

        monkeypatch.setattr(crud, "broadcast_incident_update", fake_broadcast)
        incident = await _incident(db_session, test_event, test_user)
        actor = await self._actor(db_session)

        assert await crud.record_pickup(db_session, incident, actor=actor, needed=True, note="3 Personen")
        assert await crud.record_pickup(db_session, incident, actor=actor, needed=False)

        assert [action for _payload, action in sent] == ["update", "update"]
        assert [payload["pickup_needed"] for payload, _action in sent] == [True, False]
        # It carries the incident id and nothing a listener should read (see the
        # docstring on `_broadcast`): the client refetches, it does not parse.
        assert sent[0][0]["id"] == str(incident.id)

    @pytest.mark.asyncio
    async def test_a_no_op_pickup_stays_off_the_wire(
        self, db_session: AsyncSession, test_event: Event, test_user: User, monkeypatch
    ):
        # A crew tapping "Abholung nötig" twice must not make forty boards
        # refetch twice. `record_pickup` returns False and never reaches the
        # broadcast.
        sent: list[tuple[dict, str]] = []

        async def fake_broadcast(payload, action):
            sent.append((payload, action))

        monkeypatch.setattr(crud, "broadcast_incident_update", fake_broadcast)
        incident = await _incident(db_session, test_event, test_user)
        actor = await self._actor(db_session)

        assert await crud.record_pickup(db_session, incident, actor=actor, needed=True, note="3 Personen")
        assert not await crud.record_pickup(db_session, incident, actor=actor, needed=True, note="3 Personen")
        assert len(sent) == 1

    @pytest.mark.asyncio
    async def test_arrival_and_field_complete_broadcast_too(
        self, db_session: AsyncSession, test_event: Event, test_user: User, monkeypatch
    ):
        sent: list[tuple[dict, str]] = []

        async def fake_broadcast(payload, action):
            sent.append((payload, action))

        monkeypatch.setattr(crud, "broadcast_incident_update", fake_broadcast)
        incident = await _incident(db_session, test_event, test_user)
        actor = await self._actor(db_session)

        now = datetime.now(UTC)
        assert await crud.record_arrival(db_session, incident, actor=actor, at=now, only_if_unset=True)
        assert await crud.record_field_complete(db_session, incident, actor=actor, at=now)

        assert len(sent) == 2
        assert sent[-1][0]["field_complete_reported_at"] is not None
