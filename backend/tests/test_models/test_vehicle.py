"""Tests for Vehicle model."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Vehicle


class TestVehicleModel:
    """Test Vehicle model operations."""

    async def test_create_vehicle(self, db_session: AsyncSession):
        """Test creating a vehicle."""
        vehicle = Vehicle(
            id=uuid4(),
            name="TLF 1",
            type="TLF",
            status="available",
        )
        db_session.add(vehicle)
        await db_session.commit()
        await db_session.refresh(vehicle)

        assert vehicle.id is not None
        assert vehicle.name == "TLF 1"
        assert vehicle.type == "TLF"
        assert vehicle.status == "available"
        assert vehicle.created_at is not None
        assert vehicle.updated_at is not None

    async def test_vehicle_status_constraint(self, db_session: AsyncSession):
        """Test that invalid vehicle status is rejected."""
        vehicle = Vehicle(
            id=uuid4(),
            name="Test Vehicle",
            type="TLF",
            status="invalid_status",  # Invalid
        )
        db_session.add(vehicle)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_vehicle_all_valid_statuses(self, db_session: AsyncSession):
        """Test all valid vehicle statuses."""
        valid_statuses = ["available", "unavailable"]

        for status in valid_statuses:
            vehicle = Vehicle(
                id=uuid4(),
                name=f"Vehicle {status}",
                type="TLF",
                status=status,
            )
            db_session.add(vehicle)
            await db_session.commit()
            await db_session.refresh(vehicle)
            assert vehicle.status == status

    async def test_vehicle_fixture(self, test_vehicle: Vehicle):
        """Test the test_vehicle fixture."""
        assert test_vehicle.id is not None
        assert test_vehicle.name == "TLF 1"
        assert test_vehicle.type == "TLF"
        assert test_vehicle.status == "available"
