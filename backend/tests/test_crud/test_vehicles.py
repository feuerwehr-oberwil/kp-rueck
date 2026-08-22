"""Tests for Vehicle CRUD operations.

Tests cover:
- get_all_vehicles: Get all vehicles
- get_vehicle: Get vehicle by ID
- create_vehicle: Create new vehicle
- update_vehicle: Update existing vehicle
- archive_vehicle / restore_vehicle: retire a vehicle and bring it back
- purge_vehicle: permanent delete, and the two rules that refuse it
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.crud import vehicles as vehicle_crud
from app.models import User, Vehicle

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="vehicle_test_editor",
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
        name="TLF Test",
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
async def multiple_vehicles(db_session: AsyncSession) -> list[Vehicle]:
    """Create multiple test vehicles."""
    vehicles = []
    for i, (name, vtype) in enumerate(
        [
            ("TLF 1", "TLF"),
            ("DLK 1", "DLK"),
            ("MTW 1", "MTW"),
            ("ELW 1", "ELW"),
        ]
    ):
        vehicle = Vehicle(
            id=uuid4(),
            name=name,
            type=vtype,
            status="available",
            display_order=i + 1,
        )
        db_session.add(vehicle)
        vehicles.append(vehicle)

    await db_session.commit()
    for v in vehicles:
        await db_session.refresh(v)
    return vehicles


@pytest.fixture
def mock_request():
    """Create a mock FastAPI request."""
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


# ============================================
# Test: get_all_vehicles
# ============================================


class TestGetAllVehicles:
    """Tests for get_all_vehicles function."""

    async def test_returns_all_vehicles(
        self,
        db_session: AsyncSession,
        multiple_vehicles: list[Vehicle],
    ):
        """Test getting all vehicles."""
        vehicles = await vehicle_crud.get_all_vehicles(db_session)

        assert len(vehicles) == 4

    async def test_returns_empty_when_no_vehicles(
        self,
        db_session: AsyncSession,
    ):
        """Test getting vehicles when none exist."""
        vehicles = await vehicle_crud.get_all_vehicles(db_session)

        assert len(vehicles) == 0

    async def test_orders_by_name(
        self,
        db_session: AsyncSession,
        multiple_vehicles: list[Vehicle],
    ):
        """Test vehicles are ordered by name."""
        vehicles = await vehicle_crud.get_all_vehicles(db_session)

        names = [v.name for v in vehicles]
        assert names == sorted(names)


# ============================================
# Test: get_vehicle
# ============================================


class TestGetVehicle:
    """Tests for get_vehicle function."""

    async def test_returns_vehicle_by_id(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
    ):
        """Test getting vehicle by ID."""
        vehicle = await vehicle_crud.get_vehicle(db_session, test_vehicle.id)

        assert vehicle is not None
        assert vehicle.id == test_vehicle.id
        assert vehicle.name == test_vehicle.name

    async def test_returns_none_for_nonexistent(
        self,
        db_session: AsyncSession,
    ):
        """Test returns None for nonexistent vehicle."""
        vehicle = await vehicle_crud.get_vehicle(db_session, uuid4())

        assert vehicle is None


# ============================================
# Test: create_vehicle
# ============================================


class TestCreateVehicle:
    """Tests for create_vehicle function."""

    async def test_creates_vehicle(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_request,
    ):
        """Test creating a new vehicle."""
        vehicle_data = schemas.VehicleCreate(
            name="New TLF",
            type="TLF",
            status="available",
            display_order=5,
            radio_call_sign="New-1",
        )

        vehicle = await vehicle_crud.create_vehicle(
            db=db_session,
            vehicle_data=vehicle_data,
            current_user=test_user,
            request=mock_request,
        )

        assert vehicle is not None
        assert vehicle.name == "New TLF"
        assert vehicle.type == "TLF"
        assert vehicle.status == "available"
        assert vehicle.display_order == 5
        assert vehicle.radio_call_sign == "New-1"

    async def test_creates_vehicle_with_all_required_fields(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_request,
    ):
        """Test creating vehicle with all required fields."""
        vehicle_data = schemas.VehicleCreate(
            name="Complete Vehicle",
            type="MTW",
            status="available",
            display_order=10,
            radio_call_sign="MTW-10",
        )

        vehicle = await vehicle_crud.create_vehicle(
            db=db_session,
            vehicle_data=vehicle_data,
            current_user=test_user,
            request=mock_request,
        )

        assert vehicle is not None
        assert vehicle.name == "Complete Vehicle"
        assert vehicle.display_order == 10
        assert vehicle.radio_call_sign == "MTW-10"


# ============================================
# Test: update_vehicle
# ============================================


class TestUpdateVehicle:
    """Tests for update_vehicle function."""

    async def test_updates_vehicle_name(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test updating vehicle name."""
        update_data = schemas.VehicleUpdate(name="Updated TLF")

        updated = await vehicle_crud.update_vehicle(
            db=db_session,
            vehicle_id=test_vehicle.id,
            vehicle_data=update_data,
            current_user=test_user,
            request=mock_request,
        )

        assert updated is not None
        assert updated.name == "Updated TLF"

    async def test_updates_vehicle_status(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test updating vehicle status."""
        update_data = schemas.VehicleUpdate(status="unavailable")

        updated = await vehicle_crud.update_vehicle(
            db=db_session,
            vehicle_id=test_vehicle.id,
            vehicle_data=update_data,
            current_user=test_user,
            request=mock_request,
        )

        assert updated is not None
        assert updated.status == "unavailable"

    async def test_updates_multiple_fields(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test updating multiple fields at once."""
        update_data = schemas.VehicleUpdate(
            name="Renamed TLF",
            type="DLK",
            status="unavailable",
        )

        updated = await vehicle_crud.update_vehicle(
            db=db_session,
            vehicle_id=test_vehicle.id,
            vehicle_data=update_data,
            current_user=test_user,
            request=mock_request,
        )

        assert updated is not None
        assert updated.name == "Renamed TLF"
        assert updated.type == "DLK"
        assert updated.status == "unavailable"

    async def test_returns_none_for_nonexistent(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_request,
    ):
        """Test returns None for nonexistent vehicle."""
        update_data = schemas.VehicleUpdate(name="Updated")

        updated = await vehicle_crud.update_vehicle(
            db=db_session,
            vehicle_id=uuid4(),
            vehicle_data=update_data,
            current_user=test_user,
            request=mock_request,
        )

        assert updated is None

    async def test_updates_timestamp(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test that updated_at timestamp is set."""
        update_data = schemas.VehicleUpdate(name="Updated Name")

        updated = await vehicle_crud.update_vehicle(
            db=db_session,
            vehicle_id=test_vehicle.id,
            vehicle_data=update_data,
            current_user=test_user,
            request=mock_request,
        )

        assert updated.updated_at is not None


# ============================================
# Test: archive / restore / purge
# ============================================


class TestArchiveVehicle:
    """Archiving retires a vehicle without touching its readiness."""

    async def test_archiving_hides_it_from_the_default_listing(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """The whole point: an archived vehicle really does leave the list."""
        archived = await vehicle_crud.archive_vehicle(
            db=db_session,
            vehicle_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        assert archived is not None
        assert archived.archived_at is not None
        # Readiness is a separate axis and must be untouched.
        assert archived.status == "available"
        assert archived.out_of_service is False

        assert await vehicle_crud.get_all_vehicles(db_session) == []
        assert len(await vehicle_crud.get_all_vehicles(db_session, include_archived=True)) == 1

    async def test_restore_brings_it_back(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """«Zurückholen» puts the row back on the board."""
        await vehicle_crud.archive_vehicle(
            db=db_session, vehicle_id=test_vehicle.id, current_user=test_user, request=mock_request
        )
        restored = await vehicle_crud.restore_vehicle(
            db=db_session, vehicle_id=test_vehicle.id, current_user=test_user, request=mock_request
        )

        assert restored is not None
        assert restored.archived_at is None
        assert len(await vehicle_crud.get_all_vehicles(db_session)) == 1

    async def test_returns_none_for_nonexistent(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_request,
    ):
        """Test returns None for nonexistent vehicle."""
        result = await vehicle_crud.archive_vehicle(
            db=db_session,
            vehicle_id=uuid4(),
            current_user=test_user,
            request=mock_request,
        )

        assert result is None


class TestPurgeVehicle:
    """Permanent delete: allowed, but only from the archive."""

    async def test_refuses_unless_archived_first(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Two deliberate steps — a live row cannot be purged by a stray query param."""
        outcome = await vehicle_crud.purge_vehicle(
            db=db_session, vehicle_id=test_vehicle.id, current_user=test_user, request=mock_request
        )

        assert outcome.purged is False
        assert outcome.refusal == "not_archived"

    async def test_purges_an_archived_vehicle_with_no_history(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """A typo or test entry really leaves the database."""
        vehicle_id = test_vehicle.id
        await vehicle_crud.archive_vehicle(
            db=db_session, vehicle_id=vehicle_id, current_user=test_user, request=mock_request
        )
        outcome = await vehicle_crud.purge_vehicle(
            db=db_session, vehicle_id=vehicle_id, current_user=test_user, request=mock_request
        )

        assert outcome.purged is True
        assert await vehicle_crud.get_vehicle(db_session, vehicle_id) is None

    async def test_returns_not_found_for_nonexistent(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_request,
    ):
        """Test reports not_found for nonexistent vehicle."""
        outcome = await vehicle_crud.purge_vehicle(
            db=db_session, vehicle_id=uuid4(), current_user=test_user, request=mock_request
        )

        assert outcome.purged is False
        assert outcome.refusal == "not_found"
