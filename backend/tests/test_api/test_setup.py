"""First-run setup wizard: claiming an unclaimed board from the browser.

The `client` fixture starts every test on an empty users table, which is
exactly the unclaimed state — no fabricated fixtures needed. Both endpoints
are unauthenticated by design (being first IS the authentication), so plain
requests here also prove no auth layer accidentally 401s them.
"""

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import verify_password
from app.models import AuditLog, Setting, User

CLAIM = {"station_name": "Feuerwehr Testwil", "admin_password": "chosen-in-browser-123"}


async def test_status_flips_across_a_claim(client: AsyncClient):
    response = await client.get("/api/setup/status")
    assert response.status_code == 200
    assert response.json() == {"claimed": False}

    response = await client.post("/api/setup", json=CLAIM)
    assert response.status_code == 201
    assert response.json() == {"username": "admin"}

    response = await client.get("/api/setup/status")
    assert response.json() == {"claimed": True}


async def test_claim_creates_the_production_account_set(client: AsyncClient, db_session: AsyncSession):
    """Same set the ADMIN_SEED_PASSWORD seed path creates: dev-user bypass row,
    admin with the submitted password, viewer with a random unreturned one."""
    response = await client.post("/api/setup", json=CLAIM)
    assert response.status_code == 201
    # The random viewer password must not leak through the response.
    assert set(response.json()) == {"username"}

    users = (await db_session.execute(select(User))).scalars().all()
    by_name = {user.username: user for user in users}
    assert set(by_name) == {"dev-user", "admin", "viewer"}
    assert by_name["admin"].role == "admin"
    assert verify_password(CLAIM["admin_password"], by_name["admin"].password_hash)
    assert by_name["dev-user"].password_hash == ""  # bypass FK target, never a login
    assert by_name["viewer"].role == "viewer"
    # Viewer got its own random password, not the admin's.
    assert by_name["viewer"].password_hash
    assert not verify_password(CLAIM["admin_password"], by_name["viewer"].password_hash)

    setting = (await db_session.execute(select(Setting).where(Setting.key == "firestation_name"))).scalar_one_or_none()
    assert setting is not None and setting.value == "Feuerwehr Testwil"

    audit = (await db_session.execute(select(AuditLog).where(AuditLog.action_type == "setup_claim"))).scalars().all()
    assert len(audit) == 1
    assert audit[0].user_id == by_name["admin"].id


async def test_admin_can_log_in_right_after_the_claim(client: AsyncClient):
    """The frontend's next step — and proof the login path works from empty-DB state."""
    await client.post("/api/setup", json=CLAIM)

    response = await client.post(
        "/api/auth/login",
        data={"username": "admin", "password": CLAIM["admin_password"]},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "admin"


async def test_second_claim_409s(client: AsyncClient):
    await client.post("/api/setup", json=CLAIM)

    response = await client.post("/api/setup", json=CLAIM)
    assert response.status_code == 409


async def test_any_existing_user_blocks_the_claim(client: AsyncClient, test_admin: User):
    """Claimed = at least one user exists, whoever created it."""
    response = await client.post("/api/setup", json=CLAIM)
    assert response.status_code == 409


async def test_short_password_422s(client: AsyncClient):
    """Mirrors the seed's ADMIN_SEED_PASSWORD minimum of 12 characters."""
    response = await client.post(
        "/api/setup", json={"station_name": "Feuerwehr Testwil", "admin_password": "elevenchars"}
    )
    assert response.status_code == 422

    # ...and an invalid claim claims nothing.
    status = await client.get("/api/setup/status")
    assert status.json() == {"claimed": False}


async def test_blank_station_name_422s(client: AsyncClient):
    response = await client.post("/api/setup", json={"station_name": "   ", "admin_password": CLAIM["admin_password"]})
    assert response.status_code == 422


async def test_station_name_is_trimmed(client: AsyncClient, db_session: AsyncSession):
    await client.post(
        "/api/setup", json={"station_name": "  Feuerwehr Testwil  ", "admin_password": CLAIM["admin_password"]}
    )

    setting = (await db_session.execute(select(Setting).where(Setting.key == "firestation_name"))).scalar_one_or_none()
    assert setting is not None and setting.value == "Feuerwehr Testwil"
