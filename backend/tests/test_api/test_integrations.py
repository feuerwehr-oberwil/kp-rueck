"""Tests for the provider capability registry (GET /api/integrations)."""

import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.asyncio
@pytest.mark.api
async def test_integrations_requires_auth(client: AsyncClient):
    resp = await client.get("/api/integrations")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
@pytest.mark.api
async def test_integrations_unconfigured(editor_client: AsyncClient, monkeypatch):
    """Without provider secrets every domain falls back to built-ins."""
    monkeypatch.setattr(settings, "divera_access_key", "", raising=False)
    monkeypatch.setattr(settings, "traccar_url", "", raising=False)

    resp = await editor_client.get("/api/integrations")
    assert resp.status_code == 200
    body = resp.json()

    for domain in ("alarms", "alerting", "personnel", "vehicles"):
        assert body[domain]["provider"] is None
        assert body[domain]["configured"] is False
        assert body[domain]["capabilities"] == []
    # The generic ingest paths are always available — they are not providers
    assert "generic-webhook" in body["builtin_alarm_paths"]
    assert "manual-intake" in body["builtin_alarm_paths"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_integrations_with_divera_and_traccar(editor_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    monkeypatch.setattr(settings, "traccar_url", "https://gps.example.com", raising=False)
    monkeypatch.setattr(settings, "traccar_email", "a@b.c", raising=False)
    monkeypatch.setattr(settings, "traccar_password", "pw", raising=False)

    resp = await editor_client.get("/api/integrations")
    assert resp.status_code == 200
    body = resp.json()

    assert body["alarms"]["provider"] == "divera"
    assert body["alarms"]["configured"] is True
    assert "webhook" in body["alarms"]["capabilities"]

    assert body["alerting"]["provider"] == "divera"
    assert body["alerting"]["display_name"] == "DIVERA 24/7"
    assert "push" in body["alerting"]["capabilities"]

    assert body["personnel"]["provider"] == "divera"
    assert "roster-sync" in body["personnel"]["capabilities"]

    assert body["vehicles"]["provider"] == "traccar"
    assert "gps-tracking" in body["vehicles"]["capabilities"]
