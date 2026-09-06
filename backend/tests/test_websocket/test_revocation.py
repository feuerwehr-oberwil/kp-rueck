"""Revoked sessions must not receive operational data, including through child WS tokens."""

import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from app.auth.security import create_access_token, create_login_tokens, create_ws_token, decode_token
from app.models import RevokedToken
from app.websocket_manager import connect, sio, ws_manager


@pytest.fixture(autouse=True)
def isolate_sockets(monkeypatch):
    ws_manager.user_sessions.clear()
    ws_manager.session_identities.clear()
    for room in ws_manager.active_connections.values():
        room.clear()
    monkeypatch.setattr(sio, "emit", AsyncMock())
    monkeypatch.setattr(sio, "disconnect", AsyncMock())
    monkeypatch.setattr(sio, "leave_room", AsyncMock())
    yield
    ws_manager.user_sessions.clear()
    ws_manager.session_identities.clear()
    for room in ws_manager.active_connections.values():
        room.clear()


async def open_socket(user, *, child=False):
    access, _ = create_login_tokens({"sub": str(user.id), "role": "admin"})
    claims = decode_token(access)
    if child:
        token = create_ws_token(
            user.id,
            "admin",
            session_jti=claims["jti"],
            session_expires_at=claims["exp"],
            family_jti=claims["family_jti"],
            family_expires_at=claims["family_exp"],
        )
        accepted = await connect("audit", {}, {"token": token})
    else:
        accepted = await connect("audit", {"HTTP_COOKIE": f"access_token={access}"})
    assert accepted is True
    assert ws_manager.user_sessions["audit"]["role"] == user.role
    await ws_manager.join_room("audit", "operations")
    return claims


@pytest.mark.parametrize("child", [False, True])
async def test_revoked_parent_rejected_before_broadcast_and_reconnect(db_session, test_editor, child):
    claims = await open_socket(test_editor, child=child)
    db_session.add(RevokedToken(jti=claims["jti"], expires_at=datetime.now(UTC) + timedelta(hours=1)))
    await db_session.commit()
    await ws_manager.broadcast_update("incident_update", {"sensitive": "data"}, room="operations")
    assert "audit" not in ws_manager.user_sessions
    assert "audit" not in ws_manager.active_connections["operations"]
    sio.disconnect.assert_awaited_once_with("audit")
    token = create_ws_token(test_editor.id, "admin", session_jti=claims["jti"], session_expires_at=claims["exp"])
    assert await connect("replay", {}, {"token": token}) is False


async def test_deactivated_account_is_removed_before_delivery(db_session, test_editor):
    await open_socket(test_editor)
    test_editor.is_active = False
    await db_session.commit()
    await ws_manager.broadcast_update("incident_update", {}, room="operations")
    assert "audit" not in ws_manager.user_sessions


async def test_downgrade_removes_admin_room_before_delivery(db_session, test_editor):
    await open_socket(test_editor)
    assert await ws_manager.join_room("audit", "admin")
    test_editor.role = "viewer"
    await db_session.commit()
    await ws_manager.broadcast_update("system", {}, room="admin")
    assert ws_manager.user_sessions["audit"]["role"] == "viewer"
    assert "audit" not in ws_manager.active_connections["admin"]
    sio.leave_room.assert_awaited_once_with("audit", "admin")


async def test_keepalive_cannot_extend_login_expiry(test_editor):
    from app.websocket_manager import ping

    await open_socket(test_editor)
    ws_manager.session_identities["audit"] = replace(ws_manager.session_identities["audit"], expires_at=time.time() - 1)
    await ping("audit")
    assert "audit" not in ws_manager.user_sessions


async def test_database_failure_closes_recipients(test_editor, monkeypatch):
    await open_socket(test_editor)
    monkeypatch.setattr(
        "app.websocket_manager.current_socket_roles", AsyncMock(side_effect=RuntimeError("unavailable"))
    )
    await ws_manager.broadcast_update("incident_update", {}, room="operations")
    assert "audit" not in ws_manager.user_sessions


async def test_signed_token_for_missing_user_does_not_admit():
    from uuid import uuid4

    from app.auth.socket_sessions import cookie_identity

    token, _ = create_login_tokens({"sub": str(uuid4()), "role": "admin"})
    cookie = f"access_token={token}"
    assert cookie_identity(cookie) is not None
    assert await connect("unknown", {"HTTP_COOKIE": cookie}) is False


@pytest.mark.parametrize("child", [False, True])
async def test_http_refresh_and_logout_revokes_original_socket_and_access(client, test_editor, child):
    """Real login, refresh and logout use the DB blocklist shared by socket delivery."""
    from tests.conftest import TEST_PASSWORD

    login = await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
    assert login.status_code == 200
    original_access = client.cookies["access_token"]
    original_refresh = client.cookies["refresh_token"]
    original_claims = decode_token(original_access)
    ws_response = await client.get("/api/auth/ws-token")
    assert ws_response.status_code == 200
    child_token = ws_response.json()["token"]
    handshake = ({}, {"token": child_token}) if child else ({"HTTP_COOKIE": f"access_token={original_access}"}, None)
    assert await connect("family", *handshake) is True
    await ws_manager.join_room("family", "operations")

    for _ in range(2):
        refreshed = await client.post("/api/auth/refresh")
        assert refreshed.status_code == 200
        claims = decode_token(client.cookies["access_token"])
        assert claims["jti"] != original_claims["jti"]
        assert claims["family_jti"] == original_claims["family_jti"] == decode_token(original_refresh)["jti"]
    assert (await client.post("/api/auth/logout")).status_code == 200
    sio.emit.reset_mock()
    await ws_manager.broadcast_update("incident_update", {"sensitive": "must not reach old socket"}, room="operations")
    assert "family" not in ws_manager.user_sessions
    assert not any(call.args[0] == "incident_update" for call in sio.emit.await_args_list)
    assert await connect("replayed-child", {}, {"token": child_token}) is False
    assert await connect("replayed-cookie", {"HTTP_COOKIE": f"access_token={original_access}"}) is False
    client.cookies.clear()
    client.cookies.set("access_token", original_access)
    assert (await client.get("/api/auth/me")).status_code == 401
    client.cookies.set("refresh_token", original_refresh)
    assert (await client.post("/api/auth/refresh")).status_code == 401


async def test_access_only_logout_revokes_family_even_when_access_expired(client, db_session, test_editor):
    from tests.conftest import TEST_PASSWORD

    assert (
        await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
    ).status_code == 200
    access = decode_token(client.cookies["access_token"])
    refresh = client.cookies["refresh_token"]
    expired = create_access_token(access, expires_delta=timedelta(seconds=-1))
    client.cookies.clear()
    client.cookies.set("access_token", expired)
    assert (await client.post("/api/auth/logout")).status_code == 200
    blocked_family = await db_session.get(RevokedToken, access["family_jti"])
    assert blocked_family is not None
    assert blocked_family.expires_at.timestamp() == access["family_exp"]
    client.cookies.set("refresh_token", refresh)
    assert (await client.post("/api/auth/refresh")).status_code == 401


async def test_current_familyless_session_upgrades_with_normal_refresh(client, test_editor):
    from app.auth.security import create_refresh_token

    legacy = create_access_token({"sub": str(test_editor.id), "role": test_editor.role})
    client.cookies.set("access_token", legacy, domain="test.local", path="/")
    client.cookies.set(
        "refresh_token", create_refresh_token({"sub": str(test_editor.id)}), domain="test.local", path="/"
    )
    assert (await client.get("/api/auth/me")).status_code == 200
    assert (await client.get("/api/auth/ws-token")).status_code == 409
    assert await connect("legacy", {"HTTP_COOKIE": f"access_token={legacy}"}) is False
    assert (await client.post("/api/auth/refresh")).status_code == 200
    assert (await client.get("/api/auth/ws-token")).status_code == 200
    assert "family_jti" in decode_token(client.cookies["access_token"])


@pytest.mark.parametrize("had_family", [False, True])
async def test_pre_upgrade_session_requires_login_and_cannot_refresh(client, test_editor, had_family):
    import jwt

    from app.auth.config import auth_settings
    from tests.conftest import TEST_PASSWORD

    access, refresh = create_login_tokens({"sub": str(test_editor.id), "role": test_editor.role})
    child = create_ws_token(test_editor.id, test_editor.role)

    def before_upgrade(token):
        payload = decode_token(token)
        del payload["auth_version"]
        if not had_family:
            payload.pop("family_jti", None)
            payload.pop("family_exp", None)
        return jwt.encode(payload, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)

    old_access = before_upgrade(access)
    client.cookies.set("access_token", old_access, domain="test.local", path="/")
    client.cookies.set("refresh_token", before_upgrade(refresh), domain="test.local", path="/")
    assert (await client.get("/api/auth/me")).status_code == 401
    assert (await client.get("/api/auth/ws-token")).status_code == 401
    refreshed = await client.post("/api/auth/refresh")
    assert refreshed.status_code == 401
    assert "access_token" not in refreshed.cookies
    assert await connect("old-access", {"HTTP_COOKIE": f"access_token={old_access}"}) is False
    assert await connect("old-child", {}, {"token": before_upgrade(child)}) is False

    # The reset changes credentials, never the account or its password.
    assert (
        await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
    ).status_code == 200
    assert (await client.get("/api/auth/me")).status_code == 200
    assert (await client.post("/api/auth/refresh")).status_code == 200
    ws = await client.get("/api/auth/ws-token")
    assert ws.status_code == 200
    assert await connect("new-child", {}, {"token": ws.json()["token"]}) is True


async def test_deactivated_account_cannot_refresh(client, db_session, test_editor):
    from tests.conftest import TEST_PASSWORD

    assert (
        await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
    ).status_code == 200
    test_editor.is_active = False
    await db_session.commit()
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 401
    assert "access_token" not in response.cookies


def test_access_expiry_does_not_outlive_family():
    from uuid import uuid4

    expiry = int(time.time()) + 60
    token = create_access_token({"sub": str(uuid4()), "family_jti": str(uuid4()), "family_exp": expiry})
    assert decode_token(token)["exp"] == expiry


async def test_ping_revalidates_only_sender_then_delivery_rechecks_every_recipient(
    db_session, test_editor, monkeypatch
):
    from app.auth.socket_sessions import current_socket_roles
    from app.websocket_manager import ping

    claims = await open_socket(test_editor)
    other_access, _ = create_login_tokens({"sub": str(test_editor.id), "role": test_editor.role})
    assert await connect("other", {"HTTP_COOKIE": f"access_token={other_access}"}) is True
    await ws_manager.join_room("other", "operations")
    checker = AsyncMock(wraps=current_socket_roles)
    monkeypatch.setattr("app.websocket_manager.current_socket_roles", checker)
    db_session.add(RevokedToken(jti=claims["jti"], expires_at=datetime.now(UTC) + timedelta(hours=1)))
    await db_session.commit()

    await ping("other")
    checker.assert_awaited_once_with([ws_manager.session_identities["other"]])
    assert "audit" in ws_manager.user_sessions  # Not scanned by another client's ping.
    checker.reset_mock()
    await ws_manager.broadcast_update("incident_update", {}, room="operations")
    assert len(checker.await_args.args[0]) == 2
    assert "audit" not in ws_manager.user_sessions
    assert "other" in ws_manager.user_sessions


async def test_ping_applies_sender_role_downgrade_without_scanning_other_clients(db_session, test_editor):
    from app.websocket_manager import ping

    await open_socket(test_editor)
    assert await ws_manager.join_room("audit", "admin")
    test_editor.role = "viewer"
    await db_session.commit()
    await ping("audit")
    assert ws_manager.user_sessions["audit"]["role"] == "viewer"
    assert "audit" not in ws_manager.active_connections["admin"]
    sio.leave_room.assert_awaited_once_with("audit", "admin")


@pytest.mark.parametrize("legacy", [False, True])
async def test_admin_password_reset_revokes_all_target_sessions_and_sockets(admin_client, test_editor, legacy):
    """Real cookies, refresh, child socket mint, reset and delivery share the user's epoch."""
    import jwt
    from httpx import ASGITransport, AsyncClient

    from app.auth.config import auth_settings
    from app.main import app
    from tests.conftest import TEST_PASSWORD

    new_password = "NewUserPassword123"
    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as target,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as second,
    ):
        for client in (target, second):
            assert (
                await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
            ).status_code == 200
        if legacy:
            # A correctly signed credential from before the counter migration is
            # accepted at epoch zero, then retired by this user's first reset.
            for cookie in ("access_token", "refresh_token"):
                payload = decode_token(target.cookies[cookie])
                del payload["user_session_version"]
                target.cookies.delete(cookie)
                target.cookies.set(
                    cookie,
                    jwt.encode(payload, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM),
                    domain="test.local",
                )
        access = target.cookies["access_token"]
        refresh = target.cookies["refresh_token"]
        assert (await target.get("/api/auth/me")).status_code == 200
        ws_response = await target.get("/api/auth/ws-token")
        assert ws_response.status_code == 200
        child = ws_response.json()["token"]
        assert decode_token(child)["user_session_version"] == 0
        assert await connect("reset-cookie", {"HTTP_COOKIE": f"access_token={access}"}) is True
        assert await connect("reset-child", {}, {"token": child}) is True
        await ws_manager.join_room("reset-cookie", "operations")
        await ws_manager.join_room("reset-child", "operations")
        assert (await target.post("/api/auth/refresh")).status_code == 200
        assert decode_token(target.cookies["access_token"])["user_session_version"] == 0

        reset = await admin_client.post(
            f"/api/users/{test_editor.id}/reset-password", json={"new_password": new_password}
        )
        assert reset.status_code == 204, reset.text
        for client in (target, second):
            assert (await client.get("/api/auth/me")).status_code == 401
            assert (await client.post("/api/auth/refresh")).status_code == 401
        target.cookies.clear()
        target.cookies.set("access_token", access, domain="test.local")
        target.cookies.set("refresh_token", refresh, domain="test.local")
        assert (await target.get("/api/auth/me")).status_code == 401
        assert (await target.get("/api/auth/ws-token")).status_code == 401
        assert (await target.post("/api/auth/refresh")).status_code == 401
        sio.emit.reset_mock()
        await ws_manager.broadcast_update("incident_update", {"private": "after reset"}, room="operations")
        assert "reset-cookie" not in ws_manager.user_sessions
        assert "reset-child" not in ws_manager.user_sessions
        assert not any(call.args[0] == "incident_update" for call in sio.emit.await_args_list)
        assert await connect("replay-cookie", {"HTTP_COOKIE": f"access_token={access}"}) is False
        assert await connect("replay-child", {}, {"token": child}) is False
        assert (await admin_client.get("/api/auth/me")).status_code == 200  # Another user's session remains valid.
        assert (
            await target.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
        ).status_code == 401
        assert (
            await target.post("/api/auth/login", data={"username": test_editor.username, "password": new_password})
        ).status_code == 200
        for cookie in ("access_token", "refresh_token"):
            assert decode_token(target.cookies[cookie])["user_session_version"] == 1
        assert (await target.post("/api/auth/refresh")).status_code == 200
        new_child = (await target.get("/api/auth/ws-token")).json()["token"]
        assert decode_token(new_child)["user_session_version"] == 1
        assert await connect("new-password", {}, {"token": new_child}) is True
