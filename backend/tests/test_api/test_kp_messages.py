"""«Meldung an den Trupp» — KP → field messages (sweep 27 §P3.2).

The mirror of the crew's Freitext-Meldung: one sentence, timestamped, with the
sender's display name. What is worth pinning: only an editor may send, the
message survives into the audit log AND the incident timeline, and the squad
reads it off its own polled `/feld` assignments payload — no new public surface.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Event, Incident, IncidentAssignment, Personnel
from tests.conftest import feld_device_token


async def _person(db: AsyncSession, name: str = "Brunner Marco") -> Personnel:
    person = Personnel(id=uuid.uuid4(), name=name, role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


class TestSendAndRead:
    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_editor_sends_and_the_thread_reads_it_back(
        self, editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession
    ):
        response = await editor_client.post(
            f"/api/incidents/{test_incident.id}/field-messages",
            json={"message": "Rückzug über die Hauptstrasse"},
        )
        assert response.status_code == 201
        created = response.json()
        assert created["message"] == "Rückzug über die Hauptstrasse"
        assert created["author_name"] == "fixture_editor"
        assert created["created_at"]

        listed = await editor_client.get(f"/api/incidents/{test_incident.id}/field-messages")
        assert listed.status_code == 200
        assert [m["message"] for m in listed.json()] == ["Rückzug über die Hauptstrasse"]

        # …and the Einsatztagebuch keeps it: an audit entry with source `kp`.
        audit = await db_session.execute(
            select(AuditLog).where(
                AuditLog.resource_id == test_incident.id,
                AuditLog.action_type == "kp_message",
            )
        )
        entry = audit.scalars().one()
        assert (entry.changes_json or {}).get("message") == "Rückzug über die Hauptstrasse"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_timeline_interleaves_it_as_kp_message(self, editor_client: AsyncClient, test_incident: Incident):
        await editor_client.post(
            f"/api/incidents/{test_incident.id}/field-messages",
            json={"message": "Material kommt mit dem Mowa"},
        )
        timeline = await editor_client.get(f"/api/incidents/{test_incident.id}/timeline")
        assert timeline.status_code == 200
        kp_events = [e for e in timeline.json()["events"] if e["event_type"] == "kp_message"]
        assert len(kp_events) == 1
        assert kp_events[0]["message"] == "Material kommt mit dem Mowa"
        assert kp_events[0]["actor_name"] == "fixture_editor"
        assert kp_events[0]["source"] == "kp"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_viewer_may_read_but_not_send(self, viewer_client: AsyncClient, test_incident: Incident):
        refused = await viewer_client.post(
            f"/api/incidents/{test_incident.id}/field-messages",
            json={"message": "sollte nicht gehen"},
        )
        assert refused.status_code == 403

        listed = await viewer_client.get(f"/api/incidents/{test_incident.id}/field-messages")
        assert listed.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_blank_message_is_refused(self, editor_client: AsyncClient, test_incident: Incident):
        response = await editor_client.post(
            f"/api/incidents/{test_incident.id}/field-messages",
            json={"message": "   "},
        )
        assert response.status_code == 422


class TestSquadReadsItOnFeld:
    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_assignments_payload_carries_the_message(
        self,
        editor_client: AsyncClient,
        test_incident: Incident,
        test_event: Event,
        db_session: AsyncSession,
    ):
        person = await _person(db_session)
        db_session.add(
            IncidentAssignment(
                incident_id=test_incident.id,
                resource_type="personnel",
                resource_id=person.id,
                purpose="crew",
            )
        )
        await db_session.commit()

        await editor_client.post(
            f"/api/incidents/{test_incident.id}/field-messages",
            json={"message": "Wartet auf den Elektriker"},
        )

        token = await feld_device_token(db_session, test_event.id, person.id)
        response = await editor_client.get(f"/api/feld/assignments/{person.id}?token={token}")
        assert response.status_code == 200
        rows = [a for a in response.json()["assignments"] if a["incident_id"] == str(test_incident.id)]
        assert len(rows) == 1
        assert [m["message"] for m in rows[0]["kp_messages"]] == ["Wartet auf den Elektriker"]
        assert rows[0]["kp_messages"][0]["author_name"] == "fixture_editor"
