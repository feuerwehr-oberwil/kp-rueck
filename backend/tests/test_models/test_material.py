"""Tests for Material model."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Material


class TestMaterialModel:
    """Test Material model operations."""

    async def test_material_status_constraint(self, db_session: AsyncSession):
        """Test that invalid material status is rejected."""
        material = Material(
            id=uuid4(),
            name="Test Material",
            status="invalid_status",  # Invalid
        )
        db_session.add(material)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_material_all_valid_statuses(self, db_session: AsyncSession):
        """Test all valid material statuses."""
        valid_statuses = ["available", "unavailable"]

        for status in valid_statuses:
            material = Material(
                id=uuid4(),
                name=f"Material {status}",
                status=status,
                location="Test",
            )
            db_session.add(material)
            await db_session.commit()
            await db_session.refresh(material)
            assert material.status == status
