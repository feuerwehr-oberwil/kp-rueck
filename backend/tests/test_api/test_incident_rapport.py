"""KP parity for the Schadenplatz-Rapport surface (plan 25, decision 28).

The regression net for the failure this plan exists to prevent: **a field
surface the KP cannot substitute for**. The normal case is a radio message — the
crew has no signal, no phone or no hands and dictates — so everything a crew can
tap on `/feld` an editor must be able to enter from the board, landing in the
*same columns*, through the *same CRUD module*.

Structure, so later phases extend rather than rewrite:

* ``TestFieldReportParity``   — phase 1: arrived / complete / pickup (this file's core)
* ``TestProvenance``          — the "never faked" rule, both directions
* ``TestPickupSurvivesComplete`` — the one interaction with the board's own cascade

Phase 2 adds ``TestRapportParity`` (the form itself) next to these; the §6.1
table in the plan is the checklist it has to satisfy.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Event, Incident, IncidentAssignment, Personnel, SchadenplatzReport, User
from app.services.tokens import generate_feld_token


async def _make_person(db: AsyncSession, name: str) -> Personnel:
    person = Personnel(id=uuid4(), name=name, role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _make_incident(db: AsyncSession, event: Event, user: User, title: str = "Keller Wasser") -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title} 1, Oberwil",
        status="active",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _assign(db: AsyncSession, incident: Incident, person: Personnel) -> IncidentAssignment:
    assignment = IncidentAssignment(
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=person.id,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


async def _report(db: AsyncSession, incident: Incident) -> SchadenplatzReport | None:
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    return result.scalar_one_or_none()


class TestFieldReportParity:
    """Every phase-1 field action, done from the board by an editor."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_editor(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        response = await client.post(f"/api/incidents/{incident.id}/field-report", json={"pickup_needed": True})
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_incident_is_404(self, editor_client: AsyncClient):
        response = await editor_client.post(f"/api/incidents/{uuid4()}/field-report", json={"pickup_needed": True})
        assert response.status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_arrival_lands_in_the_same_column_as_the_field_path(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # "Angekommen" over the radio. It has to reach schadenplatz_reports —
        # the same row /feld upserts — not a second place.
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 14, tzinfo=UTC)

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": at.isoformat()},
        )
        assert response.status_code == 200
        assert response.json()["arrived_at"] is not None

        report = await _report(db_session, incident)
        assert report is not None
        assert report.arrived_at == at
        assert report.is_draft is True

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_field_complete_is_writable_from_the_board(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The writer that did not exist: until this endpoint, an operator taking
        # "Einsatz beendet" over the radio had nowhere to put it — the only code
        # that could set the column was the training simulator.
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 40, tzinfo=UTC)

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"field_complete_reported_at": at.isoformat()},
        )
        assert response.status_code == 200

        await db_session.refresh(incident)
        assert incident.field_complete_reported_at == at
        # Reporting is not closing (§3).
        assert incident.status == "active"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pickup_set_and_cleared(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)

        set_response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "3 Personen zu Fuss"},
        )
        assert set_response.status_code == 200
        body = set_response.json()
        assert body["pickup_needed"] is True
        assert body["pickup_note"] == "3 Personen zu Fuss"
        assert body["pickup_requested_at"] is not None

        cleared = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": False},
        )
        assert cleared.status_code == 200
        assert cleared.json()["pickup_needed"] is False
        assert cleared.json()["pickup_note"] is None

        await db_session.refresh(incident)
        assert incident.pickup_needed is False
        assert incident.pickup_requested_at is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_absent_field_is_left_alone(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Absent means "leave it", null means "clear it". Without that
        # distinction an operator amending the pickup note would silently wipe
        # the arrival time.
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 14, tzinfo=UTC)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": at.isoformat(), "field_complete_reported_at": at.isoformat()},
        )

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True},
        )
        assert response.status_code == 200
        assert response.json()["arrived_at"] is not None
        assert response.json()["field_complete_reported_at"] is not None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_null_clears(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 14, tzinfo=UTC)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": at.isoformat(), "field_complete_reported_at": at.isoformat()},
        )

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": None, "field_complete_reported_at": None},
        )
        assert response.status_code == 200
        assert response.json()["arrived_at"] is None
        assert response.json()["field_complete_reported_at"] is None

        await db_session.refresh(incident)
        assert incident.field_complete_reported_at is None
        assert incident.field_complete_reported_by is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_get_returns_the_same_state(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "Ecke Hauptstrasse"},
        )

        response = await editor_client.get(f"/api/incidents/{incident.id}/field-report")
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is True
        assert response.json()["pickup_note"] == "Ecke Hauptstrasse"


class TestProvenance:
    """ "Never faked" (decision 28), asserted in both directions.

    A KP-entered report must not look like a crew-filed one, and a crew-filed
    one must not look like the operator's. The personnel FKs are the field
    side's; the audit log is the KP's.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_kp_write_leaves_the_personnel_columns_null_and_names_the_user(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 40, tzinfo=UTC)

        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={
                "arrived_at": at.isoformat(),
                "field_complete_reported_at": at.isoformat(),
                "pickup_needed": True,
                "pickup_note": "abholen",
            },
        )

        await db_session.refresh(incident)
        # No operator is ever guessed to be a firefighter — a wrong attribution
        # on a billing document is worse than no attribution.
        assert incident.field_complete_reported_by is None
        assert incident.pickup_requested_by is None
        report = await _report(db_session, incident)
        assert report is not None
        assert report.created_by_personnel_id is None
        assert report.created_by_user_id == test_editor.id
        assert report.updated_by_personnel_id is None
        assert report.updated_by_user_id == test_editor.id

        # The user reaches the record through the audit log instead.
        entries = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.action_type.in_(["field_arrived", "field_complete"]))
                )
            )
            .scalars()
            .all()
        )
        assert entries
        assert all(entry.user_id == test_editor.id for entry in entries)
        assert all(entry.changes_json is not None and entry.changes_json["source"] == "kp" for entry in entries)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_field_write_is_the_mirror_image(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        params = {"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)}

        await client.post(f"/api/feld/incidents/{incident.id}/arrived", params=params)
        await client.post(f"/api/feld/incidents/{incident.id}/complete", params=params)
        await client.post(
            f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True, "note": "zu Fuss"}
        )

        await db_session.refresh(incident)
        assert incident.field_complete_reported_by == person.id
        assert incident.pickup_requested_by == person.id
        report = await _report(db_session, incident)
        assert report is not None
        assert report.created_by_personnel_id == person.id
        assert report.created_by_user_id is None

        entries = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.action_type.in_(["field_arrived", "field_complete"]))
                )
            )
            .scalars()
            .all()
        )
        assert entries
        assert all(entry.user_id is None for entry in entries)
        assert all(entry.changes_json is not None and entry.changes_json["source"] == "feld" for entry in entries)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_kp_amendment_takes_over_the_updated_by_pair(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        # A mixed report (crew filed, KP amended) must show the KP as the last
        # writer without erasing that the crew created it.
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        await client.post(
            f"/api/feld/incidents/{incident.id}/arrived",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
        )

        corrected = datetime(2026, 8, 8, 22, 5, tzinfo=UTC)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": corrected.isoformat()},
        )

        report = await _report(db_session, incident)
        assert report is not None
        await db_session.refresh(report)
        assert report.created_by_personnel_id == person.id  # the crew created it
        assert report.updated_by_user_id == test_editor.id  # the KP corrected it
        assert report.updated_by_personnel_id is None
        assert report.arrived_at == corrected


class TestBothDirections:
    """What one door sets, the other reads and can clear."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_kp_clears_what_the_field_reported(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        await client.post(
            f"/api/feld/incidents/{incident.id}/pickup",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"needed": True, "note": "zu Fuss"},
        )

        response = await editor_client.post(f"/api/incidents/{incident.id}/field-report", json={"pickup_needed": False})
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_field_clears_what_the_kp_entered(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The crew tapping "abgeholt" on a pickup the operator entered from a
        # radio call.
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "abholen"},
        )

        response = await client.post(
            f"/api/feld/incidents/{incident.id}/pickup",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"needed": False},
        )
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_kp_can_report_arrival_for_an_incident_with_no_field_contact(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Nobody has ever opened /feld for this Schadenplatz. The operator still
        # has to be able to record what came over the radio.
        incident = await _make_incident(db_session, test_event, test_user, "Nie im Feld")
        assert await _report(db_session, incident) is None

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": datetime(2026, 8, 8, 21, 0, tzinfo=UTC).isoformat()},
        )
        assert response.status_code == 200
        assert await _report(db_session, incident) is not None


class TestPickupSurvivesComplete:
    """Decision 24's load-bearing half.

    Completing an incident auto-releases the personnel while the crew is
    physically still at the address. The open pickup flag is exactly the thing
    that has to outlive that release — otherwise the board forgets three people
    standing in the rain at the moment they most need collecting.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pickup_survives_the_transition_to_complete(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "3 Personen"},
        )

        transition = await editor_client.post(
            f"/api/incidents/{incident.id}/status",
            json={"from_status": "active", "to_status": "complete"},
        )
        assert transition.status_code == 200
        # The card is closed AND the flag is still there.
        assert transition.json()["status"] == "complete"
        assert transition.json()["pickup_needed"] is True
        assert transition.json()["pickup_note"] == "3 Personen"

        await db_session.refresh(incident)
        assert incident.pickup_needed is True
        assert incident.pickup_requested_at is not None
        # The personnel really were released — this is the state the flag has to
        # survive, not a case where nothing happened.
        assignments = (
            (await db_session.execute(select(IncidentAssignment).where(IncidentAssignment.incident_id == incident.id)))
            .scalars()
            .all()
        )
        assert all(a.unassigned_at is not None for a in assignments)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pickup_can_still_be_cleared_after_completion(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident.status = "complete"
        incident.pickup_needed = True
        incident.pickup_note = "warten noch"
        incident.pickup_requested_at = datetime.now(UTC) - timedelta(minutes=40)
        await db_session.commit()

        response = await editor_client.post(f"/api/incidents/{incident.id}/field-report", json={"pickup_needed": False})
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is False
