"""Tests for Vehicle model."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Vehicle


class TestVehicleModel:
    """Test Vehicle model operations."""

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
