"""First-run setup wizard: claiming an unclaimed board from the browser.

The `client` fixture starts every test on an empty users table, which is
exactly the unclaimed state — no fabricated fixtures needed. Both endpoints
are unauthenticated by design (being first IS the authentication), so plain
requests here also prove no auth layer accidentally 401s them.
"""

import logging

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import setup_token
from app.auth.security import verify_password
from app.config import settings
from app.models import AuditLog, Setting, User

CLAIM = {"station_name": "Feuerwehr Testwil", "admin_password": "chosen-in-browser-123"}


async def test_status_flips_across_a_claim(client: AsyncClient):
    response = await client.get("/api/setup/status")
    assert response.status_code == 200
    assert response.json() == {"claimed": False, "setup_token_required": False}

    response = await client.post("/api/setup", json=CLAIM)
    assert response.status_code == 201
    assert response.json() == {"username": "admin"}

    response = await client.get("/api/setup/status")
    assert response.json() == {"claimed": True, "setup_token_required": False}


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
    assert status.json()["claimed"] is False


async def test_blank_station_name_422s(client: AsyncClient):
    response = await client.post("/api/setup", json={"station_name": "   ", "admin_password": CLAIM["admin_password"]})
    assert response.status_code == 422


async def test_station_name_is_trimmed(client: AsyncClient, db_session: AsyncSession):
    await client.post(
        "/api/setup", json={"station_name": "  Feuerwehr Testwil  ", "admin_password": CLAIM["admin_password"]}
    )

    setting = (await db_session.execute(select(Setting).where(Setting.key == "firestation_name"))).scalar_one_or_none()
    assert setting is not None and setting.value == "Feuerwehr Testwil"


# ── The Einrichtungscode (auth/setup_token.py) ─────────────────────────────────


@pytest.fixture
async def token_required(monkeypatch):
    """An internet-facing board: the claim has to quote the code from the log."""
    await setup_token.reset_for_tests()
    monkeypatch.setattr(settings, "setup_token_required", True)
    monkeypatch.setattr(settings, "setup_token", "")
    yield
    await setup_token.reset_for_tests()


@pytest.fixture
def clean_env(monkeypatch):
    """Neither Railway nor a declared deployment, no domain, plain-http origins."""
    for name in (
        "ENVIRONMENT",
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_PROJECT_ID",
        "RAILWAY_SERVICE_ID",
        "RAILWAY_STATIC_URL",
        "RAILWAY_PUBLIC_DOMAIN",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(settings, "setup_token_required", None)
    monkeypatch.setattr(settings, "setup_token", "")
    monkeypatch.setattr(settings, "domain", "")
    monkeypatch.setattr(settings, "cors_origins", ["http://kp.local:8080"])
    return monkeypatch


def test_development_never_asks_for_a_code(clean_env):
    clean_env.setattr(settings, "domain", "kp.example.ch")
    assert setup_token.setup_token_required() is False


def test_a_lan_install_stays_first_visit_claims(clean_env):
    # ENVIRONMENT=production with no domain and plain http: the double-click path.
    clean_env.setenv("ENVIRONMENT", "production")
    assert setup_token.setup_token_required() is False


@pytest.mark.parametrize(
    "signal",
    [
        ("domain", "kp.example.ch"),
        ("env", "RAILWAY_PUBLIC_DOMAIN"),
        ("cors", "https://kp.example.ch"),
    ],
)
def test_an_internet_facing_deployment_asks_for_it(clean_env, signal):
    clean_env.setenv("ENVIRONMENT", "production")
    kind, value = signal
    if kind == "domain":
        clean_env.setattr(settings, "domain", value)
    elif kind == "env":
        clean_env.setenv(value, "kp.up.railway.app")
    else:
        clean_env.setattr(settings, "cors_origins", [value])
    assert setup_token.setup_token_required() is True


def test_the_explicit_setting_wins_both_ways(clean_env):
    clean_env.setenv("ENVIRONMENT", "production")
    clean_env.setattr(settings, "domain", "kp.example.ch")
    clean_env.setattr(settings, "setup_token_required", False)
    assert setup_token.setup_token_required() is False
    clean_env.delenv("ENVIRONMENT")
    clean_env.setattr(settings, "setup_token_required", True)
    assert setup_token.setup_token_required() is True


def test_a_configured_setup_token_implies_it(clean_env):
    clean_env.setattr(settings, "setup_token", "unser-eigener-code")
    assert setup_token.setup_token_required() is True


async def test_status_tells_the_page_to_ask(client: AsyncClient, token_required):
    response = await client.get("/api/setup/status")
    assert response.json() == {"claimed": False, "setup_token_required": True}

    await client.post("/api/setup", json={**CLAIM, "setup_token": setup_token.current_token()})
    # Claimed: nothing left to ask for.
    response = await client.get("/api/setup/status")
    assert response.json() == {"claimed": True, "setup_token_required": False}


@pytest.mark.parametrize("submitted", [None, "", "AAAA-AAAA-AAAA-AAAA"])
async def test_a_missing_or_wrong_code_claims_nothing(
    client: AsyncClient, db_session: AsyncSession, token_required, submitted
):
    body = CLAIM if submitted is None else {**CLAIM, "setup_token": submitted}
    response = await client.post("/api/setup", json=body)

    assert response.status_code == 403
    assert "Server-Log" in response.json()["detail"]
    assert (await db_session.execute(select(User))).first() is None


async def test_the_code_from_the_log_claims_the_board_once(client: AsyncClient, token_required):
    code = setup_token.current_token()
    # Copied out of a terminal by a human: case, spaces and dashes do not count.
    typed = f"  {code.replace('-', ' ').lower()} "

    response = await client.post("/api/setup", json={**CLAIM, "setup_token": typed})
    assert response.status_code == 201
    # Spent: not even a board that somehow lost its accounts takes it again.
    assert setup_token.matches(code) is False


async def test_wrong_codes_are_throttled_like_a_login(client: AsyncClient, token_required):
    code = setup_token.current_token()
    for _ in range(settings.login_max_failed_attempts):
        assert (await client.post("/api/setup", json={**CLAIM, "setup_token": "falsch"})).status_code == 403

    # Locked out, and the right code does not help until the wait is over.
    blocked = await client.post("/api/setup", json={**CLAIM, "setup_token": code})
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0


async def test_boot_prints_the_code_for_an_unclaimed_board(db_session: AsyncSession, token_required, caplog):
    from app.api.setup import announce_setup_token_if_unclaimed

    with caplog.at_level(logging.WARNING, logger="app.auth.setup_token"):
        await announce_setup_token_if_unclaimed(db_session)

    assert "Einrichtungscode" in caplog.text
    assert setup_token.current_token() in caplog.text


async def test_boot_prints_nothing_for_a_claimed_board(
    db_session: AsyncSession, test_admin: User, token_required, caplog
):
    from app.api.setup import announce_setup_token_if_unclaimed

    with caplog.at_level(logging.WARNING, logger="app.auth.setup_token"):
        await announce_setup_token_if_unclaimed(db_session)

    assert "Einrichtungscode" not in caplog.text


async def test_a_configured_code_works_and_is_never_logged(
    client: AsyncClient, db_session: AsyncSession, token_required, monkeypatch, caplog
):
    from app.api.setup import announce_setup_token_if_unclaimed

    monkeypatch.setattr(settings, "setup_token", "Unser-Eigener-Code-2026")
    with caplog.at_level(logging.WARNING, logger="app.auth.setup_token"):
        await announce_setup_token_if_unclaimed(db_session)

    assert "Einrichtungscode" in caplog.text
    assert "Unser-Eigener-Code-2026" not in caplog.text
    response = await client.post("/api/setup", json={**CLAIM, "setup_token": "unser eigener code 2026"})
    assert response.status_code == 201
