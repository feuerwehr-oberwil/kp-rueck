"""Tests for Personnel model."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Personnel


class TestPersonnelModel:
    """Test Personnel model operations."""

    async def test_create_personnel(self, db_session: AsyncSession):
        """Test creating personnel."""
        person = Personnel(
            id=uuid4(),
            name="M. Schmidt",
            role="Fahrer",
            status="available",
        )
        db_session.add(person)
        await db_session.commit()
        await db_session.refresh(person)

        assert person.id is not None
        assert person.name == "M. Schmidt"
        assert person.role == "Fahrer"
        assert person.status == "available"
        assert person.created_at is not None
        assert person.updated_at is not None

    async def test_personnel_optional_role(self, db_session: AsyncSession):
        """Test creating personnel without a role."""
        person = Personnel(
            id=uuid4(),
            name="Test Person",
            role=None,
            status="available",
        )
        db_session.add(person)
        await db_session.commit()
        await db_session.refresh(person)

        assert person.role is None

    async def test_personnel_status_constraint(self, db_session: AsyncSession):
        """Test that an invalid status is rejected."""
        person = Personnel(
            id=uuid4(),
            name="Test Person",
            role="Mannschaft",
            status="invalid",  # Invalid
        )
        db_session.add(person)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_personnel_all_valid_statuses(self, db_session: AsyncSession):
        """Test all valid statuses."""
        valid_statuses = ["available", "unavailable"]

        for status in valid_statuses:
            person = Personnel(
                id=uuid4(),
                name=f"Person {status}",
                role="Mannschaft",
                status=status,
            )
            db_session.add(person)
            await db_session.commit()
            await db_session.refresh(person)
            assert person.status == status

    async def test_personnel_fixture(self, test_personnel: Personnel):
        """Test the test_personnel fixture."""
        assert test_personnel.id is not None
        assert test_personnel.name == "Max Mustermann"
        assert test_personnel.role == "Gruppenführer"
        assert test_personnel.status == "available"
