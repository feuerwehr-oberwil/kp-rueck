"""Tests for User model."""

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


class TestUserModel:
    """Test User model operations."""

    async def test_create_user_editor(self, db_session: AsyncSession):
        """Test creating a user with editor role."""
        user = User(
            id=uuid4(),
            username="editor_user",
            password_hash="hashed_password",
            role="editor",
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        assert user.id is not None
        assert user.username == "editor_user"
        assert user.role == "editor"
        assert user.created_at is not None
        assert user.last_login is None

    async def test_create_user_viewer(self, db_session: AsyncSession):
        """Test creating a user with viewer role."""
        user = User(
            id=uuid4(),
            username="viewer_user",
            password_hash="hashed_password",
            role="viewer",
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

        assert user.role == "viewer"

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
            role="viewer",
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
            role="admin",  # Invalid role
        )
        db_session.add(user)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_query_user_by_username(self, db_session: AsyncSession):
        """Test querying user by username."""
        # Create user
        user = User(
            id=uuid4(),
            username="query_test",
            password_hash="password",
            role="editor",
        )
        db_session.add(user)
        await db_session.commit()

        # Query by username
        result = await db_session.execute(select(User).where(User.username == "query_test"))
        found_user = result.scalar_one()

        assert found_user.id == user.id
        assert found_user.username == "query_test"

    async def test_user_fixture(self, test_user: User):
        """Test the test_user fixture."""
        assert test_user.id is not None
        assert test_user.username == "test_editor"
        assert test_user.role == "editor"
