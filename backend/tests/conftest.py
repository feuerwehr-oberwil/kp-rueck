"""Pytest configuration and fixtures for testing."""
import asyncio
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.database import Base
from app.models import (
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    Setting,
    User,
    Vehicle,
)

# Test database URL - use a separate test database
TEST_DATABASE_URL = "postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck_test"


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    """Create a test database engine with all tables."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        poolclass=NullPool,
    )

    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    # Drop all tables after test
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a database session for testing."""
    async_session = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async with async_session() as session:
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
    """Create a test user (viewer role)."""
    user = User(
        id=uuid4(),
        username="test_viewer",
        password_hash="hashed_password",
        role="viewer",
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
async def test_incident(db_session: AsyncSession, test_user: User) -> Incident:
    """Create a test incident."""
    incident = Incident(
        id=uuid4(),
        title="Wohnungsbrand",
        type="fire",
        priority="high",
        location_address="Hauptstrasse 123, Basel",
        location_lat=47.5596,
        location_lng=7.5886,
        status="eingegangen",
        training_flag=False,
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
        "type": "fire",
        "priority": "medium",
        "location_address": "Test Street 1",
        "location_lat": 47.5596,
        "location_lng": 7.5886,
        "status": "eingegangen",
        "training_flag": False,
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
