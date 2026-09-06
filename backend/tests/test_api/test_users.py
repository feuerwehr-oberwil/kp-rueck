"""Tests for the user-administration endpoints (`/api/users`).

This is the only surface in the API that creates accounts, changes roles and sets
passwords, and the only one guarded by ``CurrentAdmin`` — *editor* is not enough
anywhere here. Two things therefore need saying out loud in tests:

1. **Who may reach it.** The settings page reads ``activeSection`` unfiltered from the
   URL, so ``/settings?section=users`` is reachable by anyone who gets past
   ``ProtectedRoute``. What keeps the roster (and the create/reset buttons) from
   working for them is this dependency, not the sidebar.
2. **What the endpoints actually do to an account.** A password reset has to make the
   old password stop working; a deactivation has to stop the account logging in; a
   permanent delete has to be gone. Asserting the status code alone would pass on an
   endpoint that changes nothing, so every mutation here is checked through its
   *effect* — a real login attempt, or the row in the database.

The German copy is asserted verbatim: it is what an admin reads when something is
refused, and a silent rewording is a regression the frontend would show to a user.
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.login_throttle import login_throttle
from app.auth.security import hash_password
from app.config import settings as app_settings
from app.main import app
from app.models import AuditLog, User
from tests.conftest import TEST_PASSWORD

NEW_PASSWORD = "brandneuespasswort"  # >= MIN_PASSWORD_LENGTH (12)

# A syntactically valid id that is not in the database — for the 404 paths and for the
# authorization matrix, where the guard must fire before anything is looked up.
MISSING_ID = uuid.UUID("00000000-0000-0000-0000-0000000000ff")


# ============================================
# Helpers
# ============================================


async def login_attempt(username: str, password: str) -> Response:
    """Try to log in on a throwaway client.

    Never reuse the caller's own client for this: `admin_client`, `editor_client` and
    `client` are the *same* AsyncClient instance (see conftest), so logging in as
    somebody else would overwrite the session cookie the test is holding.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        return await ac.post("/api/auth/login", data={"username": username, "password": password})


@asynccontextmanager
async def logged_in(username: str, password: str) -> AsyncIterator[AsyncClient]:
    """A second, independent session — a phone or laptop signed in as somebody else.

    Needed wherever a test has to hold one user's session *while* the admin changes
    that user's account underneath it.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/auth/login", data={"username": username, "password": password})
        assert response.status_code == 200, f"login failed: {response.text}"
        yield ac


async def user_audit_entries(db: AsyncSession, resource_id: uuid.UUID) -> list[AuditLog]:
    """Audit rows this API wrote about one account.

    Filtered on ``resource_type == "user"`` so the request-level rows the audit
    middleware writes (``resource_type == "api"``) stay out of the way.
    """
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.resource_type == "user", AuditLog.resource_id == resource_id)
        .order_by(AuditLog.timestamp)
    )
    return list(result.scalars().all())


async def stored_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    """Read an account straight from the database, bypassing the identity map."""
    db.expire_all()
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


# ============================================
# Fixtures
# ============================================


@pytest.fixture(autouse=True)
def clean_login_throttle():
    """The throttle is a process-wide in-memory singleton, so failed logins from one
    test would otherwise count against the next one — five of them lock a username out
    for five minutes and the suite starts failing in file order."""
    login_throttle._attempts.clear()
    yield
    login_throttle._attempts.clear()


@pytest.fixture
def demo_mode(monkeypatch):
    """A public demo deployment: every write on this router must refuse."""
    monkeypatch.setattr(app_settings, "demo_mode", True)


@pytest_asyncio.fixture
async def target_user(db_session: AsyncSession) -> User:
    """An ordinary account for the admin to act on — not the admin's own."""
    user = User(
        id=uuid.uuid4(),
        username="ziel_benutzer",
        password_hash=hash_password(TEST_PASSWORD),
        role="editor",
        display_name="Ziel Benutzer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


# ============================================
# Authorization
# ============================================


def admin_only_routes() -> list[tuple[str, str]]:
    """Every route on this router. All six are admin-only; none has a softer guard."""
    return [
        ("GET", "/api/users/"),
        ("GET", f"/api/users/{MISSING_ID}"),
        ("POST", "/api/users/"),
        ("PUT", f"/api/users/{MISSING_ID}"),
        ("POST", f"/api/users/{MISSING_ID}/reset-password"),
        ("DELETE", f"/api/users/{MISSING_ID}"),
    ]


class TestAuthorization:
    """Who may reach the user-administration surface at all."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("method", "path"), admin_only_routes())
    async def test_editor_is_refused(self, editor_client: AsyncClient, method: str, path: str):
        """Editor is the API's normal write role and is still not enough here.

        No request body is sent on purpose: the answer must be 403, not the 422 a
        schema check would produce. The guard runs before the body is looked at, so a
        non-admin learns nothing about the payload these endpoints expect.
        """
        response = await editor_client.request(method, path)
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin-Berechtigung erforderlich"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("method", "path"), admin_only_routes())
    async def test_viewer_is_refused(self, viewer_client: AsyncClient, method: str, path: str):
        """A viewer who types /settings?section=users must find nothing behind it."""
        response = await viewer_client.request(method, path)
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin-Berechtigung erforderlich"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("method", "path"), admin_only_routes())
    async def test_unauthenticated_is_refused(self, client: AsyncClient, method: str, path: str):
        response = await client.request(method, path)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_deactivated_admin_loses_access(self, admin_client: AsyncClient, test_admin: User, db_session):
        """`is_active=False` is checked on every request, not only at login — an admin
        who is switched off keeps a valid, unexpired cookie and must still be refused."""
        test_admin.is_active = False
        await db_session.commit()

        response = await admin_client.get("/api/users/")
        assert response.status_code == 401


# ============================================
# GET
# ============================================


class TestListUsers:
    @pytest.mark.asyncio
    async def test_lists_every_account_ordered_by_username(
        self, admin_client: AsyncClient, test_admin: User, target_user: User
    ):
        response = await admin_client.get("/api/users/")
        assert response.status_code == 200

        usernames = [u["username"] for u in response.json()]
        assert {"fixture_admin", "ziel_benutzer"} <= set(usernames)
        assert usernames == sorted(usernames)

    @pytest.mark.asyncio
    async def test_includes_deactivated_accounts(self, admin_client: AsyncClient, target_user: User, db_session):
        """Deactivated users must stay visible — otherwise the admin cannot re-enable
        the account they just switched off."""
        target_user.is_active = False
        await db_session.commit()

        response = await admin_client.get("/api/users/")
        listed = {u["username"]: u for u in response.json()}
        assert listed["ziel_benutzer"]["is_active"] is False

    @pytest.mark.asyncio
    async def test_never_exposes_password_hashes(self, admin_client: AsyncClient, target_user: User):
        """The roster is the one endpoint that returns every account at once. A hash
        leaked here is every hash leaked."""
        response = await admin_client.get("/api/users/")
        assert "password" not in response.text.lower()


class TestGetUser:
    @pytest.mark.asyncio
    async def test_returns_the_account(self, admin_client: AsyncClient, target_user: User):
        response = await admin_client.get(f"/api/users/{target_user.id}")
        assert response.status_code == 200

        body = response.json()
        assert body["id"] == str(target_user.id)
        assert body["username"] == "ziel_benutzer"
        assert body["role"] == "editor"
        assert body["display_name"] == "Ziel Benutzer"
        assert "password_hash" not in body

    @pytest.mark.asyncio
    async def test_unknown_id_is_404(self, admin_client: AsyncClient):
        response = await admin_client.get(f"/api/users/{MISSING_ID}")
        assert response.status_code == 404
        assert response.json()["detail"] == "Benutzer nicht gefunden"

    @pytest.mark.asyncio
    async def test_malformed_id_is_422(self, admin_client: AsyncClient):
        response = await admin_client.get("/api/users/nicht-eine-uuid")
        assert response.status_code == 422


# ============================================
# POST /users/
# ============================================


class TestCreateUser:
    @pytest.mark.asyncio
    async def test_creates_an_account_that_can_log_in(self, admin_client: AsyncClient, db_session: AsyncSession):
        """The point of the endpoint: afterwards the person can sign in with what the
        admin typed. Asserting only the 201 would pass on a stored plaintext password
        or a hash of the wrong string."""
        response = await admin_client.post(
            "/api/users/",
            json={"username": "neuer_editor", "password": NEW_PASSWORD, "role": "editor"},
        )
        assert response.status_code == 201

        body = response.json()
        assert body["username"] == "neuer_editor"
        assert body["role"] == "editor"
        assert body["is_active"] is True
        assert "password" not in body and "password_hash" not in body

        created = await stored_user(db_session, uuid.UUID(body["id"]))
        assert created is not None
        assert created.password_hash != NEW_PASSWORD  # stored hashed, not in the clear

        login = await login_attempt("neuer_editor", NEW_PASSWORD)
        assert login.status_code == 200

    @pytest.mark.asyncio
    async def test_display_name_defaults_to_the_username(self, admin_client: AsyncClient):
        """`display_name` is what the board shows; an empty one would render as a gap."""
        response = await admin_client.post(
            "/api/users/",
            json={"username": "ohne_anzeigename", "password": NEW_PASSWORD, "role": "editor"},
        )
        assert response.status_code == 201
        assert response.json()["display_name"] == "ohne_anzeigename"

    @pytest.mark.asyncio
    async def test_display_name_is_kept_when_given(self, admin_client: AsyncClient):
        response = await admin_client.post(
            "/api/users/",
            json={
                "username": "mit_anzeigename",
                "password": NEW_PASSWORD,
                "role": "admin",
                "display_name": "Hans Muster",
            },
        )
        assert response.status_code == 201
        assert response.json()["display_name"] == "Hans Muster"

    @pytest.mark.asyncio
    async def test_viewer_role_is_accepted(self, admin_client: AsyncClient):
        """`viewer` is a real, allowed role (read-only login for a wall display) even
        though the rejection copy below does not mention it — see the note there."""
        response = await admin_client.post(
            "/api/users/",
            json={"username": "wandanzeige", "password": NEW_PASSWORD, "role": "viewer"},
        )
        assert response.status_code == 201
        assert response.json()["role"] == "viewer"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role", ["superadmin", "Admin", "", "editor "])
    async def test_unknown_role_is_refused(self, admin_client: AsyncClient, db_session: AsyncSession, role: str):
        """Role is a free-form string in the schema; only this check stands between a
        typo and a row the CHECK constraint would reject (or, worse, a role nothing
        recognises). Note the copy names two of the three allowed roles — `viewer` is
        accepted but not advertised.
        """
        response = await admin_client.post(
            "/api/users/",
            json={"username": "falsche_rolle", "password": NEW_PASSWORD, "role": role},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "Ungültige Rolle. Erlaubt: admin, editor"

        result = await db_session.execute(select(User).where(User.username == "falsche_rolle"))
        assert result.scalar_one_or_none() is None

    @pytest.mark.asyncio
    async def test_duplicate_username_is_refused(self, admin_client: AsyncClient, target_user: User):
        response = await admin_client.post(
            "/api/users/",
            json={"username": "ziel_benutzer", "password": NEW_PASSWORD, "role": "editor"},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "Benutzername bereits vergeben"

    @pytest.mark.asyncio
    async def test_duplicate_username_does_not_touch_the_existing_account(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        """A refused create must not have re-hashed the password of the account whose
        name collided — the incumbent has to still be able to log in."""
        original_hash = target_user.password_hash

        await admin_client.post(
            "/api/users/",
            json={"username": "ziel_benutzer", "password": NEW_PASSWORD, "role": "admin"},
        )

        unchanged = await stored_user(db_session, target_user.id)
        assert unchanged is not None
        assert unchanged.password_hash == original_hash
        assert unchanged.role == "editor"

    @pytest.mark.asyncio
    async def test_writes_an_audit_entry_without_the_password(
        self, admin_client: AsyncClient, test_admin: User, db_session: AsyncSession
    ):
        """Account creation is a record-keeping event: who created whom, with which
        role. The password must not be anywhere in it."""
        response = await admin_client.post(
            "/api/users/",
            json={"username": "protokolliert", "password": NEW_PASSWORD, "role": "editor"},
        )
        created_id = uuid.UUID(response.json()["id"])

        entries = await user_audit_entries(db_session, created_id)
        assert [e.action_type for e in entries] == ["create"]

        entry = entries[0]
        assert entry.user_id == test_admin.id
        assert entry.changes_json == {
            "username": "protokolliert",
            "role": "editor",
            "display_name": "protokolliert",
        }
        assert NEW_PASSWORD not in str(entry.changes_json)

    @pytest.mark.asyncio
    async def test_refused_in_demo_mode(self, admin_client: AsyncClient, db_session: AsyncSession, demo_mode):
        response = await admin_client.post(
            "/api/users/",
            json={"username": "demo_benutzer", "password": NEW_PASSWORD, "role": "editor"},
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "Benutzerverwaltung ist im Demo-Modus nicht verfügbar"

        result = await db_session.execute(select(User).where(User.username == "demo_benutzer"))
        assert result.scalar_one_or_none() is None

    @pytest.mark.asyncio
    async def test_short_password_is_a_client_error(self, admin_client: AsyncClient):
        response = await admin_client.post(
            "/api/users/",
            json={"username": "kurzes_passwort", "password": "kurz", "role": "editor"},
        )
        assert response.status_code == 400
        assert "kurz" not in response.text


# ============================================
# PUT /users/{id}
# ============================================


class TestUpdateUser:
    @pytest.mark.asyncio
    async def test_updates_name_role_and_display_name(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        response = await admin_client.put(
            f"/api/users/{target_user.id}",
            json={"username": "neuer_name", "role": "admin", "display_name": "Neue Anzeige"},
        )
        assert response.status_code == 200

        updated = await stored_user(db_session, target_user.id)
        assert updated is not None
        assert (updated.username, updated.role, updated.display_name) == ("neuer_name", "admin", "Neue Anzeige")

    @pytest.mark.asyncio
    async def test_renamed_account_logs_in_under_the_new_name(self, admin_client: AsyncClient, target_user: User):
        """A rename moves the credential, it does not copy it: the old username must
        stop working and the same password must work under the new one."""
        response = await admin_client.put(f"/api/users/{target_user.id}", json={"username": "umbenannt"})
        assert response.status_code == 200

        assert (await login_attempt("ziel_benutzer", TEST_PASSWORD)).status_code == 401
        assert (await login_attempt("umbenannt", TEST_PASSWORD)).status_code == 200

    @pytest.mark.asyncio
    async def test_deactivating_another_user_ends_their_session(self, admin_client: AsyncClient, target_user: User):
        """Switching an account off is the emergency lever: it has to cut the session
        that is already open, not just the next login. `get_current_user` re-reads
        `is_active` on every request, which is what makes that true."""
        async with logged_in("ziel_benutzer", TEST_PASSWORD) as their_session:
            assert (await their_session.get("/api/auth/me")).status_code == 200

            response = await admin_client.put(f"/api/users/{target_user.id}", json={"is_active": False})
            assert response.status_code == 200

            assert (await their_session.get("/api/auth/me")).status_code == 401

        login = await login_attempt("ziel_benutzer", TEST_PASSWORD)
        assert login.status_code == 401
        assert login.json()["detail"] == "Benutzerkonto ist deaktiviert"

    @pytest.mark.asyncio
    async def test_admin_cannot_deactivate_themselves(
        self, admin_client: AsyncClient, test_admin: User, db_session: AsyncSession
    ):
        """The lockout guard: a single-admin station that switches itself off has no
        way back in through the UI."""
        response = await admin_client.put(f"/api/users/{test_admin.id}", json={"is_active": False})
        assert response.status_code == 400
        assert response.json()["detail"] == "Sie können sich nicht selbst deaktivieren"

        still_admin = await stored_user(db_session, test_admin.id)
        assert still_admin is not None and still_admin.is_active is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role", ["editor", "viewer"])
    async def test_admin_cannot_demote_themselves(
        self, admin_client: AsyncClient, test_admin: User, db_session: AsyncSession, role: str
    ):
        response = await admin_client.put(f"/api/users/{test_admin.id}", json={"role": role})
        assert response.status_code == 400
        assert response.json()["detail"] == "Sie können Ihre eigene Admin-Rolle nicht entfernen"

        still_admin = await stored_user(db_session, test_admin.id)
        assert still_admin is not None and still_admin.role == "admin"

    @pytest.mark.asyncio
    async def test_admin_may_edit_their_own_display_name(self, admin_client: AsyncClient, test_admin: User):
        """The two self-guards are narrow on purpose — an admin renaming themselves or
        confirming their own admin role is not a lockout and must go through."""
        response = await admin_client.put(
            f"/api/users/{test_admin.id}",
            json={"role": "admin", "display_name": "Chef vom Dienst", "is_active": True},
        )
        assert response.status_code == 200
        assert response.json()["display_name"] == "Chef vom Dienst"

    @pytest.mark.asyncio
    async def test_username_conflict_is_refused(
        self, admin_client: AsyncClient, target_user: User, test_admin: User, db_session: AsyncSession
    ):
        response = await admin_client.put(f"/api/users/{target_user.id}", json={"username": "fixture_admin"})
        assert response.status_code == 409
        assert response.json()["detail"] == "Benutzername bereits vergeben"

        unchanged = await stored_user(db_session, target_user.id)
        assert unchanged is not None and unchanged.username == "ziel_benutzer"

    @pytest.mark.asyncio
    async def test_keeping_the_same_username_is_not_a_conflict(self, admin_client: AsyncClient, target_user: User):
        """The form submits every field, so the user's own name arrives on each save.
        That must not collide with itself."""
        response = await admin_client.put(
            f"/api/users/{target_user.id}",
            json={"username": "ziel_benutzer", "display_name": "Neu"},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_unknown_role_is_refused(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        response = await admin_client.put(f"/api/users/{target_user.id}", json={"role": "superadmin"})
        assert response.status_code == 400
        assert response.json()["detail"] == "Ungültige Rolle. Erlaubt: admin, editor"

        unchanged = await stored_user(db_session, target_user.id)
        assert unchanged is not None and unchanged.role == "editor"

    @pytest.mark.asyncio
    async def test_unknown_id_is_404(self, admin_client: AsyncClient):
        response = await admin_client.put(f"/api/users/{MISSING_ID}", json={"display_name": "X"})
        assert response.status_code == 404
        assert response.json()["detail"] == "Benutzer nicht gefunden"

    @pytest.mark.asyncio
    async def test_audit_entry_records_old_and_new_values(
        self, admin_client: AsyncClient, target_user: User, test_admin: User, db_session: AsyncSession
    ):
        """A role change is the one edit here with security weight, so the trail has to
        say what it was before, not just what it is now."""
        await admin_client.put(
            f"/api/users/{target_user.id}",
            json={"role": "admin", "display_name": "Ziel Benutzer"},  # display_name unchanged
        )

        entries = await user_audit_entries(db_session, target_user.id)
        assert [e.action_type for e in entries] == ["update"]
        assert entries[0].user_id == test_admin.id
        # Only the field that actually moved is recorded.
        assert entries[0].changes_json == {"role": {"old": "editor", "new": "admin"}}

    @pytest.mark.asyncio
    async def test_a_no_op_update_writes_no_audit_entry(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        """Saving the form without changing anything is common. It must not fill the
        audit log with empty updates."""
        response = await admin_client.put(
            f"/api/users/{target_user.id}",
            json={"username": "ziel_benutzer", "role": "editor", "display_name": "Ziel Benutzer"},
        )
        assert response.status_code == 200
        assert await user_audit_entries(db_session, target_user.id) == []

    @pytest.mark.asyncio
    async def test_refused_in_demo_mode(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession, demo_mode
    ):
        response = await admin_client.put(f"/api/users/{target_user.id}", json={"role": "admin"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Benutzerverwaltung ist im Demo-Modus nicht verfügbar"

        unchanged = await stored_user(db_session, target_user.id)
        assert unchanged is not None and unchanged.role == "editor"


# ============================================
# POST /users/{id}/reset-password
# ============================================


class TestResetPassword:
    @pytest.mark.asyncio
    async def test_old_password_stops_working_and_the_new_one_starts(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        """The whole contract of the endpoint, asserted through real logins rather than
        through the 204."""
        old_hash = target_user.password_hash

        response = await admin_client.post(
            f"/api/users/{target_user.id}/reset-password",
            json={"new_password": NEW_PASSWORD},
        )
        assert response.status_code == 204

        reset = await stored_user(db_session, target_user.id)
        assert reset is not None
        assert reset.password_hash != old_hash
        assert reset.password_hash != NEW_PASSWORD  # hashed, not stored in the clear

        assert (await login_attempt("ziel_benutzer", TEST_PASSWORD)).status_code == 401
        assert (await login_attempt("ziel_benutzer", NEW_PASSWORD)).status_code == 200

    @pytest.mark.asyncio
    async def test_reset_does_not_reactivate_a_disabled_account(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        """Setting a password is not a re-enable. A deactivated account that gets a new
        password must stay locked out until somebody flips `is_active` deliberately."""
        target_user.is_active = False
        await db_session.commit()

        response = await admin_client.post(
            f"/api/users/{target_user.id}/reset-password",
            json={"new_password": NEW_PASSWORD},
        )
        assert response.status_code == 204

        login = await login_attempt("ziel_benutzer", NEW_PASSWORD)
        assert login.status_code == 401
        assert login.json()["detail"] == "Benutzerkonto ist deaktiviert"

    @pytest.mark.asyncio
    async def test_audit_entry_never_carries_the_password(
        self, admin_client: AsyncClient, target_user: User, test_admin: User, db_session: AsyncSession
    ):
        """The audit row says *that* an admin reset it, deliberately not what to."""
        await admin_client.post(
            f"/api/users/{target_user.id}/reset-password",
            json={"new_password": NEW_PASSWORD},
        )

        entries = await user_audit_entries(db_session, target_user.id)
        assert [e.action_type for e in entries] == ["password_reset"]
        assert entries[0].user_id == test_admin.id
        assert entries[0].changes_json == {"action": "password_reset_by_admin"}
        assert NEW_PASSWORD not in str(entries[0].changes_json)

    @pytest.mark.asyncio
    async def test_unknown_id_is_404(self, admin_client: AsyncClient):
        response = await admin_client.post(
            f"/api/users/{MISSING_ID}/reset-password",
            json={"new_password": NEW_PASSWORD},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Benutzer nicht gefunden"

    @pytest.mark.asyncio
    async def test_refused_in_demo_mode(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession, demo_mode
    ):
        old_hash = target_user.password_hash

        response = await admin_client.post(
            f"/api/users/{target_user.id}/reset-password",
            json={"new_password": NEW_PASSWORD},
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "Benutzerverwaltung ist im Demo-Modus nicht verfügbar"

        unchanged = await stored_user(db_session, target_user.id)
        assert unchanged is not None and unchanged.password_hash == old_hash

    @pytest.mark.asyncio
    async def test_reset_ends_the_targets_open_session(self, admin_client: AsyncClient, target_user: User):
        async with logged_in("ziel_benutzer", TEST_PASSWORD) as their_session:
            assert (await their_session.get("/api/auth/me")).status_code == 200

            await admin_client.post(
                f"/api/users/{target_user.id}/reset-password",
                json={"new_password": NEW_PASSWORD},
            )

            assert (await their_session.get("/api/auth/me")).status_code == 401


# ============================================
# DELETE /users/{id}
# ============================================


class TestDeleteUser:
    @pytest.mark.asyncio
    async def test_default_delete_is_a_deactivation(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        """`DELETE` without `permanent` keeps the row — the account has to stay
        referenceable from incidents and audit rows it created."""
        response = await admin_client.delete(f"/api/users/{target_user.id}")
        assert response.status_code == 204

        soft_deleted = await stored_user(db_session, target_user.id)
        assert soft_deleted is not None
        assert soft_deleted.is_active is False

        login = await login_attempt("ziel_benutzer", TEST_PASSWORD)
        assert login.status_code == 401
        assert login.json()["detail"] == "Benutzerkonto ist deaktiviert"

    @pytest.mark.asyncio
    async def test_deactivation_ends_an_open_session(self, admin_client: AsyncClient, target_user: User):
        async with logged_in("ziel_benutzer", TEST_PASSWORD) as their_session:
            await admin_client.delete(f"/api/users/{target_user.id}")
            assert (await their_session.get("/api/auth/me")).status_code == 401

    @pytest.mark.asyncio
    async def test_permanent_delete_removes_the_row(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        response = await admin_client.delete(f"/api/users/{target_user.id}?permanent=true")
        assert response.status_code == 204

        assert await stored_user(db_session, target_user.id) is None
        assert (await admin_client.get(f"/api/users/{target_user.id}")).status_code == 404
        assert (await login_attempt("ziel_benutzer", TEST_PASSWORD)).status_code == 401

    @pytest.mark.asyncio
    async def test_permanent_delete_frees_the_username(self, admin_client: AsyncClient, target_user: User):
        """The difference that makes `permanent` worth having: the name becomes
        available again, which a deactivated row would still be holding."""
        await admin_client.delete(f"/api/users/{target_user.id}?permanent=true")

        response = await admin_client.post(
            "/api/users/",
            json={"username": "ziel_benutzer", "password": NEW_PASSWORD, "role": "editor"},
        )
        assert response.status_code == 201

    @pytest.mark.asyncio
    @pytest.mark.parametrize("query", ["", "?permanent=true"])
    async def test_admin_cannot_delete_themselves(
        self, admin_client: AsyncClient, test_admin: User, db_session: AsyncSession, query: str
    ):
        """Both flavours are refused — the permanent one would leave a station with no
        admin at all and no way to make one."""
        response = await admin_client.delete(f"/api/users/{test_admin.id}{query}")
        assert response.status_code == 400
        assert response.json()["detail"] == "Sie können sich nicht selbst löschen"

        survivor = await stored_user(db_session, test_admin.id)
        assert survivor is not None and survivor.is_active is True

    @pytest.mark.asyncio
    async def test_unknown_id_is_404(self, admin_client: AsyncClient):
        response = await admin_client.delete(f"/api/users/{MISSING_ID}")
        assert response.status_code == 404
        assert response.json()["detail"] == "Benutzer nicht gefunden"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("query", ["", "?permanent=true"])
    async def test_refused_in_demo_mode(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession, demo_mode, query: str
    ):
        """The public demo is a shared sandbox — nobody gets to delete the accounts
        everyone else is signed in with."""
        response = await admin_client.delete(f"/api/users/{target_user.id}{query}")
        assert response.status_code == 403
        assert response.json()["detail"] == "Benutzerverwaltung ist im Demo-Modus nicht verfügbar"

        untouched = await stored_user(db_session, target_user.id)
        assert untouched is not None and untouched.is_active is True

    @pytest.mark.asyncio
    async def test_soft_delete_is_audited_as_deactivate(
        self, admin_client: AsyncClient, target_user: User, test_admin: User, db_session: AsyncSession
    ):
        await admin_client.delete(f"/api/users/{target_user.id}")

        entries = await user_audit_entries(db_session, target_user.id)
        assert [e.action_type for e in entries] == ["deactivate"]
        assert entries[0].user_id == test_admin.id
        assert entries[0].changes_json == {"username": "ziel_benutzer", "action": "deactivated"}

    @pytest.mark.asyncio
    async def test_permanent_delete_of_an_account_with_history(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        """The realistic case: the person has used the system, so `audit_log.user_id`
        points at them. That column is a plain FK with no ON DELETE rule, so the delete
        only succeeds because SQLAlchemy nullifies the children first — which is worth
        pinning down, because it means the trail keeps the *events* but loses who did
        them. Re-check this if the relationship or the FK ever grows a cascade.
        """
        async with logged_in("ziel_benutzer", TEST_PASSWORD):
            pass  # the login itself writes an audit row attributed to this account

        own_actions = await db_session.execute(
            select(AuditLog).where(AuditLog.user_id == target_user.id, AuditLog.action_type == "login_success")
        )
        assert own_actions.scalars().first() is not None

        response = await admin_client.delete(f"/api/users/{target_user.id}?permanent=true")
        assert response.status_code == 204

        db_session.expire_all()
        orphaned = await db_session.execute(
            select(AuditLog).where(AuditLog.resource_id == target_user.id, AuditLog.action_type == "login_success")
        )
        entry = orphaned.scalars().first()
        assert entry is not None, "the login event survives the account"
        assert entry.user_id is None, "but its attribution does not"

    @pytest.mark.asyncio
    async def test_permanent_delete_is_audited_with_the_lost_username(
        self, admin_client: AsyncClient, target_user: User, db_session: AsyncSession
    ):
        """After the row is gone the id resolves to nothing, so the audit entry is the
        only place the username survives — it has to be in there."""
        deleted_id = target_user.id
        await admin_client.delete(f"/api/users/{deleted_id}?permanent=true")

        entries = await user_audit_entries(db_session, deleted_id)
        assert [e.action_type for e in entries] == ["delete"]
        assert entries[0].changes_json == {"username": "ziel_benutzer", "action": "permanently_deleted"}


@pytest.mark.parametrize("password", ["kurz", "a" * 73, "ä" * 37])
async def test_invalid_reset_preserves_password_version_and_active_session(
    admin_client, target_user, db_session, password
):
    user_id = target_user.id
    old_hash = target_user.password_hash
    old_version = target_user.session_version
    async with logged_in(target_user.username, TEST_PASSWORD) as target_session:
        response = await admin_client.post(f"/api/users/{user_id}/reset-password", json={"new_password": password})
        assert response.status_code == 400
        assert password not in response.text
        stored = await stored_user(db_session, user_id)
        assert stored.password_hash == old_hash
        assert stored.session_version == old_version
        assert (await target_session.get("/api/auth/me")).status_code == 200
        assert (await target_session.post("/api/auth/refresh")).status_code == 200


@pytest.mark.parametrize("soft_delete", [False, True])
async def test_reactivation_does_not_restore_previous_sessions(admin_client, target_user, db_session, soft_delete):
    user_id = target_user.id
    async with logged_in(target_user.username, TEST_PASSWORD) as target_session:
        if soft_delete:
            disabled = await admin_client.delete(f"/api/users/{user_id}")
        else:
            disabled = await admin_client.put(f"/api/users/{user_id}", json={"is_active": False})
        assert disabled.status_code in (200, 204)
        stored = await stored_user(db_session, user_id)
        assert stored.session_version == 1
        assert (await admin_client.put(f"/api/users/{user_id}", json={"is_active": False})).status_code == 200
        stored = await stored_user(db_session, user_id)
        assert stored.session_version == 1  # Repeating deactivation is not another transition.
        assert (await admin_client.put(f"/api/users/{user_id}", json={"is_active": True})).status_code == 200
        assert (await target_session.get("/api/auth/me")).status_code == 401
        assert (await target_session.post("/api/auth/refresh")).status_code == 401


async def test_concurrent_resets_increment_version_without_losing_an_invalidation(test_engine, monkeypatch):
    """Two HTTP requests read epoch zero, then their independent transactions both advance it."""
    import asyncio

    from sqlalchemy import Update, delete
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.auth.security import create_login_tokens, verify_password
    from app.database import get_db
    from app.middleware.audit import _inflight_audit_tasks

    admin_id, target_id = uuid.uuid4(), uuid.uuid4()
    passwords = ("FirstConcurrentPassword123", "SecondConcurrentPassword123")
    ready = asyncio.Event()
    arrivals = 0

    class ConcurrentSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            nonlocal arrivals
            if isinstance(statement, Update) and statement.table.name == "users":
                arrivals += 1
                if arrivals == 2:
                    ready.set()
                await asyncio.wait_for(ready.wait(), timeout=5)
            return await super().execute(statement, *args, **kwargs)

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    prior_audit_tasks = set(_inflight_audit_tasks)
    async with sessions() as db:
        prior_audit_ids = set(await db.scalars(select(AuditLog.id)))
    request_sessions = async_sessionmaker(test_engine, class_=ConcurrentSession, expire_on_commit=False)
    async with sessions() as db:
        db.add_all(
            [
                User(id=admin_id, username=f"reset-admin-{admin_id}", password_hash=None, role="admin"),
                User(id=target_id, username=f"reset-target-{target_id}", password_hash=None, role="editor"),
            ]
        )
        await db.commit()

    async def request_db():
        async with request_sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, request_db)
    access, _ = create_login_tokens({"sub": str(admin_id), "role": "admin"})
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            client.cookies.set("access_token", access)
            responses = await asyncio.wait_for(
                asyncio.gather(
                    *(
                        client.post(f"/api/users/{target_id}/reset-password", json={"new_password": password})
                        for password in passwords
                    )
                ),
                timeout=10,
            )
            assert [response.status_code for response in responses] == [204, 204]
        async with sessions() as db:
            target = await db.get(User, target_id)
            assert target.session_version == 2
            assert any(verify_password(password, target.password_hash) for password in passwords)
    finally:
        # The independent requests also commit anonymous API audit rows. Drain
        # their tasks and remove only new IDs; other tests are sequential within
        # this worker and every earlier committed audit row must remain intact.
        await asyncio.gather(*(_inflight_audit_tasks - prior_audit_tasks))
        async with sessions() as db:
            await db.execute(delete(AuditLog).where(AuditLog.id.not_in(prior_audit_ids)))
            await db.execute(delete(User).where(User.id.in_([admin_id, target_id])))
            await db.commit()


async def test_password_login_overlapping_reset_cannot_inherit_new_epoch(test_engine, monkeypatch):
    """A password verified before a concurrent reset can only mint the old, revoked epoch."""
    import asyncio

    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.auth.security import create_login_tokens, decode_token
    from app.database import get_db
    from app.middleware.audit import _inflight_audit_tasks

    admin_id, target_id = uuid.uuid4(), uuid.uuid4()
    target_name = f"login-race-{target_id}"
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    prior_audit_tasks = set(_inflight_audit_tasks)
    async with sessions() as db:
        prior_audit_ids = set(await db.scalars(select(AuditLog.id)))
    verified = asyncio.Event()
    release_login = asyncio.Event()
    async with sessions() as db:
        db.add_all(
            [
                User(id=admin_id, username=f"race-admin-{admin_id}", password_hash=None, role="admin"),
                User(id=target_id, username=target_name, password_hash=hash_password(TEST_PASSWORD), role="editor"),
            ]
        )
        await db.commit()

    async def request_db():
        async with sessions() as db:
            yield db

    original_success = login_throttle.record_success

    async def pause_verified_login(client_ip, username):
        if username == target_name:
            verified.set()
            await release_login.wait()
        await original_success(client_ip, username)

    monkeypatch.setitem(app.dependency_overrides, get_db, request_db)
    monkeypatch.setattr(login_throttle, "record_success", pause_verified_login)
    access, _ = create_login_tokens({"sub": str(admin_id), "role": "admin"})
    login_task = None
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            client.cookies.set("access_token", access, domain="test.local")
            login_task = asyncio.create_task(
                client.post("/api/auth/login", data={"username": target_name, "password": TEST_PASSWORD})
            )
            await asyncio.wait_for(verified.wait(), timeout=5)
            reset = await client.post(f"/api/users/{target_id}/reset-password", json={"new_password": NEW_PASSWORD})
            assert reset.status_code == 204
            release_login.set()
            login = await asyncio.wait_for(login_task, timeout=5)
            assert login.status_code == 200
            for cookie in ("access_token", "refresh_token"):
                assert decode_token(login.cookies[cookie])["user_session_version"] == 0
            assert (await client.get("/api/auth/me")).status_code == 401
            assert (await client.post("/api/auth/refresh")).status_code == 401
        async with sessions() as db:
            assert (await db.get(User, target_id)).session_version == 1
    finally:
        release_login.set()
        if login_task is not None and not login_task.done():
            login_task.cancel()
            await asyncio.gather(login_task, return_exceptions=True)
        # The independent requests also commit anonymous API audit rows. Drain
        # their tasks and remove only new IDs; other tests are sequential within
        # this worker and every earlier committed audit row must remain intact.
        await asyncio.gather(*(_inflight_audit_tasks - prior_audit_tasks))
        async with sessions() as db:
            await db.execute(delete(AuditLog).where(AuditLog.id.not_in(prior_audit_ids)))
            await db.execute(delete(User).where(User.id.in_([admin_id, target_id])))
            await db.commit()
