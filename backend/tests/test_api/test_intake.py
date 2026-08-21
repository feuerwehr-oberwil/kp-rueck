"""Tests for the public token-gated alarm intake endpoints (/api/intake)."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident
from app.services.tokens import generate_alarm_token, generate_viewer_token

VALID_ALARM = {
    "title": "Wohnungsbrand Hauptstrasse 45",
    "type": "brandbekaempfung",
    "priority": "high",
    "location_address": "Hauptstrasse 45, Basel",
    "location_lat": "47.5596",
    "location_lng": "7.5886",
    "description": "Rauch aus dem 2. OG",
    "contact": "Hans Muster, 079 123 45 67",
    "internal_notes": "Zufahrt über den Hinterhof gesperrt",
}


class TestGenerateLink:
    """POST /api/intake/generate-link is editor-only."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_auth(self, client: AsyncClient, test_event: Event):
        response = await client.post(f"/api/intake/generate-link?event_id={test_event.id}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_editor_gets_link(self, editor_client: AsyncClient, test_event: Event):
        response = await editor_client.post(f"/api/intake/generate-link?event_id={test_event.id}")
        assert response.status_code == 200
        body = response.json()
        assert body["token"]
        assert body["link"].startswith("/alarm?token=")
        assert body["full_url"].endswith(body["link"])


class TestContext:
    """GET /api/intake/context validates the token and returns event info."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_invalid_token(self, client: AsyncClient):
        response = await client.get("/api/intake/context?token=not-a-token")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_wrong_token_type_rejected(self, client: AsyncClient, test_event: Event):
        # A viewer token must not unlock the intake context.
        token = generate_viewer_token(test_event.id)
        response = await client.get(f"/api/intake/context?token={token}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_valid_token(self, client: AsyncClient, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.get(f"/api/intake/context?token={token}")
        assert response.status_code == 200
        event = response.json()["event"]
        assert event["name"] == test_event.name
        assert event["id"] == str(test_event.id)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_event(self, client: AsyncClient):
        token = generate_alarm_token(uuid4())
        response = await client.get(f"/api/intake/context?token={token}")
        assert response.status_code == 404


class TestCreateAlarm:
    """POST /api/intake/alarm creates an intake-flagged incident without a user."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_invalid_token(self, client: AsyncClient):
        response = await client.post("/api/intake/alarm?token=bad", json=VALID_ALARM)
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_creates_intake_incident(self, client: AsyncClient, db_session: AsyncSession, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.post(f"/api/intake/alarm?token={token}", json=VALID_ALARM)
        assert response.status_code == 201
        new_id = response.json()["id"]

        incident = (await db_session.execute(select(Incident).where(Incident.id == new_id))).scalar_one()
        assert incident.event_id == test_event.id
        assert incident.source == "intake"
        assert incident.created_by is None
        assert incident.status == "incoming"
        assert incident.title == VALID_ALARM["title"]
        assert incident.contact == VALID_ALARM["contact"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_two_texts_land_in_their_own_columns(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """«Meldung» → `description`, «Weitere Hinweise» → `internal_notes`.

        The board reads those two columns as «Meldung» and «Notizen». The form
        used to have nowhere to put the second one, so the first was pushed into
        `title` — which a card only shows when it has no address, i.e. never for
        an alarm the caller could name a street for.
        """
        token = generate_alarm_token(test_event.id)
        response = await client.post(f"/api/intake/alarm?token={token}", json=VALID_ALARM)
        assert response.status_code == 201

        incident = (await db_session.execute(select(Incident).where(Incident.id == response.json()["id"]))).scalar_one()
        assert incident.description == VALID_ALARM["description"]
        assert incident.internal_notes == VALID_ALARM["internal_notes"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_overlong_notes_rejected(self, client: AsyncClient, test_event: Event):
        """Free text through a login-less door is capped, like the Meldung."""
        token = generate_alarm_token(test_event.id)
        response = await client.post(
            f"/api/intake/alarm?token={token}",
            json={**VALID_ALARM, "internal_notes": "x" * 2001},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_minimal_payload(self, client: AsyncClient, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.post(
            f"/api/intake/alarm?token={token}",
            json={"title": "Kurz", "type": "diverse_einsaetze", "priority": "low"},
        )
        assert response.status_code == 201

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_empty_title_rejected(self, client: AsyncClient, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.post(
            f"/api/intake/alarm?token={token}",
            json={"title": "   ", "type": "brandbekaempfung", "priority": "high"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_archived_event_rejected(self, client: AsyncClient, db_session: AsyncSession, test_event: Event):
        test_event.archived_at = datetime.now(UTC)
        await db_session.commit()
        token = generate_alarm_token(test_event.id)
        response = await client.post(f"/api/intake/alarm?token={token}", json=VALID_ALARM)
        assert response.status_code == 404
