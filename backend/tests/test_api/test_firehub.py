"""Tests for the FireHub (Tercero) webhook adapter.

Covers POST /api/firehub/webhook:
- Shared-secret authentication (fail-closed), reused from the generic path
- Einsatzstart → pool alarm with source="firehub" and the FireHub field mapping
- Idempotent deduplication by opsID
- Auto-attach to the active event (same core as the generic/Divera webhook)
- Einsatzende → records an audit note, never moves the card or releases resources
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, DiveraEmergency, Event, Incident, Setting

SECRET = "test_secret"


@pytest_asyncio.fixture
async def webhook_secret(db_session: AsyncSession) -> str:
    db_session.add(Setting(key="alarm_webhook_secret", value=SECRET))
    await db_session.commit()
    return SECRET


@pytest_asyncio.fixture
async def auto_attach_event(db_session: AsyncSession) -> Event:
    """Active real event with auto-attach enabled."""
    event = Event(
        id=uuid4(),
        name="Unwetter Testdorf",
        training_flag=False,
        auto_attach_divera=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


def firehub_payload(action: str = "start", **op_overrides) -> dict:
    operation = {
        "opsID": 42,
        "opsNumber": 7,
        "category": "firealarm",
        "title": "Oberwil: Feueralarm",
        "street": "Teststrasse 112",
        "city": "Oberwil",
        "created": "2026-08-24T18:25:07.000Z",
    }
    operation.update(op_overrides)
    return {
        "operation": operation,
        "status": "OK",
        "trigger": {"type": "operation", "action": action, "techName": f"operation_{action}"},
    }


def _post(client: AsyncClient, payload: dict, secret: str | None = SECRET):
    if secret is None:
        return client.post("/api/firehub/webhook", json=payload)
    return client.post(f"/api/firehub/webhook?secret={secret}", json=payload)


# Authentication ------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_fails_closed_without_configured_secret(client: AsyncClient):
    response = await _post(client, firehub_payload())
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_rejects_wrong_secret(client: AsyncClient, webhook_secret: str):
    response = await _post(client, firehub_payload(), secret="wrong")
    assert response.status_code == 403


# Einsatzstart --------------------------------------------------------------------------


@pytest.mark.parametrize("action", ["pause", "restart", "unknown"])
async def test_unknown_action_cannot_create_an_alarm(client, db_session, webhook_secret, action):
    response = await _post(client, firehub_payload(action=action))
    assert response.status_code == 422
    assert (await db_session.scalars(select(DiveraEmergency))).all() == []
    assert (await db_session.scalars(select(Incident))).all() == []


async def test_lifecycle_actions_remain_case_insensitive(client, db_session, webhook_secret):
    response = await _post(client, firehub_payload(action="END", opsID=9999))
    assert response.status_code == 200
    assert response.json()["action"] == "end"
    assert (await db_session.scalars(select(DiveraEmergency))).all() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_start_creates_pool_alarm_with_mapping(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    with patch("app.api.firehub.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, firehub_payload())

    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "start"
    assert data["created"] is True
    assert data["auto_attached_incident_id"] is None  # no auto-attach event

    row = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.id == data["emergency_id"]))
    ).scalar_one()
    assert row.source == "firehub"
    assert row.source_id == "42"  # opsID, stringified
    assert row.divera_id is None
    assert row.divera_number == "7"  # opsNumber -> pool reference
    assert row.title == "Oberwil: Feueralarm"
    assert row.address == "Teststrasse 112, Oberwil"  # street + city composed
    # FireHub sends no coordinates today; the pin is geocoded downstream.
    assert row.latitude is None
    assert row.longitude is None
    # category is an English slug and intentionally not carried into the emergency text.
    assert row.raw_payload_json["source"] == "firehub"
    # `created` flows onto the alarm as `started_at` (exact ISO suffix is pydantic's business).
    assert row.raw_payload_json["started_at"].startswith("2026-08-24T18:25:07")


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_start_without_city_falls_back_to_street(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    """During the rollout window (before Tercero ships `city`) the address is street-only."""
    payload = firehub_payload()
    del payload["operation"]["city"]
    with patch("app.api.firehub.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, payload)

    row = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.id == response.json()["emergency_id"]))
    ).scalar_one()
    assert row.address == "Teststrasse 112"


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_start_redelivery_is_deduplicated(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    with patch("app.api.firehub.broadcast_emergency_received", new_callable=AsyncMock):
        first = await _post(client, firehub_payload())
        second = await _post(client, firehub_payload())

    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert second.json()["emergency_id"] == first.json()["emergency_id"]

    count = len((await db_session.execute(select(DiveraEmergency))).scalars().all())
    assert count == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_start_auto_attaches_to_active_event(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str, auto_attach_event: Event
):
    with patch("app.api.firehub.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, firehub_payload())

    data = response.json()
    assert data["auto_attached_incident_id"] is not None

    row = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.id == data["emergency_id"]))
    ).scalar_one()
    assert row.attached_to_event_id == auto_attach_event.id
    assert str(row.created_incident_id) == data["auto_attached_incident_id"]


# Einsatzende ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_end_notes_unclaimed_alarm_without_moving_it(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    """End writes an audit note and leaves the pool alarm exactly where it is."""
    with patch("app.api.firehub.broadcast_emergency_received", new_callable=AsyncMock):
        start = await _post(client, firehub_payload())
    emergency_id = start.json()["emergency_id"]

    end = await _post(client, firehub_payload(action="end"))
    assert end.status_code == 200
    assert end.json()["noted"] is True
    assert end.json()["emergency_id"] == emergency_id
    assert end.json()["incident_id"] is None  # never made it onto the board

    row = (await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.id == emergency_id))).scalar_one()
    assert row.is_archived is False  # "just note it" — no state change

    note = (
        await db_session.execute(select(AuditLog).where(AuditLog.action_type == "firehub_operation_end"))
    ).scalar_one()
    assert note.resource_type == "emergency"
    assert note.user_id is None  # system-attributed
    assert note.changes_json["ops_id"] == "42"


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_end_does_not_close_a_card_on_the_board(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str, auto_attach_event: Event
):
    """Closing a Schadenplatz stays the operator's decision — end never completes the card."""
    with patch("app.api.firehub.broadcast_emergency_received", new_callable=AsyncMock):
        start = await _post(client, firehub_payload())
    incident_id = start.json()["auto_attached_incident_id"]
    assert incident_id is not None

    end = await _post(client, firehub_payload(action="end"))
    assert end.json()["noted"] is True
    assert end.json()["incident_id"] == incident_id

    incident = (await db_session.execute(select(Incident).where(Incident.id == incident_id))).scalar_one()
    assert incident.status != "complete"  # untouched
    assert incident.completed_at is None

    note = (
        await db_session.execute(select(AuditLog).where(AuditLog.action_type == "firehub_operation_end"))
    ).scalar_one()
    assert note.resource_type == "incident"
    assert str(note.resource_id) == incident_id


@pytest.mark.asyncio
@pytest.mark.api
async def test_firehub_end_for_unknown_operation_is_noop(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    end = await _post(client, firehub_payload(action="end", opsID=9999))
    assert end.status_code == 200
    assert end.json()["noted"] is False
    assert end.json()["emergency_id"] is None

    notes = (
        (await db_session.execute(select(AuditLog).where(AuditLog.action_type == "firehub_operation_end")))
        .scalars()
        .all()
    )
    assert notes == []  # nothing recorded for an alarm we never saw
