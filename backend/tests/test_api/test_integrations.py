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


# ==========================================================================================
# Deployment role — the block has to be visible to an API caller, not only in the UI.
# ==========================================================================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_integrations_reports_production_role_by_default(editor_client: AsyncClient):
    resp = await editor_client.get("/api/integrations")
    body = resp.json()

    assert body["deployment"]["role"] == "production"
    assert body["deployment"]["label"] is None
    assert body["deployment"]["blocked_domains"] == []
    for domain in ("alarms", "alerting", "personnel", "vehicles"):
        assert body[domain]["blocked"] is False
        assert body[domain]["blocked_reason"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_integrations_reports_blocked_domains_on_staging(editor_client: AsyncClient, monkeypatch):
    """Configured AND blocked at the same time — they answer different questions."""
    monkeypatch.setattr(settings, "divera_access_key", "TEST-KEY", raising=False)
    monkeypatch.setenv("DEPLOYMENT_ROLE", "staging")

    resp = await editor_client.get("/api/integrations")
    body = resp.json()

    assert body["deployment"]["role"] == "staging"
    assert body["deployment"]["label"] == "Staging – Übungssystem"
    assert sorted(body["deployment"]["blocked_domains"]) == ["alerting", "sync"]

    assert body["alerting"]["configured"] is True
    assert body["alerting"]["display_name"] == "DIVERA 24/7"
    assert body["alerting"]["blocked"] is True
    assert "gesperrt" in body["alerting"]["blocked_reason"]

    # Inbound alarms, roster sync and GPS are wanted on staging and stay open.
    for domain in ("alarms", "personnel", "vehicles"):
        assert body[domain]["blocked"] is False
        assert body[domain]["blocked_reason"] is None
