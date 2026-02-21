"""Pytest configuration and fixtures for testing."""

from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

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

# Test database URL - use a separate test database
TEST_DATABASE_URL = "postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck_test"

# Standard test password (>= 12 chars to satisfy MIN_PASSWORD_LENGTH)
TEST_PASSWORD = "testpassword1234"


@pytest.fixture(autouse=True)
def disable_rate_limiting():
    """Disable rate limiting for all tests to prevent 429 errors."""
    limiter.enabled = False
    yield
    limiter.enabled = True


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Provide a test database engine, created once per session.

    Drops and recreates all tables once at the start of the test session.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL,
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

    yield engine

    await engine.dispose()


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


# ============================================
# HTTP Client Fixtures
# ============================================


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
        availability="available",
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
        status="eingegangen",
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
        "status": "eingegangen",
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
