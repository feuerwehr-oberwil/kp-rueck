"""Pytest configuration and fixtures for testing."""

import asyncio
from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.middleware.rate_limit import limiter

from app.database import Base
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

# Shared engine across all tests to avoid connection exhaustion
_shared_engine = None
_tables_created = False


@pytest.fixture(autouse=True)
def disable_rate_limiting():
    """Disable rate limiting for all tests to prevent 429 errors."""
    limiter.enabled = False
    yield
    limiter.enabled = True


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    """Provide a test database engine with clean tables.

    Uses a shared engine to avoid exhausting PostgreSQL connections,
    and TRUNCATE (not DROP/CREATE) to avoid type system race conditions.
    """
    global _shared_engine, _tables_created

    if _shared_engine is None:
        _shared_engine = create_async_engine(
            TEST_DATABASE_URL,
            echo=False,
            pool_size=5,
            max_overflow=5,
            pool_recycle=120,
            pool_pre_ping=True,
        )

    if not _tables_created:
        # First run: clean schema and create all tables
        async with _shared_engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
            await conn.run_sync(Base.metadata.create_all)
        _tables_created = True

    yield _shared_engine


# Build TRUNCATE statement once (all tables in a single statement)
_truncate_sql: str | None = None


def _get_truncate_sql() -> str:
    global _truncate_sql
    if _truncate_sql is None:
        table_names = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
        _truncate_sql = f"TRUNCATE {table_names} CASCADE" if table_names else ""
    return _truncate_sql


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a database session for testing.

    Truncates all tables at the start of each test to ensure isolation.
    Uses the same connection as the test session to avoid connection exhaustion.
    """
    async_session = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async with async_session() as session:
        # Truncate at the start of each test using the same session connection
        truncate = _get_truncate_sql()
        if truncate:
            await session.execute(text(truncate))
            await session.commit()
        yield session
        await session.rollback()


# ============================================
# Model Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user (editor role)."""
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
