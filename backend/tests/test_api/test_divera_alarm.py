"""Tests for outbound Divera alarm (ausalarmierung).

Covers the endpoint gating (disabled / demo / training / not-configured),
recipient resolution (linked vs unlinked, assigned vs not), the success path
(with the Divera client mocked), and the service-level safety quirks
(notification_type=4, send_pager=False, HTTP 200 + success:false = failure).

No test ever performs a real Divera HTTP call: the service is either mocked or
patched, and no access key is configured unless a test sets one explicitly.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Event, Incident, IncidentAssignment, Personnel, Setting
from app.services import divera_alarm


@pytest_asyncio.fixture
async def alarm_event(db_session: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Alarm Event", training_flag=False, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def alarm_incident(db_session: AsyncSession, alarm_event: Event) -> Incident:
    incident = Incident(
        id=uuid4(),
        event_id=alarm_event.id,
        title="Wohnungsbrand",
        type="brandbekaempfung",
        priority="high",
        location_address="Musterstrasse 1",
        status="disponiert",
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


async def _make_person(db_session, name, divera_user_id=None):
    person = Personnel(id=uuid4(), name=name, availability="available", divera_user_id=divera_user_id)
    db_session.add(person)
    await db_session.commit()
    await db_session.refresh(person)
    return person


async def _assign(db_session, incident, person):
    a = IncidentAssignment(
        id=uuid4(), incident_id=incident.id, resource_type="personnel", resource_id=person.id
    )
    db_session.add(a)
    await db_session.commit()


async def _enable_alarm(db_session):
    db_session.add(Setting(key="divera.alarm_enabled", value="true"))
    await db_session.commit()


@pytest.fixture
def configured_key(monkeypatch):
    """Pretend an access key is configured (no real call is made)."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    monkeypatch.setattr(settings, "demo_mode", False, raising=False)
    yield


# ============================================
# Endpoint gating
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_requires_auth(client: AsyncClient, alarm_incident: Incident):
    resp = await client.post(
        f"/api/divera/incidents/{alarm_incident.id}/alarm",
        json={"personnel_ids": [str(uuid4())]},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_blocked_when_no_access_key(
    editor_client: AsyncClient, alarm_incident: Incident, monkeypatch
):
    monkeypatch.setattr(settings, "divera_access_key", "", raising=False)
    resp = await editor_client.post(
        f"/api/divera/incidents/{alarm_incident.id}/alarm",
        json={"personnel_ids": [str(uuid4())]},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_blocked_when_disabled(
    editor_client: AsyncClient, alarm_incident: Incident, configured_key
):
    # divera.alarm_enabled defaults to false (no Setting row created)
    resp = await editor_client.post(
        f"/api/divera/incidents/{alarm_incident.id}/alarm",
        json={"personnel_ids": [str(uuid4())]},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_blocked_in_demo_mode(
    editor_client: AsyncClient, alarm_incident: Incident, db_session, configured_key, monkeypatch
):
    await _enable_alarm(db_session)
    monkeypatch.setattr(settings, "demo_mode", True, raising=False)
    resp = await editor_client.post(
        f"/api/divera/incidents/{alarm_incident.id}/alarm",
        json={"personnel_ids": [str(uuid4())]},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_blocked_for_training_event(
    editor_client: AsyncClient, db_session, configured_key
):
    await _enable_alarm(db_session)
    event = Event(id=uuid4(), name="Übung", training_flag=True, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    incident = Incident(
        id=uuid4(), event_id=event.id, title="Test", type="brandbekaempfung",
        priority="low", status="disponiert",
    )
    db_session.add(incident)
    await db_session.commit()
    person = await _make_person(db_session, "Linked", divera_user_id=111)
    await _assign(db_session, incident, person)

    with patch.object(divera_alarm, "send_alarm", new=AsyncMock()) as mock_send:
        resp = await editor_client.post(
            f"/api/divera/incidents/{incident.id}/alarm",
            json={"personnel_ids": [str(person.id)]},
        )
    assert resp.status_code == 409  # training must never send
    mock_send.assert_not_called()


# ============================================
# Recipient resolution + success
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_success_sends_linked_only(
    editor_client: AsyncClient, alarm_incident: Incident, db_session, configured_key
):
    await _enable_alarm(db_session)
    linked = await _make_person(db_session, "Linked Person", divera_user_id=999001)
    unlinked = await _make_person(db_session, "Unlinked Person", divera_user_id=None)
    await _assign(db_session, alarm_incident, linked)
    await _assign(db_session, alarm_incident, unlinked)

    mock_send = AsyncMock(return_value={"id": 999, "count_recipients": 1})
    with patch.object(divera_alarm, "send_alarm", new=mock_send):
        resp = await editor_client.post(
            f"/api/divera/incidents/{alarm_incident.id}/alarm",
            json={"personnel_ids": [str(linked.id), str(unlinked.id)], "send_push": True},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["divera_alarm_id"] == 999
    assert body["foreign_id"] == f"kprueck-{alarm_incident.id}"
    assert [r["name"] for r in body["sent"]] == ["Linked Person"]
    assert [r["name"] for r in body["skipped"]] == ["Unlinked Person"]
    # Only the linked person's Divera id is targeted.
    _, kwargs = mock_send.call_args
    assert kwargs["user_cluster_relation"] == [999001]


@pytest.mark.asyncio
@pytest.mark.api
async def test_alarm_skips_non_assigned(
    editor_client: AsyncClient, alarm_incident: Incident, db_session, configured_key
):
    await _enable_alarm(db_session)
    # Linked person but NOT assigned to this incident.
    outsider = await _make_person(db_session, "Outsider", divera_user_id=555)

    mock_send = AsyncMock(return_value={"id": 1})
    with patch.object(divera_alarm, "send_alarm", new=mock_send):
        resp = await editor_client.post(
            f"/api/divera/incidents/{alarm_incident.id}/alarm",
            json={"personnel_ids": [str(outsider.id)]},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert body["sent"] == []
    assert body["skipped"][0]["reason"] == "nicht diesem Einsatz zugewiesen"
    mock_send.assert_not_called()  # nothing linked+assigned → no call


# ============================================
# Service-level safety
# ============================================


@pytest.mark.asyncio
async def test_service_payload_uses_notification_type_4_and_no_pager(monkeypatch):
    """The v2 payload must target selected users (4) and never page."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            # GET (find) returns no matching alarms -> POST path taken.
            return {"success": True, "data": {"id": 7}}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None):
            if method == "POST":
                captured["url"] = url
                captured["params"] = params
                captured["json"] = json
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    data = await divera_alarm.send_alarm(
        user_cluster_relation=[999001],
        title="t",
        text="x",
        foreign_id="kprueck-abc",
    )
    assert data == {"id": 7}
    alarm = captured["json"]["Alarm"]
    assert alarm["notification_type"] == 4
    assert alarm["send_pager"] is False
    assert alarm["user_cluster_relation"] == [999001]
    assert alarm["foreign_id"] == "kprueck-abc"
    assert captured["json"]["instructions"]["user_cluster_relation"]["mapping"] == "id"
    assert captured["url"].endswith("/alarms")


@pytest.mark.asyncio
async def test_service_updates_existing_alarm_instead_of_duplicating(monkeypatch):
    """If an alarm with the same foreign_id exists, PUT it (don't POST a duplicate)."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    calls: list[tuple[str, str]] = []

    class _Resp:
        def __init__(self, payload):
            self._p = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self._p

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None):
            calls.append((method, url))
            if method == "GET":
                return _Resp({"success": True, "data": {"items": {"5550": {"id": 5550}}}})
            return _Resp({"success": True, "data": {"id": 5550}})

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    data = await divera_alarm.send_alarm(
        user_cluster_relation=[1], title="t", text="x", foreign_id="kprueck-x"
    )
    assert data == {"id": 5550}
    methods = [m for m, _ in calls]
    assert "GET" in methods and "PUT" in methods and "POST" not in methods
    put_url = next(u for m, u in calls if m == "PUT")
    assert put_url.endswith("/alarms/5550")


@pytest.mark.asyncio
async def test_service_treats_200_success_false_as_error(monkeypatch):
    """Divera returns HTTP 200 with success:false on rejection."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"success": False, "errors": {"notification_type": ["..."]}}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    with pytest.raises(divera_alarm.DiveraAlarmError):
        await divera_alarm.send_alarm(
            user_cluster_relation=[1], title="t", text="x", foreign_id="f"
        )


@pytest.mark.asyncio
async def test_service_errors_without_access_key(monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "", raising=False)
    with pytest.raises(divera_alarm.DiveraAlarmError):
        await divera_alarm.send_alarm(
            user_cluster_relation=[1], title="t", text="x", foreign_id="f"
        )


# ============================================
# Test-alarm endpoint (settings setup check)
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_test_alarm_success_targets_divera_user(
    editor_client: AsyncClient, db_session, configured_key
):
    await _enable_alarm(db_session)

    mock_send = AsyncMock(return_value={"id": 42, "count_recipients": 1})
    with patch.object(divera_alarm, "send_alarm", new=mock_send):
        resp = await editor_client.post(
            "/api/divera/test-alarm",
            json={"divera_user_id": 999001, "name": "Self Tester"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["divera_alarm_id"] == 42
    assert [r["name"] for r in body["sent"]] == ["Self Tester"]
    _, kwargs = mock_send.call_args
    assert kwargs["user_cluster_relation"] == [999001]
    assert kwargs["send_push"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_test_alarm_blocked_when_disabled(
    editor_client: AsyncClient, configured_key
):
    # divera.alarm_enabled defaults to false (no Setting row created)
    with patch.object(divera_alarm, "send_alarm", new=AsyncMock()) as mock_send:
        resp = await editor_client.post(
            "/api/divera/test-alarm", json={"divera_user_id": 999001}
        )
    assert resp.status_code == 403
    mock_send.assert_not_called()
