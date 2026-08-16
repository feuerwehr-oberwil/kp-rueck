"""Tests for the outbound Divera *Mitteilung* (news) — the standby message.

A Mitteilung is quieter than an alarm but still reaches every addressed phone,
so the interesting questions are all about who receives it: the schema must
refuse an unaddressed send, the payload must use notification_type 3 for groups
(never the 2 that means "the whole Feuerwehr") and it must never page.

No test performs a real Divera HTTP call.
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
from app.models import Event, Setting
from app.services import divera_alarm


@pytest_asyncio.fixture
async def training_event(db_session: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Übung", training_flag=True, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest.fixture
def configured_key(monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    monkeypatch.setattr(settings, "demo_mode", False, raising=False)
    yield


async def _enable_alerting(db_session):
    db_session.add(Setting(key="alerting.enabled", value="true"))
    await db_session.commit()


# ============================================
# Who gets it
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_message_refuses_groups_target_without_groups(editor_client: AsyncClient, db_session, configured_key):
    """«Ausgewählte Gruppen» with nothing selected is a broadcast waiting to happen."""
    await _enable_alerting(db_session)
    resp = await editor_client.post(
        "/api/divera/message",
        json={"text": "KP-Rück ist aktiv", "target": "groups", "group_ids": []},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_message_blocked_when_alerting_disabled(editor_client: AsyncClient, configured_key):
    """Same gate as an alarm: a Mitteilung still lands on every addressed phone."""
    resp = await editor_client.post(
        "/api/divera/message",
        json={"text": "KP-Rück ist aktiv", "target": "all"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_message_simulated_for_training_event(
    editor_client: AsyncClient, db_session, training_event: Event, configured_key
):
    """A drill must not push anything to the crew — the flow runs, nothing is sent."""
    await _enable_alerting(db_session)
    with patch.object(divera_alarm, "send_news", new=AsyncMock()) as mock_send:
        resp = await editor_client.post(
            "/api/divera/message",
            json={"text": "Übung läuft", "target": "all", "event_id": str(training_event.id)},
        )
    assert resp.status_code == 200
    assert resp.json()["simulated"] is True
    mock_send.assert_not_called()


# ============================================
# Service-level safety
# ============================================


@pytest.mark.asyncio
async def test_service_refuses_a_message_with_no_recipients(monkeypatch):
    """Nothing addressed must fail loudly, not fall back to the whole unit."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    with pytest.raises(divera_alarm.DiveraAlarmError):
        await divera_alarm.send_news(title="t", text="x", foreign_id="kprueck-info-1")


@pytest.mark.asyncio
async def test_service_payload_targets_groups_and_never_pages(monkeypatch):
    """Groups → notification_type 3, mapped by id, pager off."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"success": True, "data": {"id": 42}}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None):
            captured["method"] = method
            captured["url"] = url
            captured["json"] = json
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    data = await divera_alarm.send_news(
        title="KP-Rück",
        text="ist aktiv",
        foreign_id="kprueck-info-abc",
        group_ids=[11, 12],
    )

    assert data == {"id": 42}
    news = captured["json"]["News"]
    assert news["notification_type"] == divera_alarm.NOTIFICATION_TYPE_SELECTED_GROUPS
    assert news["group"] == [11, 12]
    assert news["send_pager"] is False
    assert captured["json"]["instructions"]["group"]["mapping"] == "id"
    # POST only — a Mitteilung is a moment, not an alarm object that gets updated.
    assert captured["method"] == "POST"
    assert captured["url"].endswith("/news")


@pytest.mark.asyncio
async def test_service_only_reaches_everyone_when_explicitly_told_to(monkeypatch):
    """notification_type 2 is reachable, but only via to_everyone=True."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"success": True, "data": {"id": 1}}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, params=None, json=None):
            captured["json"] = json
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    await divera_alarm.send_news(title="KP-Rück", text="ist aktiv", foreign_id="kprueck-info-all", to_everyone=True)
    assert captured["json"]["News"]["notification_type"] == divera_alarm.NOTIFICATION_TYPE_ALL
    assert "group" not in captured["json"]["News"]
