"""Tests for Material model."""
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Material


class TestMaterialModel:
    """Test Material model operations."""

    async def test_create_material(self, db_session: AsyncSession):
        """Test creating material."""
        material = Material(
            id=uuid4(),
            name="Wasserpumpe",
            status="available",
            location="Lager Raum 3",
        )
        db_session.add(material)
        await db_session.commit()
        await db_session.refresh(material)

        assert material.id is not None
        assert material.name == "Wasserpumpe"
        assert material.status == "available"
        assert material.location == "Lager Raum 3"
        assert material.created_at is not None
        assert material.updated_at is not None

    async def test_material_optional_fields(self, db_session: AsyncSession):
        """Test creating material without optional fields."""
        material = Material(
            id=uuid4(),
            name="Test Material",
            status="available",
            location=None,
        )
        db_session.add(material)
        await db_session.commit()
        await db_session.refresh(material)

        assert material.location is None

    async def test_material_status_constraint(self, db_session: AsyncSession):
        """Test that invalid material status is rejected."""
        material = Material(
            id=uuid4(),
            name="Test Material",
            status="invalid_status",  # Invalid
            location=None,
        )
        db_session.add(material)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_material_all_valid_statuses(self, db_session: AsyncSession):
        """Test all valid material statuses."""
        valid_statuses = ["available", "assigned", "maintenance"]

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

    async def test_material_with_location(self, db_session: AsyncSession):
        """Test material with location tracking."""
        material = Material(
            id=uuid4(),
            name="Test Equipment",
            status="assigned",
            location="TLF 1",
        )
        db_session.add(material)
        await db_session.commit()
        await db_session.refresh(material)

        assert material.location == "TLF 1"
