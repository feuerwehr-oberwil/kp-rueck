"""Tests for AuditLog model."""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


class TestAuditLogModel:
    """Test AuditLog model operations."""

    async def test_create_audit_log(self, db_session: AsyncSession, test_user: User):
        """Test creating an audit log entry."""
        log = AuditLog(
            id=uuid4(),
            user_id=test_user.id,
            action_type="create",
            resource_type="incident",
            resource_id=uuid4(),
            changes_json={"title": "New Incident", "status": "eingegangen"},
            ip_address="192.168.1.1",
            user_agent="Mozilla/5.0",
        )
        db_session.add(log)
        await db_session.commit()
        await db_session.refresh(log)

        assert log.id is not None
        assert log.user_id == test_user.id
        assert log.action_type == "create"
        assert log.resource_type == "incident"
        assert log.resource_id is not None
        assert log.changes_json == {"title": "New Incident", "status": "eingegangen"}
        assert str(log.ip_address) == "192.168.1.1"  # INET type returns IPv4Address object
        assert log.user_agent == "Mozilla/5.0"
        assert log.timestamp is not None

    async def test_audit_log_without_user(self, db_session: AsyncSession):
        """Test creating audit log for system actions."""
        log = AuditLog(
            id=uuid4(),
            user_id=None,
            action_type="system_cleanup",
            resource_type="incident",
            resource_id=uuid4(),
            changes_json={"archived": True},
        )
        db_session.add(log)
        await db_session.commit()
        await db_session.refresh(log)

        assert log.user_id is None

    async def test_audit_log_optional_fields(self, db_session: AsyncSession, test_user: User):
        """Test audit log with minimal fields."""
        log = AuditLog(
            id=uuid4(),
            user_id=test_user.id,
            action_type="update",
            resource_type="vehicle",
            resource_id=None,
            changes_json=None,
            ip_address=None,
            user_agent=None,
        )
        db_session.add(log)
        await db_session.commit()
        await db_session.refresh(log)

        assert log.resource_id is None
        assert log.changes_json is None
        assert log.ip_address is None
        assert log.user_agent is None

    async def test_audit_log_complex_changes(self, db_session: AsyncSession, test_user: User):
        """Test audit log with complex change data."""
        changes = {
            "before": {
                "status": "eingegangen",
                "priority": "medium",
                "assignments": [],
            },
            "after": {
                "status": "disponiert",
                "priority": "high",
                "assignments": ["vehicle-1", "personnel-1", "personnel-2"],
            },
        }
        log = AuditLog(
            id=uuid4(),
            user_id=test_user.id,
            action_type="update",
            resource_type="incident",
            resource_id=uuid4(),
            changes_json=changes,
        )
        db_session.add(log)
        await db_session.commit()
        await db_session.refresh(log)

        assert log.changes_json == changes
        assert log.changes_json["before"]["status"] == "eingegangen"
        assert len(log.changes_json["after"]["assignments"]) == 3

    async def test_audit_log_query_by_user(self, db_session: AsyncSession, test_user: User):
        """Test querying audit logs by user."""
        # Create multiple logs
        for i in range(3):
            log = AuditLog(
                id=uuid4(),
                user_id=test_user.id,
                action_type="update",
                resource_type="incident",
                resource_id=uuid4(),
            )
            db_session.add(log)
        await db_session.commit()

        # Query by user
        result = await db_session.execute(select(AuditLog).where(AuditLog.user_id == test_user.id))
        logs = result.scalars().all()
        assert len(logs) >= 3

    async def test_audit_log_query_by_resource(self, db_session: AsyncSession):
        """Test querying audit logs by resource."""
        resource_id = uuid4()

        # Create logs for same resource
        actions = ["create", "update", "delete"]
        for action in actions:
            log = AuditLog(
                id=uuid4(),
                action_type=action,
                resource_type="vehicle",
                resource_id=resource_id,
            )
            db_session.add(log)
        await db_session.commit()

        # Query by resource
        result = await db_session.execute(
            select(AuditLog).where(AuditLog.resource_type == "vehicle").where(AuditLog.resource_id == resource_id)
        )
        logs = result.scalars().all()
        assert len(logs) == 3
