"""Tests for User model."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


class TestUserModel:
    """Test User model operations."""

    async def test_username_unique_constraint(self, db_session: AsyncSession):
        """Test that username must be unique."""
        user1 = User(
            id=uuid4(),
            username="duplicate_user",
            password_hash="password1",
            role="editor",
        )
        db_session.add(user1)
        await db_session.commit()

        # Try to create another user with same username
        user2 = User(
            id=uuid4(),
            username="duplicate_user",
            password_hash="password2",
            role="editor",
        )
        db_session.add(user2)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_invalid_role_constraint(self, db_session: AsyncSession):
        """Test that invalid role is rejected."""
        user = User(
            id=uuid4(),
            username="invalid_role_user",
            password_hash="password",
            role="superuser",  # Invalid role (only admin, editor, viewer allowed)
        )
        db_session.add(user)

        with pytest.raises(IntegrityError):
            await db_session.commit()
