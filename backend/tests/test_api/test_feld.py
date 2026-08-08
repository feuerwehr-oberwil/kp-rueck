"""Tests for `/api/feld` — the login-less field surface (plan 25, phase 0).

The load-bearing file of the phase. The token says *which Ereignis*; it never
says *who*, so every endpoint has to run step 2 as well: the caller's personnel
row must have an assignment on an incident in that event, active or released.
A hole in one handler is the realistic failure, which is why the 403 cases are
parametrized over the endpoint list rather than written once.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, IncidentAssignment, Personnel, SchadenplatzReport, User
from app.services.tokens import (
    generate_alarm_token,
    generate_checkin_token,
    generate_feld_token,
    generate_reko_dashboard_token,
    generate_viewer_token,
)

# Every endpoint that is scoped to one person, so a new phase adds a row here
# instead of quietly shipping an unguarded handler.
PERSON_SCOPED_ENDPOINTS = [
    "/api/feld/assignments/{personnel_id}",
]


async def _make_person(db: AsyncSession, name: str, role: str = "Feuerwehrmann") -> Personnel:
    person = Personnel(id=uuid4(), name=name, role=role, status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _make_incident(db: AsyncSession, event: Event, user: User, title: str) -> Incident:
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


async def _assign(
    db: AsyncSession,
    incident: Incident,
    person: Personnel,
    *,
    released: bool = False,
    is_leader: bool = False,
) -> IncidentAssignment:
    assignment = IncidentAssignment(
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=person.id,
        is_leader=is_leader,
        unassigned_at=datetime.now(UTC) if released else None,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


class TestGenerateLink:
    """POST /api/feld/generate-link is editor-only."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_auth(self, client: AsyncClient, test_event: Event):
        response = await client.post(f"/api/feld/generate-link?event_id={test_event.id}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_editor_gets_link(self, editor_client: AsyncClient, test_event: Event):
        response = await editor_client.post(f"/api/feld/generate-link?event_id={test_event.id}")
        assert response.status_code == 200
        body = response.json()
        assert body["token"]
        assert body["link"].startswith("/feld?token=")
        assert body["full_url"].endswith(body["link"])
        assert body["qr_code_data"] == body["link"]


class TestTokenGate:
    """Step 1: only a valid `feld` token opens the door."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_garbage_token(self, client: AsyncClient):
        response = await client.get("/api/feld/personnel?token=not-a-token")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize(
        "generator",
        [generate_checkin_token, generate_viewer_token, generate_reko_dashboard_token, generate_alarm_token],
        ids=["checkin", "viewer", "reko_dashboard", "alarm"],
    )
    async def test_other_token_types_rejected(self, client: AsyncClient, test_event: Event, generator):
        response = await client.get(f"/api/feld/personnel?token={generator(test_event.id)}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_event(self, client: AsyncClient):
        response = await client.get(f"/api/feld/personnel?token={generate_feld_token(uuid4())}")
        assert response.status_code == 404


class TestPersonnelList:
    """GET /api/feld/personnel — the picker, not the roster."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_lists_assigned_and_excludes_everyone_else(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Keller Wasser")
        assigned = await _make_person(db_session, "Muster Hans")
        released = await _make_person(db_session, "Frey Marc")
        await _make_person(db_session, "Nie Dabei")  # in the roster, never assigned
        await _assign(db_session, incident, assigned)
        await _assign(db_session, incident, released, released=True)

        response = await client.get(f"/api/feld/personnel?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        body = response.json()
        names = [p["name"] for p in body["personnel"]]

        assert names == ["Frey Marc", "Muster Hans"]  # alphabetical
        assert "Nie Dabei" not in names
        assert body["event_id"] == str(test_event.id)
        assert body["event_name"] == test_event.name

        by_name = {p["name"]: p for p in body["personnel"]}
        assert by_name["Muster Hans"]["incident_count"] == 1
        assert by_name["Muster Hans"]["open_count"] == 1
        assert by_name["Muster Hans"]["missing_rapport_count"] == 1
        # A released person still belongs in the picker — they file afterwards.
        assert by_name["Frey Marc"]["incident_count"] == 1
        assert by_name["Frey Marc"]["open_count"] == 0

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_personnel_from_another_event_are_not_listed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        other_event = Event(id=uuid4(), name="Anderes Ereignis", training_flag=False)
        db_session.add(other_event)
        await db_session.commit()

        mine = await _make_person(db_session, "Meins Max")
        theirs = await _make_person(db_session, "Fremd Franz")
        await _assign(db_session, await _make_incident(db_session, test_event, test_user, "A"), mine)
        await _assign(db_session, await _make_incident(db_session, other_event, test_user, "B"), theirs)

        response = await client.get(f"/api/feld/personnel?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        assert [p["name"] for p in response.json()["personnel"]] == ["Meins Max"]


class TestAuthorizationStepTwo:
    """Step 2: only my own Schadenplätze, enforced server-side (decision 4)."""

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("path", PERSON_SCOPED_ENDPOINTS)
    async def test_person_without_assignment_gets_403(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        path: str,
    ):
        # The event has work — just not for this person.
        incident = await _make_incident(db_session, test_event, test_user, "Fremde Stelle")
        await _assign(db_session, incident, await _make_person(db_session, "Muster Hans"))
        outsider = await _make_person(db_session, "Nie Dabei")

        url = path.format(personnel_id=outsider.id)
        response = await client.get(f"{url}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("path", PERSON_SCOPED_ENDPOINTS)
    async def test_unknown_personnel_id_gets_403_not_404(
        self,
        client: AsyncClient,
        test_event: Event,
        path: str,
    ):
        # A public token must not become a way to probe which UUIDs exist.
        url = path.format(personnel_id=uuid4())
        response = await client.get(f"{url}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("path", PERSON_SCOPED_ENDPOINTS)
    async def test_token_from_event_a_cannot_reach_event_b(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        path: str,
    ):
        event_b = Event(id=uuid4(), name="Ereignis B", training_flag=False)
        db_session.add(event_b)
        await db_session.commit()

        person = await _make_person(db_session, "Nur In B")
        await _assign(db_session, await _make_incident(db_session, event_b, test_user, "B-Stelle"), person)

        url = path.format(personnel_id=person.id)
        response = await client.get(f"{url}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 403
        assert response.status_code != 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_released_assignment_still_permits_access(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The crew files the rapport AFTER being released — requiring an active
        # assignment would lock out exactly the moment the page is for.
        incident = await _make_incident(db_session, test_event, test_user, "Schon Weg")
        person = await _make_person(db_session, "Spaet Filer")
        await _assign(db_session, incident, person, released=True)

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        rows = response.json()["assignments"]
        assert [r["incident_id"] for r in rows] == [str(incident.id)]
        assert rows[0]["is_active_assignment"] is False


class TestAssignments:
    """GET /api/feld/assignments/{personnel_id} — "meine Einsatzstellen"."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_only_my_incidents(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        mine = await _make_incident(db_session, test_event, test_user, "Meine Stelle")
        theirs = await _make_incident(db_session, test_event, test_user, "Fremde Stelle")
        person = await _make_person(db_session, "Muster Hans")
        other = await _make_person(db_session, "Frey Marc")
        await _assign(db_session, mine, person)
        await _assign(db_session, theirs, other)

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        body = response.json()
        assert body["personnel_name"] == "Muster Hans"
        assert body["event_name"] == test_event.name
        assert [r["incident_id"] for r in body["assignments"]] == [str(mine.id)]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_einsatzleiter_is_named_per_incident(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Decision 22: the EL is briefed before the form opens, and `is_leader`
        # belongs to ONE assignment — one incident's leader must never leak into
        # another incident's row.
        with_leader = await _make_incident(db_session, test_event, test_user, "Mit EL")
        without_leader = await _make_incident(db_session, test_event, test_user, "Ohne EL")
        person = await _make_person(db_session, "Muster Hans")
        leader = await _make_person(db_session, "Chef Karl", role="Offizier")
        await _assign(db_session, with_leader, person)
        await _assign(db_session, with_leader, leader, is_leader=True)
        await _assign(db_session, without_leader, person)

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        rows = {r["incident_id"]: r for r in response.json()["assignments"]}
        assert rows[str(with_leader.id)]["leader_name"] == "Chef Karl"
        assert rows[str(with_leader.id)]["leader_personnel_id"] == str(leader.id)
        assert rows[str(without_leader.id)]["leader_name"] is None
        assert rows[str(without_leader.id)]["leader_personnel_id"] is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_viewer_is_the_leader(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Ich bin EL")
        person = await _make_person(db_session, "Muster Hans", role="Offizier")
        await _assign(db_session, incident, person, is_leader=True)

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        row = response.json()["assignments"][0]
        assert row["leader_personnel_id"] == str(person.id)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_rapport_state_and_timestamps(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        none_yet = await _make_incident(db_session, test_event, test_user, "Nichts")
        draft = await _make_incident(db_session, test_event, test_user, "Entwurf")
        submitted = await _make_incident(db_session, test_event, test_user, "Erfasst")
        person = await _make_person(db_session, "Muster Hans")
        for incident in (none_yet, draft, submitted):
            await _assign(db_session, incident, person)

        arrived = datetime(2026, 8, 8, 14, 32, tzinfo=UTC)
        db_session.add(SchadenplatzReport(incident_id=draft.id, is_draft=True, arrived_at=arrived))
        db_session.add(SchadenplatzReport(incident_id=submitted.id, is_draft=False))
        submitted.field_complete_reported_at = datetime(2026, 8, 8, 15, 0, tzinfo=UTC)
        await db_session.commit()

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        rows = {r["incident_id"]: r for r in response.json()["assignments"]}
        assert rows[str(none_yet.id)]["rapport_state"] == "none"
        assert rows[str(draft.id)]["rapport_state"] == "draft"
        assert rows[str(submitted.id)]["rapport_state"] == "submitted"
        assert rows[str(draft.id)]["arrived_at"] is not None
        assert rows[str(none_yet.id)]["arrived_at"] is None
        assert rows[str(submitted.id)]["field_complete_reported_at"] is not None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_deleted_incidents_are_hidden(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Geloescht")
        alive = await _make_incident(db_session, test_event, test_user, "Aktiv")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        await _assign(db_session, alive, person)
        incident.deleted_at = datetime.now(UTC)
        await db_session.commit()

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        assert [r["incident_id"] for r in response.json()["assignments"]] == [str(alive.id)]


class TestReadOnly:
    """Phase 0 builds the door, not the form: nothing here writes."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_no_endpoint_touches_incident_assignments(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The boundary decisions 17 and 18 rest on: /feld never writes an
        # assignment, which is what keeps it out of the board's conflict model.
        incident = await _make_incident(db_session, test_event, test_user, "Unberuehrt")
        person = await _make_person(db_session, "Muster Hans")
        assignment = await _assign(db_session, incident, person)
        before = (assignment.id, assignment.unassigned_at, assignment.is_leader)

        token = generate_feld_token(test_event.id)
        assert (await client.get(f"/api/feld/personnel?token={token}")).status_code == 200
        assert (await client.get(f"/api/feld/assignments/{person.id}?token={token}")).status_code == 200

        rows = (await db_session.execute(select(IncidentAssignment))).scalars().all()
        assert len(rows) == 1
        assert (rows[0].id, rows[0].unassigned_at, rows[0].is_leader) == before
