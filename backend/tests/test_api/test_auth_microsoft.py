"""Tests for Microsoft Entra ID login provisioning.

Regression for the audit's Entra-ID finding: SSO auto-created any unknown
tenant user as role=editor — full write access to live operations with no
approval step. New users now default to viewer; editor is an explicit grant
via SSO_EDITOR_ALLOWLIST.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.auth import _is_on_editor_allowlist
from app.auth.config import auth_settings
from app.auth.security import decode_token
from app.config import settings
from app.models import MicrosoftLoginTransaction, User
from app.services.microsoft_auth import consume_login, start_login, validate_and_decode_id_token


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
    start = await client.post("/api/auth/microsoft-start")
    assert start.status_code == 200
    state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]
    exchange, validate = _mock_microsoft(email)
    with exchange, validate:
        return await client.post("/api/auth/microsoft-login", json={"code": "fake-auth-code", "state": state})


class TestMicrosoftLoginTransaction:
    async def test_two_instances_cannot_consume_same_transaction(self, test_engine, microsoft_auth_configured):
        sessions = async_sessionmaker(test_engine, expire_on_commit=False)
        async with sessions() as db:
            started = await start_login(db)
        state = parse_qs(urlparse(started.authorization_url).query)["state"][0]

        async def consume():
            async with sessions() as db:
                return await consume_login(db, state, started.browser_secret)

        results = await asyncio.gather(consume(), consume(), return_exceptions=True)
        assert sum(isinstance(result, MicrosoftLoginTransaction) for result in results) == 1
        assert sum(isinstance(result, ValueError) for result in results) == 1

    async def test_expired_transaction_is_rejected(self, client, db_session, microsoft_auth_configured):
        start = await client.post("/api/auth/microsoft-start")
        state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]
        await db_session.execute(
            update(MicrosoftLoginTransaction).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await db_session.commit()
        with patch("app.services.microsoft_auth.exchange_code_for_tokens", new_callable=AsyncMock) as exchange:
            response = await client.post("/api/auth/microsoft-login", json={"code": "expired", "state": state})
        assert response.status_code == 401
        exchange.assert_not_awaited()

    @pytest.mark.parametrize("secure", [False, True])
    async def test_start_sets_browser_cookie_and_pkce(self, client, microsoft_auth_configured, monkeypatch, secure):
        monkeypatch.setattr(auth_settings, "COOKIE_SECURE", secure)
        response = await client.post("/api/auth/microsoft-start")
        params = parse_qs(urlparse(response.json()["authorization_url"]).query)
        assert params["code_challenge_method"] == ["S256"]
        assert len(params["state"][0]) == 43
        assert len(params["code_challenge"][0]) == 43
        assert len(params["nonce"][0]) == 43
        cookie = response.headers["set-cookie"]
        assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Max-Age=600" in cookie
        assert "Domain=" not in cookie
        assert ("; Secure" in cookie) is secure
        assert response.headers["cache-control"] == "no-store"

    async def test_code_only_callback_is_rejected(self, client, microsoft_auth_configured):
        with patch("app.services.microsoft_auth.exchange_code_for_tokens", new_callable=AsyncMock) as exchange:
            response = await client.post("/api/auth/microsoft-login", json={"code": "injected-code"})
        assert response.status_code == 422
        exchange.assert_not_awaited()

    @pytest.mark.parametrize("wrong_browser", [False, True])
    async def test_missing_or_other_browser_proof_is_rejected(self, client, microsoft_auth_configured, wrong_browser):
        start = await client.post("/api/auth/microsoft-start")
        state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]
        client.cookies.clear()
        if wrong_browser:
            client.cookies.set("microsoft_login_browser", "another-browser")
        with patch("app.services.microsoft_auth.exchange_code_for_tokens", new_callable=AsyncMock) as exchange:
            response = await client.post("/api/auth/microsoft-login", json={"code": "injected", "state": state})
        assert response.status_code == 401
        exchange.assert_not_awaited()

    async def test_transaction_is_one_use_even_when_exchange_fails(self, client, microsoft_auth_configured):
        start = await client.post("/api/auth/microsoft-start")
        state = parse_qs(urlparse(start.json()["authorization_url"]).query)["state"][0]
        with patch(
            "app.services.microsoft_auth.exchange_code_for_tokens",
            new=AsyncMock(side_effect=ValueError("invalid code")),
        ) as exchange:
            first = await client.post("/api/auth/microsoft-login", json={"code": "invalid", "state": state})
            replay = await client.post("/api/auth/microsoft-login", json={"code": "another", "state": state})
        assert first.status_code == 401 and replay.status_code == 401
        assert exchange.await_count == 1

    async def test_exchange_receives_matching_pkce_verifier(self, client, microsoft_auth_configured):
        import base64
        import hashlib

        start = await client.post("/api/auth/microsoft-start")
        params = parse_qs(urlparse(start.json()["authorization_url"]).query)
        with patch(
            "app.services.microsoft_auth.exchange_code_for_tokens",
            new=AsyncMock(side_effect=ValueError("invalid code")),
        ) as exchange:
            response = await client.post(
                "/api/auth/microsoft-login", json={"code": "injected", "state": params["state"][0]}
            )
        assert response.status_code == 401
        verifier = exchange.call_args.args[1]
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        assert expected == params["code_challenge"][0]


class TestMicrosoftNonce:
    @pytest.mark.parametrize("nonce", [None, "another-login", "expected-nonce"])
    def test_signed_token_must_match_transaction_nonce(self, microsoft_auth_configured, nonce):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        claims = {
            "iss": "https://login.microsoftonline.com/test-tenant/v2.0",
            "aud": "test-client",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        }
        if nonce is not None:
            claims["nonce"] = nonce
        token = jwt.encode(claims, key, algorithm="RS256")
        jwks = SimpleNamespace(get_signing_key_from_jwt=lambda _: SimpleNamespace(key=key.public_key()))
        with patch("app.services.microsoft_auth._get_jwks_client", return_value=jwks):
            if nonce == "expected-nonce":
                assert validate_and_decode_id_token(token, "expected-nonce")["nonce"] == nonce
            else:
                with pytest.raises(jwt.InvalidTokenError):
                    validate_and_decode_id_token(token, "expected-nonce")


class TestMicrosoftProvisioning:
    @pytest.mark.parametrize("existing_email", [None, "admin@station.example"])
    async def test_matching_username_never_links_a_different_identity(
        self,
        client,
        db_session,
        microsoft_auth_configured,
        existing_email,
    ):
        admin = User(username="admin", email=existing_email, password_hash=None, role="admin", is_active=True)
        db_session.add(admin)
        await db_session.commit()
        response = await _login(client, "admin@another.example")
        assert response.status_code == 409
        assert "access_token" not in response.cookies
        await db_session.refresh(admin)
        assert admin.email == existing_email and admin.role == "admin"

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
                session_version=3,
            )
        )
        await db_session.commit()

        response = await _login(client, "veteran@fwo.li")

        assert response.status_code == 200
        assert response.json()["role"] == "editor"
        for cookie in ("access_token", "refresh_token"):
            assert decode_token(client.cookies[cookie])["user_session_version"] == 3
        assert (await client.post("/api/auth/refresh")).status_code == 200
        assert decode_token(client.cookies["access_token"])["user_session_version"] == 3
        child = await client.get("/api/auth/ws-token")
        assert child.status_code == 200
        assert decode_token(child.json()["token"])["user_session_version"] == 3

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
