"""Bodies whose response_model is a union or a stored document, pinned key for key.

These are the routes where a model could quietly add a key (a null where the handler left
one out) or drop one (a key of an older stored row the model does not name). Each test
compares the whole body, so either shows up as a diff.
"""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Event, EventSpecialFunction, Incident, IncidentAssignment, Personnel, Setting
from app.services import roster_snapshot_sync

pytestmark = pytest.mark.asyncio


async def test_demo_status_off_is_one_key(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "demo_mode", False)
    response = await client.get("/api/demo/status")
    assert response.json() == {"demo": False}


async def test_demo_status_on_names_the_next_reset(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    from app.background import demo_reset

    monkeypatch.setattr(settings, "demo_mode", True)
    monkeypatch.setattr(demo_reset, "get_next_reset_time", lambda: None)
    response = await client.get("/api/demo/status")
    assert response.json() == {
        "demo": True,
        "next_reset": None,
        "seconds_until_reset": 0,
        "reset_interval_hours": settings.demo_reset_hours,
    }


# A refused run with few keys – and keys from an older build.
SPARSE_STATUS = {
    "trigger": "scheduled",
    "outcome": {"schema": "roster-snapshot-outcome/1", "provider": "x", "refused": "kaputt", "unmatched": []},
    "held": False,
    "pendingDeactivations": 0,
    "lastAttempt": "2026-11-26T05:00:00+00:00",
    "lastError": "kaputt",
    "legacyKey": {"kept": True},
    # An older writer: a count as text, no sha256. Served as stored, never coerced or refused.
    "lastGood": {"provider": "x", "generatedAt": "2026-08-01T04:00:00+00:00", "count": "40"},
}


async def test_roster_snapshot_status_is_served_as_stored(
    editor_client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(roster_snapshot_sync, "configured", lambda: True)
    db_session.add(Setting(key=roster_snapshot_sync.STATUS_KEY, value=json.dumps(SPARSE_STATUS)))
    await db_session.commit()

    response = await editor_client.get("/api/integrations/roster-snapshot")

    assert response.json() == {
        "configured": True,
        "intervalMinutes": settings.roster_snapshot_interval_minutes,
        "maxDeactivatePct": settings.roster_snapshot_max_deactivate_pct,
        "status": SPARSE_STATUS,
    }


async def test_roster_snapshot_without_a_run_has_status_null(editor_client: AsyncClient):
    response = await editor_client.get("/api/integrations/roster-snapshot")
    assert response.json()["status"] is None


async def test_roster_snapshot_sync_answers_the_stored_report(
    admin_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    async def run(db, *, trigger, force=False, skip_unchanged=False):
        return SPARSE_STATUS

    monkeypatch.setattr(roster_snapshot_sync, "configured", lambda: True)
    monkeypatch.setattr(roster_snapshot_sync, "run", run)

    response = await admin_client.post("/api/integrations/roster-snapshot/sync", json={})

    assert response.json() == SPARSE_STATUS


async def test_divera_polling_status(editor_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    from app.services.divera_poller import divera_poller

    monkeypatch.setattr(type(divera_poller), "is_configured", property(lambda self: False))
    response = await editor_client.get("/api/divera/polling/status")
    assert response.json() == {
        "configured": False,
        "polling": False,
        "last_poll": None,
        "poll_count": divera_poller.stats["poll_count"],
        "error_count": divera_poller.stats["error_count"],
    }


async def test_gps_sim_stop_counts_the_drives(editor_client: AsyncClient):
    response = await editor_client.post("/api/training/gps-sim/stop", json={})
    assert response.json() == {"stopped": 0}


async def test_transfer_rekos_names_the_moved_incidents(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
    test_personnel: Personnel,
):
    successor = Personnel(id=uuid4(), name="Nachfolger", status="available")
    db_session.add(successor)
    db_session.add(EventSpecialFunction(event_id=test_event.id, personnel_id=test_personnel.id, function_type="reko"))
    db_session.add(
        IncidentAssignment(
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            purpose="reko",
            assigned_at=datetime.now(UTC) - timedelta(minutes=5),
        )
    )
    await db_session.commit()

    response = await editor_client.post(
        "/api/reko/transfer-rekos",
        params={
            "from_personnel_id": str(test_personnel.id),
            "to_personnel_id": str(successor.id),
            "event_id": str(test_event.id),
        },
    )

    assert response.json() == {"transferred_count": 1, "incident_ids": [str(test_incident.id)]}
