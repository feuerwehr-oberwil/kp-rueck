"""Pytest configuration and fixtures for testing."""

import contextlib
import os
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import make_url, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import get_current_user
from app.auth.security import hash_password
from app.database import Base, get_db
from app.main import app
from app.middleware.rate_limit import limiter
from app.models import (
    Event,
    Incident,
    Material,
    Personnel,
    Setting,
    User,
    Vehicle,
)
from app.traccar import traccar_client

# Test database URL - use a separate test database. Default targets the host-mapped
# port; override via env when running inside the dev container (where the db service
# is reachable as postgres:5432 instead of localhost:5433).
#
# This is the ONE place a database URL is written down. Anything under tests/ that needs a
# database — including the scratch database the migration-drift test builds — derives it from
# here via `worker_database_url()`, so that pointing TEST_DATABASE_URL at another host or port
# moves the whole suite and not just most of it.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck_test"
)


def _assert_target_is_a_test_database(url: str) -> None:
    """Refuse to run against a database whose name does not mark it as disposable.

    The session fixture runs `DROP SCHEMA public CASCADE` on whatever TEST_DATABASE_URL
    names, and that variable is routinely overridden — the documented recipe for running
    the suite inside the dev container sets it, so "export it and forget" is a normal state
    for this repo. Nothing checked what it pointed at.

    A name check is the whole guard, and it is enough: every database this suite is allowed
    to touch is one it creates itself (`kprueck_test`, `kprueck_test_gw0`,
    `kprueck_test_drift`). A station's database is called `kprueck` or `railway`, and now
    says so before the DROP rather than after.
    """
    name = make_url(url).database or ""
    if "test" not in name.lower():
        raise RuntimeError(
            f"Refusing to run the test suite against database {name!r}: the name does not contain 'test'.\n"
            "This suite DROPs and recreates the public schema, so it only ever runs against a\n"
            "throwaway database. Check TEST_DATABASE_URL — it may still be pointing at a real one."
        )


_assert_target_is_a_test_database(TEST_DATABASE_URL)

# Which pytest-xdist worker this process is (`gw0`, `gw1`, …), or None when running serially.
# Set by xdist in every worker subprocess; the controller process never runs tests.
XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")


def worker_database_url(suffix: str = "") -> str:
    """The database URL this process should use, isolated per xdist worker.

    Serially this is exactly TEST_DATABASE_URL (plus `suffix`), so a developer running plain
    `uv run pytest` still gets the single `kprueck_test` database and needs no extra
    privileges. Under `-n`, the worker id is appended — `kprueck_test_gw0`, `kprueck_test_gw1`
    — because workers are separate processes hammering the same tables otherwise, which is how
    a reliable suite becomes a flaky one.

    `suffix` exists for the migration-drift test, which needs a second scratch database of its
    own (`kprueck_test_drift`) built purely from Alembic.
    """
    url = make_url(TEST_DATABASE_URL)
    name = f"{url.database}{suffix}"
    if XDIST_WORKER:
        name = f"{name}_{XDIST_WORKER}"
    return url.set(database=name).render_as_string(hide_password=False)


def admin_database_url() -> str:
    """A connection used only to CREATE/DROP the per-worker databases.

    CREATE DATABASE cannot run from inside the database being created, so this points at the
    configured test database itself — the one database on that server we know exists, because
    serial runs use it. Derived from TEST_DATABASE_URL, never hardcoded.
    """
    return TEST_DATABASE_URL


async def run_admin_statements(*statements: str) -> None:
    """Execute DDL that must not run in a transaction (CREATE/DROP DATABASE)."""
    engine = create_async_engine(admin_database_url(), isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            for statement in statements:
                await conn.execute(text(statement))
    finally:
        await engine.dispose()


async def create_scratch_database(url: str) -> None:
    """(Re-)create the database named in `url`, from an admin connection elsewhere."""
    name = make_url(url).database
    await run_admin_statements(
        f'DROP DATABASE IF EXISTS "{name}" (FORCE)',
        f'CREATE DATABASE "{name}"',
    )


async def drop_scratch_database(url: str) -> None:
    """Best-effort teardown. A leaked database is harmless — the next run drops it first —
    so a failure here must never mask the actual test result."""
    name = make_url(url).database
    with contextlib.suppress(Exception):
        await run_admin_statements(f'DROP DATABASE IF EXISTS "{name}" (FORCE)')


# The database this worker actually runs against.
WORKER_DATABASE_URL = worker_database_url()

# Standard test password (>= 12 chars to satisfy MIN_PASSWORD_LENGTH)
TEST_PASSWORD = "testpassword1234"


@pytest.fixture(autouse=True)
def disable_rate_limiting():
    """Disable rate limiting for all tests to prevent 429 errors."""
    limiter.enabled = False
    yield
    limiter.enabled = True


@pytest.fixture(autouse=True)
def block_outbound_http(monkeypatch):
    """Fail loudly on any test that opens a real network socket.

    The suite reaches the app in-process through httpx's ASGITransport, which is a
    different class and is left alone; only the two transports that would open a socket
    are replaced. So a test that calls out to a live service — the station's production
    Traccar at `settings.traccar_url` was doing exactly that — now raises here instead of
    quietly depending on, and adding load to, somebody's running server. Anything that
    genuinely needs an outbound response mocks its own client.
    """

    def _blocked(self, request, *args, **kwargs):
        raise RuntimeError(
            f"Test attempted a live HTTP request to {request.url}. Outbound network access is "
            "blocked in the test suite — mock the client at its module seam instead."
        )

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _blocked)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _blocked)


@pytest.fixture(autouse=True)
def traccar_unconfigured(monkeypatch):
    """Keep the shared Traccar client unconfigured for the whole suite.

    `TraccarClient` snapshots its credentials at import, so a developer's `backend/.env`
    (which points at the station's *production* GPS server) made every endpoint that
    renders a viewer or display payload call that server for real — `api/viewer.py::
    _viewer_vehicle_positions` was the loudest one. Blanking the singleton's credentials
    puts it on its documented "GPS is optional" path: callers get [] without an HTTP
    request, which is also what a station without Traccar sees.

    Only the client instance is touched, not `settings` — the integration registry tests
    assert on `settings.traccar_*` and keep working. Tests that do want positions patch
    the `traccar_client` name in their own module, which this does not interfere with.
    """
    monkeypatch.setattr(traccar_client, "base_url", "")
    monkeypatch.setattr(traccar_client, "email", "")
    monkeypatch.setattr(traccar_client, "password", "")


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Provide a test database engine, created once per session (i.e. once per xdist worker).

    Under `-n`, each worker first creates its own database (`kprueck_test_gw0`, …) and drops it
    again at the end; serially there is nothing to create and the configured database is used
    directly, exactly as before. Either way the schema is then wiped and rebuilt from
    Base.metadata by the same code — one way of preparing a test schema, not two.
    """
    if XDIST_WORKER:
        await create_scratch_database(WORKER_DATABASE_URL)

    engine = create_async_engine(
        WORKER_DATABASE_URL,
        echo=False,
        pool_size=5,
        max_overflow=5,
        pool_recycle=120,
        pool_pre_ping=True,
    )

    # Create all tables once
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
        await conn.run_sync(Base.metadata.create_all)
        # `special_function_types` is a lookup table, so an empty one makes every
        # role invalid — the schema alone is not a working database. The
        # migration seeds it in a real deployment; this is the same rows for a
        # schema built straight from the metadata.
        await conn.execute(
            text(
                "INSERT INTO special_function_types (key, label_de, label_fr, requires_vehicle, sort_order) "
                "VALUES ('driver','Fahrer','Chauffeur',true,10), ('reko','Reko','Reco',false,20), "
                "('magazin','Magazin','Magasin',false,30), "
                "('telefondienst','Telefondienst','Service téléphonique',false,40), "
                "('kommandoposten','Kommandoposten','Poste de commandement',false,50)"
            )
        )

    yield engine

    await engine.dispose()

    if XDIST_WORKER:
        await drop_scratch_database(WORKER_DATABASE_URL)


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a database session for testing.

    Uses transaction rollback for fast test isolation:
    - Opens a real transaction on the connection
    - Session commits become savepoints (via join_transaction_mode)
    - After the test, the outer transaction rolls back everything
    """
    async with test_engine.connect() as connection:
        transaction = await connection.begin()

        session = AsyncSession(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )

        yield session

        await session.close()
        await transaction.rollback()


@pytest_asyncio.fixture
async def session_factory(test_engine):
    """A session *factory* bound to one rolled-back connection.

    Most fixtures hand out a session, but the token blocklist deliberately takes none — it
    opens its own short-lived session per call so that `dependencies.py` and `api/auth.py`
    can stay ignorant of the DB. Testing it therefore needs a factory rather than a session.

    Every session the factory makes is bound to the same connection, so the store's own
    commits land inside the test's outer transaction and disappear on the rollback below.
    Same isolation as `db_session`, one level of indirection further out.
    """
    async with test_engine.connect() as connection:
        transaction = await connection.begin()

        maker = async_sessionmaker(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )

        yield maker

        await transaction.rollback()


@pytest_asyncio.fixture(autouse=True)
async def _bind_token_blocklist_to_test_db(test_engine):
    """Point the global blocklist singleton at the test database.

    The blocklist opens its own sessions instead of taking a handle, so that the auth
    dependency chain doesn't have to thread one through. The cost is that in tests it would
    otherwise resolve `app.database.async_session_maker` and write to whatever database the
    developer's own .env points at — which, before the store moved into the DB, was
    harmless, because there was nothing to write.

    Autouse rather than opt-in: any test that reaches `get_current_user` can touch the
    singleton without asking for it, and a missed binding would be a confusing failure in
    an unrelated test rather than an obvious one here.

    These sessions commit for real (no enclosing transaction to roll back), so the table is
    emptied afterwards instead.
    """
    from app.auth.token_blocklist import token_blocklist

    maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    original = token_blocklist._session_factory
    token_blocklist._session_factory = maker

    yield

    try:
        async with maker() as session:
            await session.execute(text("DELETE FROM revoked_tokens"))
            await session.commit()
    finally:
        token_blocklist._session_factory = original


@pytest_asyncio.fixture(autouse=True)
async def _bind_audit_logging_to_test_db(test_engine, monkeypatch):
    """Point the audit middleware's own session factory at the test database.

    `app/database.py` builds `audit_engine` from `settings.database_url` at import time — a
    deliberately separate pool so audit writes can't exhaust the request pool. In tests the
    middleware normally logs through the injected `app.state.test_db_session` and never
    touches it, but any request that reaches the app WITHOUT the `client` fixture takes the
    production branch and fires an audit task at whatever `DATABASE_URL` points at: on a
    developer's machine, their live `kprueck` database.

    Same reasoning as the blocklist fixture above, and autouse for the same reason — a test
    that forgets to ask would silently write somewhere else. Under `-n` it matters more:
    every worker would aim at that one database at once.
    """
    monkeypatch.setattr(
        "app.middleware.audit.audit_session_maker",
        async_sessionmaker(bind=test_engine, expire_on_commit=False),
    )


# ============================================
# HTTP Client Fixtures
# ============================================


@pytest_asyncio.fixture(autouse=True)
async def _bind_socket_authorization_to_test_db(db_session, monkeypatch):
    """Socket delivery checks use the test transaction, never a local deployment's DB."""
    monkeypatch.setattr(
        "app.auth.socket_sessions.async_session_maker",
        async_sessionmaker(bind=db_session.bind, expire_on_commit=False, join_transaction_mode="create_savepoint"),
    )


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client with test database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    # Inject session into app state so audit middleware uses same transaction
    app.state.test_db_session = db_session

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    app.state.test_db_session = None


@pytest_asyncio.fixture
async def test_editor(db_session: AsyncSession) -> User:
    """Create an editor user with a known password for login tests."""
    user = User(
        id=uuid4(),
        username="fixture_editor",
        password_hash=hash_password(TEST_PASSWORD),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "fixture_editor", "password": TEST_PASSWORD},
    )
    assert response.status_code == 200, f"Editor login failed: {response.text}"
    return client


@pytest_asyncio.fixture
async def test_admin(db_session: AsyncSession) -> User:
    """Create an admin user with a known password for login tests."""
    user = User(
        id=uuid4(),
        username="fixture_admin",
        password_hash=hash_password(TEST_PASSWORD),
        role="admin",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_client(client: AsyncClient, test_admin: User) -> AsyncClient:
    """Create an authenticated client with admin privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "fixture_admin", "password": TEST_PASSWORD},
    )
    assert response.status_code == 200, f"Admin login failed: {response.text}"
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient) -> AsyncClient:
    """Create an authenticated client with viewer privileges.

    Uses dependency override since viewer role is not a DB role.
    The get_current_editor dependency will reject this user with 403.
    """
    viewer_user = User(
        id=uuid4(),
        username="fixture_viewer",
        password_hash="",
        role="viewer",
        display_name="Test Viewer",
        is_active=True,
        created_at=datetime.now(UTC),
    )

    async def override_get_current_user():
        return viewer_user

    app.dependency_overrides[get_current_user] = override_get_current_user
    return client


# ============================================
# Model Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user (editor role) for model/relationship tests."""
    user = User(
        id=uuid4(),
        username="test_editor",
        password_hash="hashed_password",
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_viewer(db_session: AsyncSession) -> User:
    """Create a second test user (editor role).

    Note: Viewer access is token-based (no DB user). This fixture creates
    a second editor user for tests that need multiple users.
    """
    user = User(
        id=uuid4(),
        username="test_viewer",
        password_hash="hashed_password",
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    """Create a test vehicle."""
    vehicle = Vehicle(
        id=uuid4(),
        name="TLF 1",
        type="TLF",
        status="available",
        display_order=1,
        radio_call_sign="Test-1",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create a test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Max Mustermann",
        role="Gruppenführer",
        status="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def test_material(db_session: AsyncSession) -> Material:
    """Create a test material."""
    material = Material(
        id=uuid4(),
        name="Stromerzeuger 5kW",
        type="Stromerzeuger",
        status="available",
        location="Lager Raum 3",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event_obj = Event(
        id=uuid4(),
        name="Test Event",
        training_flag=False,
    )
    db_session.add(event_obj)
    await db_session.commit()
    await db_session.refresh(event_obj)
    return event_obj


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_user: User, test_event: Event) -> Incident:
    """Create a test incident."""
    incident = Incident(
        id=uuid4(),
        title="Wohnungsbrand",
        type="brandbekaempfung",
        priority="high",
        location_address="Hauptstrasse 123, Basel",
        location_lat=47.5596,
        location_lng=7.5886,
        status="incoming",
        event_id=test_event.id,
        description="Brand in Mehrfamilienhaus",
        created_by=test_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_settings(db_session: AsyncSession) -> list[Setting]:
    """Create default test settings."""
    settings = [
        Setting(key="polling_interval_ms", value="5000"),
        Setting(key="training_mode", value="false"),
        Setting(key="auto_archive_timeout_hours", value="24"),
        Setting(key="notification_enabled", value="false"),
        Setting(key="alarm_webhook_secret", value="test_secret"),
    ]
    for setting in settings:
        db_session.add(setting)
    await db_session.commit()
    for setting in settings:
        await db_session.refresh(setting)
    return settings


# ============================================
# Helper Fixtures
# ============================================


@pytest.fixture
def valid_incident_data() -> dict:
    """Return valid incident data for testing."""
    return {
        "title": "Test Incident",
        "type": "brandbekaempfung",
        "priority": "medium",
        "location_address": "Test Street 1",
        "location_lat": 47.5596,
        "location_lng": 7.5886,
        "status": "incoming",
        "description": "Test description",
    }


@pytest.fixture
def valid_user_data() -> dict:
    """Return valid user data for testing."""
    return {
        "username": "test_user",
        "password_hash": "hashed_password",
        "role": "editor",
    }


async def feld_device_token(db: AsyncSession, event_id: UUID, personnel_id: UUID) -> str:
    """A `/feld` token as a phone actually holds one: through the door and bound.

    Since plan 26 (decisions 13 and 18) a bare link token opens nothing — it is
    only the right to be asked for the Feld-Code. Any test that wants to *act* as
    somebody through the field surface has to hold what a real device holds:
    unlocked, bound to one person, and pointing at a live claim row.

    Lives here rather than in one test module because both the `/feld` suite and
    the KP-parity suite need it, and two copies of a credential helper is how
    one of them quietly keeps testing the old rule.
    """
    from app.models import FeldDeviceClaim
    from app.services.tokens import generate_feld_token

    claim = FeldDeviceClaim(event_id=event_id, personnel_id=personnel_id)
    db.add(claim)
    await db.commit()
    await db.refresh(claim)
    return generate_feld_token(event_id, personnel_id=personnel_id, unlocked=True, claim_id=claim.id)


async def feld_unlock_token(client: AsyncClient, event: Event) -> str:
    """Obtain a real picker credential through the public code exchange."""
    from app.services.tokens import generate_feld_token

    response = await client.post(
        f"/api/feld/unlock?token={generate_feld_token(event.id)}", json={"code": event.feld_code}
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]
