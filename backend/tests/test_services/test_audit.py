"""Tests for audit logging service."""
from datetime import datetime
from uuid import uuid4
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User
from app.services.audit import (
    calculate_changes,
    log_action,
    log_login,
    log_logout,
)


class TestLogAction:
    """Test log_action function."""

    @pytest.mark.asyncio
    async def test_log_action_basic(self, db_session: AsyncSession):
        """Verify basic audit log creation with minimal parameters."""
        audit_entry = await log_action(
            db=db_session,
            action_type="create",
            resource_type="incident",
        )

        assert audit_entry.action_type == "create"
        assert audit_entry.resource_type == "incident"
        assert audit_entry.timestamp is not None
        assert audit_entry.user_id is None
        assert audit_entry.resource_id is None

    @pytest.mark.asyncio
    async def test_log_action_with_user(self, db_session: AsyncSession, test_user: User):
        """Verify user_id is captured correctly."""
        audit_entry = await log_action(
            db=db_session,
            action_type="update",
            resource_type="vehicle",
            user=test_user,
        )

        assert audit_entry.user_id == test_user.id

    @pytest.mark.asyncio
    async def test_log_action_with_resource_id(self, db_session: AsyncSession):
        """Verify resource_id is captured."""
        resource_id = uuid4()
        audit_entry = await log_action(
            db=db_session,
            action_type="delete",
            resource_type="personnel",
            resource_id=resource_id,
        )

        assert audit_entry.resource_id == resource_id

    @pytest.mark.asyncio
    async def test_log_action_with_changes(self, db_session: AsyncSession):
        """Verify changes_json is stored correctly."""
        changes = {
            "status": {"before": "eingegangen", "after": "reko"},
            "priority": {"before": "low", "after": "high"},
        }

        audit_entry = await log_action(
            db=db_session,
            action_type="update",
            resource_type="incident",
            changes=changes,
        )

        assert audit_entry.changes_json == changes
        assert audit_entry.changes_json["status"]["before"] == "eingegangen"
        assert audit_entry.changes_json["priority"]["after"] == "high"

    @pytest.mark.asyncio
    async def test_log_action_with_request_metadata(
        self, db_session: AsyncSession, test_user: User
    ):
        """Verify IP address and user agent extraction."""
        # Create mock Request object
        mock_request = MagicMock()
        mock_request.client.host = "192.168.1.100"
        mock_request.headers.get = MagicMock(
            side_effect=lambda key, default=None: {
                "User-Agent": "Mozilla/5.0 TestClient"
            }.get(key, default)
        )

        audit_entry = await log_action(
            db=db_session,
            action_type="create",
            resource_type="incident",
            user=test_user,
            request=mock_request,
        )

        assert str(audit_entry.ip_address) == "192.168.1.100"
        assert audit_entry.user_agent == "Mozilla/5.0 TestClient"

    @pytest.mark.asyncio
    async def test_log_action_with_x_forwarded_for(self, db_session: AsyncSession):
        """Verify X-Forwarded-For header takes precedence over client.host."""
        mock_request = MagicMock()
        mock_request.client.host = "10.0.0.1"
        mock_request.headers.get = MagicMock(
            side_effect=lambda key, default=None: {
                "X-Forwarded-For": "203.0.113.42",
                "User-Agent": "TestClient/1.0",
            }.get(key, default)
        )

        audit_entry = await log_action(
            db=db_session,
            action_type="login_success",
            resource_type="user",
            request=mock_request,
        )

        assert str(audit_entry.ip_address) == "203.0.113.42"

    @pytest.mark.asyncio
    async def test_log_action_without_request(self, db_session: AsyncSession):
        """Verify system actions work without request object."""
        audit_entry = await log_action(
            db=db_session,
            action_type="system_cleanup",
            resource_type="incident",
        )

        assert audit_entry.ip_address is None
        assert audit_entry.user_agent is None


class TestLogLogin:
    """Test log_login function."""

    @pytest.mark.asyncio
    async def test_log_login_success(self, db_session: AsyncSession, test_user: User):
        """Verify login_success action is created."""
        mock_request = MagicMock()
        mock_request.client.host = "127.0.0.1"
        mock_request.headers.get = MagicMock(return_value=None)

        audit_entry = await log_login(
            db=db_session, user=test_user, request=mock_request, success=True
        )

        assert audit_entry.action_type == "login_success"
        assert audit_entry.resource_type == "user"
        assert audit_entry.user_id == test_user.id
        assert audit_entry.resource_id == test_user.id

    @pytest.mark.asyncio
    async def test_log_login_failure(self, db_session: AsyncSession, test_user: User):
        """Verify login_failure action is created."""
        mock_request = MagicMock()
        mock_request.client.host = "127.0.0.1"
        mock_request.headers.get = MagicMock(return_value=None)

        audit_entry = await log_login(
            db=db_session, user=test_user, request=mock_request, success=False
        )

        assert audit_entry.action_type == "login_failure"
        assert audit_entry.resource_type == "user"
        assert audit_entry.user_id is None  # Failed login doesn't set user_id
        assert audit_entry.resource_id == test_user.id


class TestLogLogout:
    """Test log_logout function."""

    @pytest.mark.asyncio
    async def test_log_logout(self, db_session: AsyncSession, test_user: User):
        """Verify logout action is created."""
        mock_request = MagicMock()
        mock_request.client.host = "127.0.0.1"
        mock_request.headers.get = MagicMock(return_value=None)

        audit_entry = await log_logout(db=db_session, user=test_user, request=mock_request)

        assert audit_entry.action_type == "logout"
        assert audit_entry.resource_type == "user"
        assert audit_entry.user_id == test_user.id
        assert audit_entry.resource_id == test_user.id


class TestCalculateChanges:
    """Test calculate_changes function."""

    def test_calculate_changes_simple(self):
        """Verify diff calculation for simple field changes."""
        before = {"status": "eingegangen"}
        after = {"status": "reko"}

        changes = calculate_changes(before, after)

        assert changes == {"status": {"before": "eingegangen", "after": "reko"}}

    def test_calculate_changes_complex(self):
        """Verify diff handles multiple fields, additions, deletions."""
        before = {
            "status": "eingegangen",
            "priority": "medium",
            "assignee": "John",
        }
        after = {
            "status": "reko",
            "priority": "medium",
            "location": "Basel",
        }

        changes = calculate_changes(before, after)

        # Changed field
        assert changes["status"]["before"] == "eingegangen"
        assert changes["status"]["after"] == "reko"

        # Unchanged field should not be in changes
        assert "priority" not in changes

        # Removed field
        assert changes["assignee"]["before"] == "John"
        assert changes["assignee"]["after"] is None

        # Added field
        assert changes["location"]["before"] is None
        assert changes["location"]["after"] == "Basel"
