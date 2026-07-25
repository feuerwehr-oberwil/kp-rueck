"""Tests for the generic (provider-neutral) alarm intake API.

Covers POST /api/alarms:
- Shared-secret authentication (fail-closed, query param and header)
- Alarm creation and pool storage with source/source_id provenance
- Idempotent deduplication by (source, source_id)
- Reserved source slugs and payload validation
- Auto-attach behavior (same core as the Divera webhook)
- Divera webhook regression: rows now carry source="divera"
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DiveraEmergency, Event, Incident, Setting

SECRET = "test_secret"


@pytest_asyncio.fixture
async def webhook_secret(db_session: AsyncSession) -> str:
    """Configure the shared webhook secret."""
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


def alarm_payload(**overrides) -> dict:
    payload = {
        "source": "leitstelle",
        "source_id": "A-2026-001",
        "title": "FEUER Dachstockbrand",
        "text": "Starke Rauchentwicklung, Person im Gebäude vermutet",
        "address": "Hauptstrasse 12, 4410 Liestal",
        "lat": 47.4839,
        "lng": 7.7347,
        "number": "E-501",
    }
    payload.update(overrides)
    return payload


def _post(client: AsyncClient, payload: dict, secret: str | None = SECRET, header: bool = False):
    if secret is None:
        return client.post("/api/alarms", json=payload)
    if header:
        return client.post("/api/alarms", json=payload, headers={"X-Webhook-Secret": secret})
    return client.post(f"/api/alarms?secret={secret}", json=payload)


# ============================================
# Authentication
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_fails_closed_without_configured_secret(client: AsyncClient):
    """No alarm_webhook_secret in settings -> always 403 (unlike the Divera adapter)."""
    response = await _post(client, alarm_payload())
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_rejects_missing_secret(client: AsyncClient, webhook_secret: str):
    response = await _post(client, alarm_payload(), secret=None)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_rejects_wrong_secret(client: AsyncClient, webhook_secret: str):
    response = await _post(client, alarm_payload(), secret="wrong")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_accepts_secret_via_header(client: AsyncClient, webhook_secret: str):
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, alarm_payload(), header=True)
    assert response.status_code == 200
    assert response.json()["created"] is True


# ============================================
# Creation and pool storage
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_created_and_stored_with_provenance(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, alarm_payload())

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["created"] is True
    assert data["auto_attached_incident_id"] is None  # no auto-attach event

    row = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.id == data["emergency_id"]))
    ).scalar_one()
    assert row.source == "leitstelle"
    assert row.source_id == "A-2026-001"
    assert row.divera_id is None
    assert row.divera_number == "E-501"
    assert row.title == "FEUER Dachstockbrand"
    assert row.address == "Hauptstrasse 12, 4410 Liestal"
    assert float(row.latitude) == pytest.approx(47.4839)
    assert float(row.longitude) == pytest.approx(7.7347)
    assert row.is_training is False
    assert row.raw_payload_json["source"] == "leitstelle"


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_minimal_payload(client: AsyncClient, db_session: AsyncSession, webhook_secret: str):
    """Only a title is required; source defaults to "webhook"."""
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, {"title": "Wassereinbruch Keller"})

    assert response.status_code == 200
    data = response.json()
    row = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.id == data["emergency_id"]))
    ).scalar_one()
    assert row.source == "webhook"
    assert row.source_id is None
    assert row.divera_id is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_listed_in_pool(client: AsyncClient, webhook_secret: str, test_editor):
    """Generic alarms appear in the existing pool listing with their source."""
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, alarm_payload())
    assert response.status_code == 200

    login = await client.post("/api/auth/login", data={"username": "fixture_editor", "password": "testpassword1234"})
    assert login.status_code == 200

    listing = await client.get("/api/divera/emergencies")
    assert listing.status_code == 200
    emergencies = listing.json()["emergencies"]
    assert len(emergencies) == 1
    assert emergencies[0]["source"] == "leitstelle"
    assert emergencies[0]["source_id"] == "A-2026-001"
    assert emergencies[0]["divera_id"] is None


# ============================================
# Deduplication
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_redelivery_is_deduplicated(client: AsyncClient, db_session: AsyncSession, webhook_secret: str):
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        first = await _post(client, alarm_payload())
        second = await _post(client, alarm_payload(title="FEUER Dachstockbrand (Update)"))

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert second.json()["emergency_id"] == first.json()["emergency_id"]

    count = (await db_session.execute(select(func.count()).select_from(DiveraEmergency))).scalar_one()
    assert count == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_same_source_id_different_source_creates_both(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    """source_id is only unique per source — two senders may reuse ids."""
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        first = await _post(client, alarm_payload(source="leitstelle"))
        second = await _post(client, alarm_payload(source="alamos"))

    assert first.json()["created"] is True
    assert second.json()["created"] is True

    count = (await db_session.execute(select(func.count()).select_from(DiveraEmergency))).scalar_one()
    assert count == 2


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_without_source_id_always_creates(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        first = await _post(client, {"title": "Sturmschaden Baum"})
        second = await _post(client, {"title": "Sturmschaden Baum"})

    assert first.json()["created"] is True
    assert second.json()["created"] is True

    count = (await db_session.execute(select(func.count()).select_from(DiveraEmergency))).scalar_one()
    assert count == 2


# ============================================
# Validation
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("reserved", ["divera", "operator", "intake", "training", "manual"])
async def test_alarm_rejects_reserved_sources(client: AsyncClient, webhook_secret: str, reserved: str):
    response = await _post(client, alarm_payload(source=reserved))
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("bad_slug", ["Leitstelle", "leit stelle", "-leading", "ölwehr", ""])
async def test_alarm_rejects_invalid_source_slug(client: AsyncClient, webhook_secret: str, bad_slug: str):
    response = await _post(client, alarm_payload(source=bad_slug))
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_rejects_missing_title(client: AsyncClient, webhook_secret: str):
    response = await _post(client, {"source": "leitstelle"})
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_rejects_lat_without_lng(client: AsyncClient, webhook_secret: str):
    payload = alarm_payload()
    payload.pop("lng")
    response = await _post(client, payload)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_rejects_out_of_range_coordinates(client: AsyncClient, webhook_secret: str):
    response = await _post(client, alarm_payload(lat=91.0, lng=7.7))
    assert response.status_code == 422


# ============================================
# Auto-attach (same core as the Divera webhook)
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_auto_attaches_to_active_event(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str, auto_attach_event: Event
):
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, alarm_payload())

    assert response.status_code == 200
    data = response.json()
    assert data["auto_attached_incident_id"] is not None

    incident = (
        await db_session.execute(select(Incident).where(Incident.id == data["auto_attached_incident_id"]))
    ).scalar_one()
    assert incident.event_id == auto_attach_event.id
    assert incident.title == "FEUER Dachstockbrand"
    # Type and priority inferred by the shared intake core
    assert incident.type == "brandbekaempfung"
    assert incident.priority == "high"
    assert incident.status == "eingegangen"
    # Alarm provenance flows onto the board card
    assert incident.source == "leitstelle"
    assert incident.source_ref == "A-2026-001"

    row = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.id == data["emergency_id"]))
    ).scalar_one()
    assert row.attached_to_event_id == auto_attach_event.id
    assert str(row.created_incident_id) == data["auto_attached_incident_id"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_does_not_attach_to_training_event(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str
):
    event = Event(
        id=uuid4(),
        name="Übung KP",
        training_flag=True,
        auto_attach_divera=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()

    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, alarm_payload())

    assert response.status_code == 200
    assert response.json()["auto_attached_incident_id"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_redelivery_acks_attached_incident(
    client: AsyncClient, webhook_secret: str, auto_attach_event: Event
):
    """A redelivered alarm reports the incident its original delivery created."""
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        first = await _post(client, alarm_payload())
        second = await _post(client, alarm_payload())

    assert first.json()["auto_attached_incident_id"] is not None
    assert second.json()["created"] is False
    assert second.json()["auto_attached_incident_id"] == first.json()["auto_attached_incident_id"]


# ============================================
# Divera webhook regression
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_divera_webhook_rows_carry_divera_source(client: AsyncClient, db_session: AsyncSession):
    """The Divera adapter now stamps source="divera" / source_id=str(divera id)."""
    with patch("app.api.divera.broadcast_emergency_received", new_callable=AsyncMock):
        response = await client.post("/api/divera/webhook", json={"id": 424242, "title": "BMA Schulhaus"})

    assert response.status_code == 200
    row = (await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.divera_id == 424242))).scalar_one()
    assert row.source == "divera"
    assert row.source_id == "424242"


@pytest.mark.asyncio
@pytest.mark.api
async def test_manual_attach_carries_provenance(
    client: AsyncClient, db_session: AsyncSession, webhook_secret: str, test_editor
):
    """Manually attaching a generic alarm stamps source/source_ref on the incident."""
    with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
        response = await _post(client, alarm_payload())
    emergency_id = response.json()["emergency_id"]

    event = Event(id=uuid4(), name="Manual Attach Event", training_flag=False, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()

    login = await client.post("/api/auth/login", data={"username": "fixture_editor", "password": "testpassword1234"})
    assert login.status_code == 200

    attach = await client.post(f"/api/divera/emergencies/{emergency_id}/attach", json={"event_id": str(event.id)})
    assert attach.status_code == 201
    body = attach.json()
    assert body["source"] == "leitstelle"
    assert body["source_ref"] == "A-2026-001"

    incident = (await db_session.execute(select(Incident).where(Incident.id == body["id"]))).scalar_one()
    assert incident.source == "leitstelle"
    assert incident.source_ref == "A-2026-001"
