"""Tests for `/api/feld` — the login-less field surface (plan 25, phases 0-1).

The load-bearing file of the phase. The token says *which Ereignis*; it never
says *who*, so every endpoint has to run step 2 as well: the caller's personnel
row must have an assignment on an incident in that event, active or released.
A hole in one handler is the realistic failure, which is why the 403 cases are
parametrized over the endpoint list rather than written once.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    Event,
    Incident,
    IncidentAssignment,
    Material,
    Notification,
    Personnel,
    SchadenplatzReport,
    User,
    Vehicle,
)
from app.services.photo_storage import photo_storage
from app.services.tokens import (
    generate_alarm_token,
    generate_checkin_token,
    generate_feld_token,
    generate_form_token,
    generate_reko_dashboard_token,
    generate_viewer_token,
)

# Every endpoint that is scoped to one person: (method, path, personnel_id is a
# query param, json body). A new phase adds a row here instead of quietly
# shipping an unguarded handler — the 403 suite and the "never writes an
# assignment" test both run off this list.
PERSON_SCOPED_ENDPOINTS: list[tuple[str, str, bool, dict[str, Any] | None]] = [
    ("GET", "/api/feld/assignments/{personnel_id}", False, None),
    ("POST", "/api/feld/incidents/{incident_id}/arrived", True, None),
    ("POST", "/api/feld/incidents/{incident_id}/complete", True, None),
    ("POST", "/api/feld/incidents/{incident_id}/pickup", True, {"needed": True, "note": "Zu Fuss unterwegs"}),
    ("POST", "/api/feld/incidents/{incident_id}/message", True, {"message": "Verstärkung nötig"}),
    ("GET", "/api/feld/incidents/{incident_id}/rapport", True, None),
    ("PUT", "/api/feld/incidents/{incident_id}/rapport", True, {"is_draft": True, "kurzbericht": "Keller ausgepumpt"}),
    ("POST", "/api/feld/incidents/{incident_id}/photos", True, None),
    ("DELETE", "/api/feld/incidents/{incident_id}/photos/{filename}", True, None),
]

ENDPOINT_IDS = [f"{spec[0]} {spec[1].rsplit('/', 1)[-1]}" for spec in PERSON_SCOPED_ENDPOINTS]

# The photo DELETE is the one row with no generic happy path: authorization
# passes and there is simply no such file on a rapport nobody has touched. 404
# is exactly the answer that proves step 2 did NOT refuse, which is what the
# sweeps below are checking.
_MISSING_FILENAME = "gibt-es-nicht.jpg"


def _expected_ok(spec: tuple[str, str, bool, dict[str, Any] | None]) -> tuple[int, ...]:
    return (404,) if spec[1].endswith("{filename}") else (200, 204)


def _one_pixel_jpeg() -> bytes:
    """A real JPEG — photo_storage validates magic bytes and decodes with PIL."""
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buffer, format="JPEG")
    return buffer.getvalue()


async def _call(
    client: AsyncClient,
    spec: tuple[str, str, bool, dict[str, Any] | None],
    *,
    token: str,
    personnel_id: UUID,
    incident_id: UUID,
) -> Response:
    """Fire one parametrized endpoint, whatever its shape."""
    method, path, personnel_in_query, body = spec
    url = path.format(personnel_id=personnel_id, incident_id=incident_id, filename=_MISSING_FILENAME)
    params = {"token": token}
    if personnel_in_query:
        params["personnel_id"] = str(personnel_id)
    if method == "POST" and url.endswith("/photos"):
        # Multipart, not JSON. The 403 sweeps never get this far, but the
        # happy-path sweep does and a real image is what makes it a real test.
        return await client.request(
            method,
            url,
            params=params,
            files={"file": ("feld.jpg", _one_pixel_jpeg(), "image/jpeg")},
        )
    return await client.request(method, url, params=params, json=body)


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


@pytest.fixture(autouse=True)
def _isolate_photo_storage(tmp_path, monkeypatch):
    """Keep uploaded test photos out of the repo's `data/photos`."""
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path / "photos")


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
    @pytest.mark.parametrize("spec", PERSON_SCOPED_ENDPOINTS, ids=ENDPOINT_IDS)
    async def test_person_without_assignment_gets_403(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        spec: tuple[str, str, bool, dict[str, Any] | None],
    ):
        # The event has work — just not for this person.
        incident = await _make_incident(db_session, test_event, test_user, "Fremde Stelle")
        await _assign(db_session, incident, await _make_person(db_session, "Muster Hans"))
        outsider = await _make_person(db_session, "Nie Dabei")

        response = await _call(
            client,
            spec,
            token=generate_feld_token(test_event.id),
            personnel_id=outsider.id,
            incident_id=incident.id,
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("spec", PERSON_SCOPED_ENDPOINTS, ids=ENDPOINT_IDS)
    async def test_unknown_personnel_id_gets_403_not_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        spec: tuple[str, str, bool, dict[str, Any] | None],
    ):
        # A public token must not become a way to probe which UUIDs exist.
        incident = await _make_incident(db_session, test_event, test_user, "Irgendwas")
        response = await _call(
            client,
            spec,
            token=generate_feld_token(test_event.id),
            personnel_id=uuid4(),
            incident_id=incident.id,
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("spec", PERSON_SCOPED_ENDPOINTS, ids=ENDPOINT_IDS)
    async def test_token_from_event_a_cannot_reach_event_b(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        spec: tuple[str, str, bool, dict[str, Any] | None],
    ):
        event_b = Event(id=uuid4(), name="Ereignis B", training_flag=False)
        db_session.add(event_b)
        await db_session.commit()

        person = await _make_person(db_session, "Nur In B")
        incident_b = await _make_incident(db_session, event_b, test_user, "B-Stelle")
        await _assign(db_session, incident_b, person)

        response = await _call(
            client,
            spec,
            token=generate_feld_token(test_event.id),
            personnel_id=person.id,
            incident_id=incident_b.id,
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("spec", PERSON_SCOPED_ENDPOINTS, ids=ENDPOINT_IDS)
    async def test_incident_i_am_not_on_gets_403(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        spec: tuple[str, str, bool, dict[str, Any] | None],
    ):
        # Assigned somewhere in this event, but not to THIS Schadenplatz. Step 2
        # is per incident, not per event — a valid person is not a valid caller.
        mine = await _make_incident(db_session, test_event, test_user, "Meine Stelle")
        theirs = await _make_incident(db_session, test_event, test_user, "Fremde Stelle")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, mine, person)
        await _assign(db_session, theirs, await _make_person(db_session, "Frey Marc"))

        response = await _call(
            client,
            spec,
            token=generate_feld_token(test_event.id),
            personnel_id=person.id,
            incident_id=theirs.id,
        )
        # The person-scoped GET legitimately succeeds (it is not incident-scoped);
        # every incident-scoped write must refuse.
        expected = 200 if spec[1].endswith("{personnel_id}") else 403
        assert response.status_code == expected

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("spec", PERSON_SCOPED_ENDPOINTS, ids=ENDPOINT_IDS)
    async def test_released_assignment_still_permits_everything(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        spec: tuple[str, str, bool, dict[str, Any] | None],
    ):
        # The crew files AFTER being released — requiring an active assignment
        # would lock out exactly the moment the page is for. This has to hold for
        # every action, not just the read.
        incident = await _make_incident(db_session, test_event, test_user, "Schon Weg")
        person = await _make_person(db_session, "Spaet Filer")
        await _assign(db_session, incident, person, released=True)

        response = await _call(
            client,
            spec,
            token=generate_feld_token(test_event.id),
            personnel_id=person.id,
            incident_id=incident.id,
        )
        assert response.status_code in _expected_ok(spec)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_released_assignment_is_listed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
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
    async def test_completed_incident_still_names_its_einsatzleiter(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The value case of decision 22. Completing an incident releases the crew
        # and clears `is_leader` from every row, so a finished Schadenplatz — the
        # only kind a crew opens to file a rapport — would read "kein EL erfasst"
        # for everybody. `Incident.leader_personnel_id` is what keeps the answer
        # (decision 29).
        incident = await _make_incident(db_session, test_event, test_user, "Fertig")
        incident.status = "complete"
        person = await _make_person(db_session, "Muster Hans")
        leader = await _make_person(db_session, "Chef Karl", role="Offizier")
        incident.leader_personnel_id = leader.id
        await _assign(db_session, incident, person, released=True)
        await _assign(db_session, incident, leader, released=True)
        await db_session.commit()

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        row = response.json()["assignments"][0]
        assert row["incident_id"] == str(incident.id)
        assert row["leader_name"] == "Chef Karl"
        assert row["leader_personnel_id"] == str(leader.id)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_active_flag_wins_over_the_recorded_leader(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Order matters: a running incident whose leader has changed since the
        # last stamp must show the person actually leading it now.
        incident = await _make_incident(db_session, test_event, test_user, "Läuft noch")
        old = await _make_person(db_session, "Alt Anton", role="Offizier")
        now_leading = await _make_person(db_session, "Neu Nadia", role="Offizier")
        incident.leader_personnel_id = old.id
        await _assign(db_session, incident, old, released=True)
        await _assign(db_session, incident, now_leading, is_leader=True)
        await db_session.commit()

        response = await client.get(f"/api/feld/assignments/{old.id}?token={generate_feld_token(test_event.id)}")
        row = response.json()["assignments"][0]
        assert row["leader_name"] == "Neu Nadia"

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


class TestNeverWritesAssignments:
    """The boundary decisions 17 and 18 rest on.

    `/feld` never writes an ``incident_assignments`` row — that is what keeps
    this surface out of the board's conflict model. Asserted directly rather
    than left to review, because it is exactly the kind of thing a later
    convenience change breaks silently.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_no_endpoint_touches_incident_assignments(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Unberuehrt")
        person = await _make_person(db_session, "Muster Hans")
        assignment = await _assign(db_session, incident, person, is_leader=True)
        before = (assignment.id, assignment.assigned_at, assignment.unassigned_at, assignment.is_leader)

        token = generate_feld_token(test_event.id)
        assert (await client.get(f"/api/feld/personnel?token={token}")).status_code == 200
        for spec in PERSON_SCOPED_ENDPOINTS:
            response = await _call(client, spec, token=token, personnel_id=person.id, incident_id=incident.id)
            assert response.status_code in _expected_ok(spec), (spec, response.text)
        # Clearing the pickup again, so the "cleared" branch is covered too.
        assert (
            await client.post(
                f"/api/feld/incidents/{incident.id}/pickup",
                params={"token": token, "personnel_id": str(person.id)},
                json={"needed": False},
            )
        ).status_code == 200

        rows = (await db_session.execute(select(IncidentAssignment))).scalars().all()
        assert len(rows) == 1
        assert (rows[0].id, rows[0].assigned_at, rows[0].unassigned_at, rows[0].is_leader) == before


class TestArrived:
    """POST /api/feld/incidents/{id}/arrived."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_creates_the_report_row_and_stamps_arrival(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Keller Wasser")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        response = await client.post(
            f"/api/feld/incidents/{incident.id}/arrived",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
        )
        assert response.status_code == 200
        assert response.json()["arrived_at"] is not None
        assert response.json()["arrived_by_personnel_id"] == str(person.id)
        assert response.json()["arrived_in_kp"] is False

        report = (
            await db_session.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
        ).scalar_one()
        assert report.arrived_at is not None
        # A row appears the moment somebody taps "Angekommen" — before any form
        # exists — so its default state must be "not yet filed".
        assert report.is_draft is True
        assert report.created_by_personnel_id == person.id
        assert report.created_by_user_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_is_idempotent(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # A crew re-opening the page and hitting the big button again must not
        # move a timestamp the KP has already acted on.
        incident = await _make_incident(db_session, test_event, test_user, "Keller Wasser")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        params = {"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)}

        first = await client.post(f"/api/feld/incidents/{incident.id}/arrived", params=params)
        second = await client.post(f"/api/feld/incidents/{incident.id}/arrived", params=params)
        assert first.status_code == second.status_code == 200
        assert first.json()["arrived_at"] == second.json()["arrived_at"]

        reports = (await db_session.execute(select(SchadenplatzReport))).scalars().all()
        assert len(reports) == 1
        notifications = (
            (await db_session.execute(select(Notification).where(Notification.type == "field_arrived"))).scalars().all()
        )
        assert len(notifications) == 1


class TestFieldComplete:
    """POST /api/feld/incidents/{id}/complete."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_stamps_both_columns_and_does_not_move_status(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The rule the column's own comment states: the field reports, the
        # operator decides to close. This is also the first real writer of
        # `field_complete_reported_at` — until now only the training simulator
        # could set it.
        incident = await _make_incident(db_session, test_event, test_user, "Sturmschaden")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        assert incident.status == "active"

        response = await client.post(
            f"/api/feld/incidents/{incident.id}/complete",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
        )
        assert response.status_code == 200

        await db_session.refresh(incident)
        assert incident.field_complete_reported_at is not None
        assert incident.field_complete_reported_by == person.id
        assert incident.status == "active"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_notifies_once(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Sturmschaden")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        params = {"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)}

        await client.post(f"/api/feld/incidents/{incident.id}/complete", params=params)
        await client.post(f"/api/feld/incidents/{incident.id}/complete", params=params)

        rows = (
            (await db_session.execute(select(Notification).where(Notification.type == "field_complete")))
            .scalars()
            .all()
        )
        assert len(rows) == 1


class TestPickup:
    """POST /api/feld/incidents/{id}/pickup — decision 24."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_set_and_clear(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Zu Fuss")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        params = {"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)}

        response = await client.post(
            f"/api/feld/incidents/{incident.id}/pickup",
            params=params,
            json={"needed": True, "note": "3 Personen, Ecke Hauptstrasse"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["pickup_needed"] is True
        assert body["pickup_note"] == "3 Personen, Ecke Hauptstrasse"
        assert body["pickup_requested_at"] is not None
        assert body["pickup_requested_by"] == str(person.id)

        # The only warning of the five: a waiting crew is time-critical.
        warning = (
            (await db_session.execute(select(Notification).where(Notification.type == "field_pickup"))).scalars().all()
        )
        assert [n.severity for n in warning] == ["warning"]

        cleared = await client.post(f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": False})
        assert cleared.status_code == 200
        assert cleared.json()["pickup_needed"] is False
        assert cleared.json()["pickup_note"] is None
        assert cleared.json()["pickup_requested_at"] is None
        assert cleared.json()["pickup_requested_by"] is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_waiting_time_survives_a_note_edit(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # At 02:00 the operationally decisive fact is how long they have been
        # waiting, so amending the note must not restart the clock.
        incident = await _make_incident(db_session, test_event, test_user, "Zu Fuss")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        params = {"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)}

        first = await client.post(
            f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True, "note": "2 Personen"}
        )
        second = await client.post(
            f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True, "note": "3 Personen"}
        )
        assert first.json()["pickup_requested_at"] == second.json()["pickup_requested_at"]
        assert second.json()["pickup_note"] == "3 Personen"


class TestFieldMessage:
    """POST /api/feld/incidents/{id}/message — bell AND Journal."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_creates_notification_and_audit_entry(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Keller Wasser")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        response = await client.post(
            f"/api/feld/incidents/{incident.id}/message",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"message": "Verstärkung nötig"},
        )
        assert response.status_code == 204

        notification = (
            (await db_session.execute(select(Notification).where(Notification.type == "field_message"))).scalars().one()
        )
        assert "Verstärkung nötig" in notification.message
        assert "Muster Hans" in notification.message
        assert notification.severity == "info"
        assert notification.incident_id == incident.id

        # The audit entry is how it survives into the Journal after somebody
        # dismisses the bell.
        entry = (
            (await db_session.execute(select(AuditLog).where(AuditLog.action_type == "field_message"))).scalars().one()
        )
        assert entry.resource_id == incident.id
        assert entry.changes_json is not None
        assert entry.changes_json["message"] == "Verstärkung nötig"
        # A field message has no User: the personnel row is the author.
        assert entry.user_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_empty_message_is_rejected(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Keller Wasser")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        response = await client.post(
            f"/api/feld/incidents/{incident.id}/message",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"message": ""},
        )
        assert response.status_code == 422


class TestMessageChips:
    """The station-configurable chips ride along on "meine Einsatzstellen"."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_defaults_are_served(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Keller Wasser")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        response = await client.get(f"/api/feld/assignments/{person.id}?token={generate_feld_token(test_event.id)}")
        assert response.status_code == 200
        chips = response.json()["message_chips"]
        # Station config, not i18n (decision 20).
        assert "Verstärkung nötig" in chips
        assert "" not in chips


class TestRapport:
    """GET/PUT /api/feld/incidents/{id}/rapport — the paper replacement."""

    async def _setup(
        self,
        db: AsyncSession,
        event: Event,
        user: User,
    ) -> tuple[Incident, Personnel, str]:
        incident = await _make_incident(db, event, user, "Keller Wasser")
        person = await _make_person(db, "Muster Hans")
        await _assign(db, incident, person)
        return incident, person, generate_feld_token(event.id)

    async def _material(self, db: AsyncSession, name: str, *, consumable: bool = False) -> Material:
        material = Material(
            id=uuid4(),
            name=name,
            type="Sonstiges",
            location="Depot",
            status="available",
            consumable=consumable,
        )
        db.add(material)
        await db.commit()
        await db.refresh(material)
        return material

    async def _assign_vehicle(self, db: AsyncSession, incident: Incident, name: str) -> IncidentAssignment:
        vehicle = Vehicle(id=uuid4(), name=name, type="TLF", status="available")
        db.add(vehicle)
        await db.commit()
        assignment = IncidentAssignment(
            incident_id=incident.id,
            resource_type="vehicle",
            resource_id=vehicle.id,
        )
        db.add(assignment)
        await db.commit()
        await db.refresh(assignment)
        return assignment

    async def _assign_material(self, db: AsyncSession, incident: Incident, material: Material) -> IncidentAssignment:
        assignment = IncidentAssignment(
            incident_id=incident.id,
            resource_type="material",
            resource_id=material.id,
        )
        db.add(assignment)
        await db.commit()
        await db.refresh(assignment)
        return assignment

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_get_prefills_without_writing_a_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident, person, token = await self._setup(db_session, test_event, test_user)

        response = await client.get(
            f"/api/feld/incidents/{incident.id}/rapport",
            params={"token": token, "personnel_id": str(person.id)},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["exists"] is False
        assert body["prefill"]["location_address"] == incident.location_address
        # A GET that computes and does not write: "kein Rapport" has to keep
        # meaning something after somebody looked at the form.
        assert (await db_session.execute(select(SchadenplatzReport))).scalars().all() == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_put_twice_creates_one_row_not_two(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # UNIQUE(incident_id) plus the upsert path. Two crews on one
        # Schadenplatz amend the same report; they never file competing ones.
        incident, person, token = await self._setup(db_session, test_event, test_user)
        params = {"token": token, "personnel_id": str(person.id)}

        first = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params=params,
            json={"is_draft": True, "kurzbericht": "Keller ausgepumpt"},
        )
        assert first.status_code == 200
        second = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params=params,
            json={"is_draft": True, "handed_over_to": "Hauswart"},
        )
        assert second.status_code == 200

        rows = (await db_session.execute(select(SchadenplatzReport))).scalars().all()
        assert len(rows) == 1
        # And a partial autosave does not blank what the previous one wrote.
        assert rows[0].kurzbericht == "Keller ausgepumpt"
        assert rows[0].handed_over_to == "Hauswart"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_submit_freezes_the_cost_snapshot_against_later_board_edits(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Decision 6, and the whole reason the snapshot exists: a later board
        # edit cannot silently change a filed rapport.
        incident, person, token = await self._setup(db_session, test_event, test_user)
        params = {"token": token, "personnel_id": str(person.id)}

        response = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params=params,
            json={"is_draft": False, "kurzbericht": "Keller ausgepumpt"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["is_draft"] is False
        assert body["submitted_at"] is not None
        snapshot = body["cost_snapshot_json"]
        assert [entry["name"] for entry in snapshot] == ["Muster Hans"]
        assert body["personnel_count"] == 1

        # The KP adds two more people afterwards.
        for name in ("Frey Marc", "Meier Anna"):
            extra = await _make_person(db_session, name)
            await _assign(db_session, incident, extra)

        after = await client.get(f"/api/feld/incidents/{incident.id}/rapport", params=params)
        assert after.status_code == 200
        assert after.json()["cost_snapshot_json"] == snapshot
        assert after.json()["personnel_count"] == 1
        # The board's own count moved; the filed number did not.
        assert after.json()["prefill"]["board_personnel_count"] == 3

        # A `rapport_submitted` bell entry, once.
        notifications = (
            (await db_session.execute(select(Notification).where(Notification.type == "rapport_submitted")))
            .scalars()
            .all()
        )
        assert len(notifications) == 1

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_corrected_count_is_marked_and_an_unchanged_one_is_not(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The divergence is itself information: it says the board was behind
        # reality. An agreeing number must not carry the marker, or the export's
        # "korrigiert" flag stops being a signal.
        incident, person, token = await self._setup(db_session, test_event, test_user)
        params = {"token": token, "personnel_id": str(person.id)}

        corrected = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params=params,
            json={"is_draft": True, "personnel_count": 6},
        )
        assert corrected.status_code == 200
        assert corrected.json()["personnel_count_corrected"] is True

        agreeing = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params=params,
            json={"is_draft": True, "personnel_count": 1},
        )
        assert agreeing.json()["personnel_count_corrected"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_material_checklist_round_trips_and_obeys_the_consumable_rule(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident, person, token = await self._setup(db_session, test_event, test_user)
        params = {"token": token, "personnel_id": str(person.id)}
        pump = await self._material(db_session, "Tauchpumpe TP-4")
        foam = await self._material(db_session, "Ölbindemittel", consumable=True)
        pump_assignment = await self._assign_material(db_session, incident, pump)
        foam_assignment = await self._assign_material(db_session, incident, foam)

        response = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params=params,
            json={
                "is_draft": True,
                "materials": [
                    {"assignment_id": str(pump_assignment.id), "used": True, "left_on_site": True},
                    # A consumable that was used is gone — it can never be left
                    # on site, even when the payload says so (decision 26).
                    {"assignment_id": str(foam_assignment.id), "used": True, "left_on_site": True},
                ],
            },
        )
        assert response.status_code == 200
        rows = {row["name"]: row for row in response.json()["materials"]}
        assert rows["Tauchpumpe TP-4"]["left_on_site"] is True
        assert rows["Ölbindemittel"]["consumable"] is True
        assert rows["Ölbindemittel"]["left_on_site"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_vehicle_checklist_prefills_ticked_and_unticking_round_trips(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The crew confirms WHICH vehicles, not how many. The board's answer is
        # already in the list, so the only thing the crew can add is a No.
        incident, person, token = await self._setup(db_session, test_event, test_user)
        params = {"token": token, "personnel_id": str(person.id)}
        tlf = await self._assign_vehicle(db_session, incident, "TLF 1")
        mtw = await self._assign_vehicle(db_session, incident, "MTW")

        opened = await client.get(f"/api/feld/incidents/{incident.id}/rapport", params=params)
        assert opened.status_code == 200
        assert {row["name"]: row["present"] for row in opened.json()["vehicles"]} == {"TLF 1": True, "MTW": True}

        saved = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params=params,
            json={
                "is_draft": True,
                "vehicles": [
                    {"assignment_id": str(tlf.id), "present": True},
                    {"assignment_id": str(mtw.id), "present": False},
                ],
            },
        )
        assert saved.status_code == 200
        assert {row["name"]: row["present"] for row in saved.json()["vehicles"]} == {"TLF 1": True, "MTW": False}

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_material_name_suggestions_are_names_without_ids(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # "Weiteres Material" stays free text: the autosuggest carries no ids
        # precisely so no client can turn it into a picker that would make
        # `/feld` a writer of assignments.
        incident, person, token = await self._setup(db_session, test_event, test_user)
        await self._material(db_session, "Zulu-Schaufel")

        response = await client.get(
            f"/api/feld/incidents/{incident.id}/rapport",
            params={"token": token, "personnel_id": str(person.id)},
        )
        assert response.status_code == 200
        suggestions = response.json()["prefill"]["material_name_suggestions"]
        assert "Zulu-Schaufel" in suggestions
        assert all(isinstance(name, str) for name in suggestions)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_owner_block_is_stored_as_typed(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The first citizen PII in kp-rueck (§9). It lives with the incident and
        # dies with it; the demo does NOT block it (decision 27).
        incident, person, token = await self._setup(db_session, test_event, test_user)
        response = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params={"token": token, "personnel_id": str(person.id)},
            json={
                "is_draft": True,
                "owner_name": "A. Bürgin",
                "owner_street": "Hauptstrasse 4",
                "owner_city": "Oberwil",
                "vehicle_plate": "BL 12345",
                "vehicle_model": "VW Golf",
            },
        )
        assert response.status_code == 200
        report = (await db_session.execute(select(SchadenplatzReport))).scalars().one()
        assert report.owner_name == "A. Bürgin"
        assert report.vehicle_plate == "BL 12345"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_released_crew_can_still_file(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The rapport is filed AFTER the crew leaves. Requiring an active
        # assignment would lock out exactly the moment the form is for.
        incident = await _make_incident(db_session, test_event, test_user, "Sturmschaden")
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person, released=True)

        response = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"is_draft": False, "kurzbericht": "Baum entfernt"},
        )
        assert response.status_code == 200
        assert response.json()["is_draft"] is False


class TestOwnerPrivacy:
    """§9 — the owner block and the token never reach a log line.

    Asserted against the source rather than by capturing logs: the failure this
    prevents is somebody ADDING a debug line during a storm, and a source scan
    catches that in review where a runtime assertion would only catch the paths
    a test happens to walk.
    """

    def test_no_log_call_in_api_feld_interpolates_owner_data_or_a_token(self):
        from pathlib import Path

        import app.api.feld as feld_module

        source = Path(feld_module.__file__).read_text(encoding="utf-8")
        offenders = [
            line.strip() for line in source.splitlines() if "logger." in line and ("owner_" in line or "token" in line)
        ]
        assert offenders == [], offenders


class TestPhotos:
    """Fotos on the Schadenplatz-Rapport — the field door (phase 3).

    Same storage as the Reko form, and deliberately **not** the same door:
    ``validate_form_token`` was not widened to accept feld tokens, because
    coupling two doors for the sake of one handler is how a token type stops
    meaning anything. The last two tests are that boundary.
    """

    async def _setup(self, db: AsyncSession, event: Event, user: User) -> tuple[Incident, Personnel, str]:
        incident = await _make_incident(db, event, user, "Keller Wasser")
        person = await _make_person(db, "Muster Hans")
        await _assign(db, incident, person)
        return incident, person, generate_feld_token(event.id)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_upload_then_delete_round_trip(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident, person, token = await self._setup(db_session, test_event, test_user)
        params = {"token": token, "personnel_id": str(person.id)}

        upload = await client.post(
            f"/api/feld/incidents/{incident.id}/photos",
            params=params,
            files={"file": ("keller.jpg", _one_pixel_jpeg(), "image/jpeg")},
        )
        assert upload.status_code == 200
        filename = upload.json()["filename"]
        assert filename
        assert upload.json()["photos"] == [filename]

        # The rapport GET carries them, so both mounts render the same list.
        rapport = await client.get(f"/api/feld/incidents/{incident.id}/rapport", params=params)
        assert rapport.status_code == 200
        assert rapport.json()["photos"] == [filename]
        # A photo is field contact, but it is not a filed rapport: the row
        # exists and stays a draft, so the Restliste still counts it as missing.
        assert rapport.json()["exists"] is True
        assert rapport.json()["is_draft"] is True

        removed = await client.delete(f"/api/feld/incidents/{incident.id}/photos/{filename}", params=params)
        assert removed.status_code == 200
        assert removed.json()["photos"] == []

        report = (
            await db_session.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
        ).scalar_one()
        assert report.photos_json == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_deleting_an_unknown_photo_is_404(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident, person, token = await self._setup(db_session, test_event, test_user)
        response = await client.delete(
            f"/api/feld/incidents/{incident.id}/photos/{_MISSING_FILENAME}",
            params={"token": token, "personnel_id": str(person.id)},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_feld_token_does_not_open_the_reko_photo_endpoints(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident, _person, token = await self._setup(db_session, test_event, test_user)
        response = await client.post(
            f"/api/reko/{incident.id}/photos",
            headers={"X-Reko-Token": token},
            files={"file": ("keller.jpg", _one_pixel_jpeg(), "image/jpeg")},
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_reko_form_token_does_not_open_the_feld_photo_endpoints(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident, person, _token = await self._setup(db_session, test_event, test_user)
        response = await client.post(
            f"/api/feld/incidents/{incident.id}/photos",
            params={"token": generate_form_token(str(incident.id)), "personnel_id": str(person.id)},
            files={"file": ("keller.jpg", _one_pixel_jpeg(), "image/jpeg")},
        )
        assert response.status_code == 401
