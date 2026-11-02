"""Passwordless local login: the four answers, and the two the boot refuses.

The station notebook opens the board without a password; every other client still signs in.
The whole mechanism is a shared secret that only Caddy's loopback-bound listener attaches
(`app/auth/local_autologin.py`, `deploy/Caddyfile`), so what these tests pin is the contract
the frontend and the proxy both rely on: 404 when off, 403 without the header, an ordinary
session when it is right, and a boot that stops rather than hand the station an admin.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.local_autologin import HEADER_NAME, verify_account_on_boot
from app.config import settings
from app.models import AuditLog, User

# 64 hex characters, as `openssl rand -hex 32` produces and the settings validator requires.
SECRET = "a" * 64


@pytest.fixture
def autologin_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """The default: neither setting filled, so the feature does not exist."""
    monkeypatch.setattr(settings, "local_autologin_user", "")
    monkeypatch.setattr(settings, "local_autologin_secret", "")


@pytest_asyncio.fixture
async def autologin_editor(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession) -> User:
    """An editor account the feature is pointed at."""
    user = User(username="station-notebook", password_hash=None, role="editor")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    monkeypatch.setattr(settings, "local_autologin_user", "station-notebook")
    monkeypatch.setattr(settings, "local_autologin_secret", SECRET)
    return user


# ============================================
# Off by default
# ============================================


@pytest.mark.asyncio
async def test_off_answers_404_even_with_a_header(client: AsyncClient, autologin_off: None):
    """Unconfigured, the route behaves as if it had never been written.

    404 rather than 403 on purpose: a deployment that does not use this should not advertise
    that the endpoint exists, and a correct secret cannot be distinguished from a wrong one
    when there is no secret to compare against.
    """
    response = await client.post("/api/auth/local-login", headers={HEADER_NAME: SECRET})

    assert response.status_code == 404
    assert "access_token" not in response.cookies


# ============================================
# The header is the whole proof
# ============================================


@pytest.mark.asyncio
async def test_missing_header_is_403(client: AsyncClient, autologin_editor: User):
    """A LAN client reaches this endpoint with no header – the public site strips it."""
    response = await client.post("/api/auth/local-login")

    assert response.status_code == 403
    assert "access_token" not in response.cookies


@pytest.mark.asyncio
async def test_wrong_header_is_403(client: AsyncClient, autologin_editor: User):
    """A guessed or stale secret buys nothing."""
    response = await client.post("/api/auth/local-login", headers={HEADER_NAME: "b" * 64})

    assert response.status_code == 403
    assert "access_token" not in response.cookies


@pytest.mark.asyncio
async def test_empty_header_is_403(client: AsyncClient, autologin_editor: User):
    """Caddy stamps an empty value when the station has no secret configured for it."""
    response = await client.post("/api/auth/local-login", headers={HEADER_NAME: ""})

    assert response.status_code == 403


# ============================================
# Success is an ordinary session
# ============================================


@pytest.mark.asyncio
async def test_success_sets_the_same_cookies_as_a_normal_login(
    client: AsyncClient, autologin_editor: User, db_session: AsyncSession
):
    """Both session cookies, the account's own role, and an audit row that says how."""
    response = await client.post("/api/auth/local-login", headers={HEADER_NAME: SECRET})

    assert response.status_code == 200, response.text
    # The pair a signed-in session consists of – api/auth.py issues them through the same
    # helper the password login uses, so "exactly the same cookies" is not a copy to maintain.
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies

    body = response.json()
    assert body["username"] == "station-notebook"
    assert body["role"] == "editor"

    # The session is real: /auth/me accepts the cookies just set.
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "station-notebook"


@pytest.mark.asyncio
async def test_success_writes_an_audit_entry_naming_the_local_login(
    client: AsyncClient, autologin_editor: User, db_session: AsyncSession
):
    """A reader of the audit log can tell this apart from a typed password.

    It stays `login_success` so the audit filter and the Einsatztagebuch need no new action
    type; `changes.method` carries the distinction.
    """
    response = await client.post("/api/auth/local-login", headers={HEADER_NAME: SECRET})
    assert response.status_code == 200

    entry = (
        (
            await db_session.execute(
                select(AuditLog)
                .where(AuditLog.resource_id == autologin_editor.id, AuditLog.action_type == "login_success")
                .order_by(AuditLog.timestamp.desc())
            )
        )
        .scalars()
        .first()
    )

    assert entry is not None, "a local login must leave a trail"
    assert entry.user_id == autologin_editor.id
    assert entry.changes_json == {"method": "local_autologin"}


@pytest.mark.asyncio
async def test_refused_when_the_account_was_promoted_to_admin(
    client: AsyncClient, autologin_editor: User, db_session: AsyncSession
):
    """The boot check cannot see a role changed under a running deployment – the route can."""
    autologin_editor.role = "admin"
    await db_session.commit()

    response = await client.post("/api/auth/local-login", headers={HEADER_NAME: SECRET})

    assert response.status_code == 403
    assert "access_token" not in response.cookies


@pytest.mark.asyncio
async def test_refused_when_the_account_was_deactivated(
    client: AsyncClient, autologin_editor: User, db_session: AsyncSession
):
    """Deactivating an account has to end the station's shortcut too."""
    autologin_editor.is_active = False
    await db_session.commit()

    response = await client.post("/api/auth/local-login", headers={HEADER_NAME: SECRET})

    assert response.status_code == 403


# ============================================
# What the boot refuses
# ============================================


@pytest.mark.asyncio
async def test_boot_refuses_an_admin_account(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession):
    """A browser left open on the station desk must not be able to manage users.

    This is the one that matters: an admin here would turn «the notebook is unlocked» into
    «the notebook can change roles and read the audit log».
    """
    admin = User(username="station-admin", password_hash=None, role="admin")
    db_session.add(admin)
    await db_session.commit()

    monkeypatch.setattr(settings, "local_autologin_user", "station-admin")
    monkeypatch.setattr(settings, "local_autologin_secret", SECRET)

    with pytest.raises(RuntimeError, match="is an admin"):
        await verify_account_on_boot(db_session)


@pytest.mark.asyncio
async def test_boot_refuses_a_missing_account(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession):
    """A typo in LOCAL_AUTOLOGIN_USER is visible in the terminal, not as a silent login form."""
    monkeypatch.setattr(settings, "local_autologin_user", "nobody-by-that-name")
    monkeypatch.setattr(settings, "local_autologin_secret", SECRET)

    with pytest.raises(RuntimeError, match="does not exist"):
        await verify_account_on_boot(db_session)


@pytest.mark.asyncio
async def test_boot_refuses_a_deactivated_account(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession):
    """Otherwise the shortcut fails with nothing anywhere saying why."""
    user = User(username="retired-notebook", password_hash=None, role="editor", is_active=False)
    db_session.add(user)
    await db_session.commit()

    monkeypatch.setattr(settings, "local_autologin_user", "retired-notebook")
    monkeypatch.setattr(settings, "local_autologin_secret", SECRET)

    with pytest.raises(RuntimeError, match="deactivated"):
        await verify_account_on_boot(db_session)


@pytest.mark.asyncio
async def test_boot_passes_on_an_editor(autologin_editor: User, db_session: AsyncSession):
    """The configuration the rollout documents boots."""
    await verify_account_on_boot(db_session)


@pytest.mark.asyncio
async def test_boot_is_a_no_op_when_off(autologin_off: None, db_session: AsyncSession):
    """Nothing configured, nothing checked – no account has to exist."""
    await verify_account_on_boot(db_session)


@pytest.mark.asyncio
async def test_boot_refuses_the_feature_on_railway(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession):
    """Railway has no Caddy, so nothing strips the header and nothing binds it to one machine.

    There the backend IS the public origin: the shared secret would be all that stands between
    the internet and an editor session, which is a different (and much weaker) feature than the
    one this is. Refuse rather than run it in a shape the documentation does not describe.
    """
    user = User(username="railway-notebook", password_hash=None, role="editor")
    db_session.add(user)
    await db_session.commit()

    monkeypatch.setattr(settings, "local_autologin_user", "railway-notebook")
    monkeypatch.setattr(settings, "local_autologin_secret", SECRET)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")

    with pytest.raises(RuntimeError, match="cannot work on Railway"):
        await verify_account_on_boot(db_session)
