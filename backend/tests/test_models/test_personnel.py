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
            availability="available",
        )
        db_session.add(person)
        await db_session.commit()
        await db_session.refresh(person)

        assert person.id is not None
        assert person.name == "M. Schmidt"
        assert person.role == "Fahrer"
        assert person.availability == "available"
        assert person.created_at is not None
        assert person.updated_at is not None

    async def test_personnel_optional_role(self, db_session: AsyncSession):
        """Test creating personnel without a role."""
        person = Personnel(
            id=uuid4(),
            name="Test Person",
            role=None,
            availability="available",
        )
        db_session.add(person)
        await db_session.commit()
        await db_session.refresh(person)

        assert person.role is None

    async def test_personnel_availability_constraint(self, db_session: AsyncSession):
        """Test that invalid availability is rejected."""
        person = Personnel(
            id=uuid4(),
            name="Test Person",
            role="Mannschaft",
            availability="invalid",  # Invalid
        )
        db_session.add(person)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_personnel_all_valid_availabilities(self, db_session: AsyncSession):
        """Test all valid availability statuses."""
        valid_availabilities = ["available", "unavailable"]

        for availability in valid_availabilities:
            person = Personnel(
                id=uuid4(),
                name=f"Person {availability}",
                role="Mannschaft",
                availability=availability,
            )
            db_session.add(person)
            await db_session.commit()
            await db_session.refresh(person)
            assert person.availability == availability

    async def test_personnel_fixture(self, test_personnel: Personnel):
        """Test the test_personnel fixture."""
        assert test_personnel.id is not None
        assert test_personnel.name == "Max Mustermann"
        assert test_personnel.role == "Gruppenführer"
        assert test_personnel.availability == "available"
