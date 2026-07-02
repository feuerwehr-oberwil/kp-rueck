"""Tests for Microsoft Entra ID login provisioning.

Regression for the audit's Entra-ID finding: SSO auto-created any unknown
tenant user as role=editor — full write access to live operations with no
approval step. New users now default to viewer; editor is an explicit grant
via SSO_EDITOR_ALLOWLIST.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import _is_on_editor_allowlist
from app.config import settings
from app.models import User


class TestEditorAllowlist:
    def test_empty_allowlist_matches_nobody(self, monkeypatch):
        monkeypatch.setattr(settings, "sso_editor_allowlist", "")
        assert _is_on_editor_allowlist("chief@fwo.li") is False

    def test_match_is_case_insensitive_and_trims_whitespace(self, monkeypatch):
        monkeypatch.setattr(settings, "sso_editor_allowlist", " Chief@FWO.li , second@fwo.li ")
        assert _is_on_editor_allowlist("chief@fwo.li") is True
        assert _is_on_editor_allowlist("SECOND@fwo.LI") is True
        assert _is_on_editor_allowlist("random@fwo.li") is False


@pytest.fixture
def microsoft_auth_configured(monkeypatch):
    """Pretend Entra ID is configured so /microsoft-login doesn't 400."""
    monkeypatch.setattr(settings, "microsoft_client_id", "test-client")
    monkeypatch.setattr(settings, "microsoft_tenant_id", "test-tenant")
    monkeypatch.setattr(settings, "microsoft_client_secret", "test-secret")
    monkeypatch.setattr(settings, "microsoft_redirect_uri", "http://test/auth/callback")


def _mock_microsoft(email: str, name: str = "Test User"):
    """Patch the Microsoft token exchange + validation for one login."""
    exchange = patch(
        "app.services.microsoft_auth.exchange_code_for_tokens",
        new=AsyncMock(return_value={"id_token": "fake-id-token"}),
    )
    validate = patch(
        "app.services.microsoft_auth.validate_and_decode_id_token",
        return_value={"preferred_username": email, "name": name},
    )
    return exchange, validate


async def _login(client: AsyncClient, email: str):
    exchange, validate = _mock_microsoft(email)
    with exchange, validate:
        return await client.post("/api/auth/microsoft-login", json={"code": "fake-auth-code"})


class TestMicrosoftProvisioning:
    async def test_new_user_defaults_to_viewer(
        self, client: AsyncClient, db_session: AsyncSession, microsoft_auth_configured, monkeypatch
    ):
        monkeypatch.setattr(settings, "sso_editor_allowlist", "")

        response = await _login(client, "somebody@fwo.li")

        assert response.status_code == 200
        assert response.json()["role"] == "viewer"
        result = await db_session.execute(select(User).where(User.email == "somebody@fwo.li"))
        assert result.scalar_one().role == "viewer"

    async def test_new_user_on_allowlist_gets_editor(
        self, client: AsyncClient, db_session: AsyncSession, microsoft_auth_configured, monkeypatch
    ):
        monkeypatch.setattr(settings, "sso_editor_allowlist", "chief@fwo.li")

        response = await _login(client, "Chief@fwo.li")

        assert response.status_code == 200
        assert response.json()["role"] == "editor"

    async def test_existing_editor_is_not_downgraded(
        self, client: AsyncClient, db_session: AsyncSession, microsoft_auth_configured, monkeypatch
    ):
        # Removed from (or never on) the allowlist — re-login must not demote.
        monkeypatch.setattr(settings, "sso_editor_allowlist", "")
        db_session.add(
            User(
                id=uuid4(),
                username="veteran",
                email="veteran@fwo.li",
                password_hash=None,
                role="editor",
                is_active=True,
            )
        )
        await db_session.commit()

        response = await _login(client, "veteran@fwo.li")

        assert response.status_code == 200
        assert response.json()["role"] == "editor"

    async def test_existing_viewer_is_not_auto_promoted(
        self, client: AsyncClient, db_session: AsyncSession, microsoft_auth_configured, monkeypatch
    ):
        # Added to the allowlist AFTER provisioning: promotion stays a manual
        # admin action (decision in docs/AUDIT-2026-07-02.md).
        monkeypatch.setattr(settings, "sso_editor_allowlist", "late@fwo.li")
        db_session.add(
            User(
                id=uuid4(),
                username="late",
                email="late@fwo.li",
                password_hash=None,
                role="viewer",
                is_active=True,
            )
        )
        await db_session.commit()

        response = await _login(client, "late@fwo.li")

        assert response.status_code == 200
        assert response.json()["role"] == "viewer"
