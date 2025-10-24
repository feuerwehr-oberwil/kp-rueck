"""Tests for audit log API endpoints."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import AuditLog, User


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """Create an async test client with test database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_editor_user(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="audit_editor",
        password_hash=hash_password("editorpass"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_viewer_user(db_session: AsyncSession) -> User:
    """Create a test viewer user."""
    user = User(
        id=uuid4(),
        username="audit_viewer",
        password_hash=hash_password("viewerpass"),
        role="viewer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def authenticated_editor_client(
    client: AsyncClient, test_editor_user: User
) -> AsyncClient:
    """Create authenticated editor client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "audit_editor", "password": "editorpass"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def authenticated_viewer_client(
    client: AsyncClient, test_viewer_user: User
) -> AsyncClient:
    """Create authenticated viewer client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "audit_viewer", "password": "viewerpass"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def test_audit_entries(
    db_session: AsyncSession, test_editor_user: User
) -> list[AuditLog]:
    """Create test audit log entries."""
    entries = []
    resource_ids = [uuid4() for _ in range(3)]

    # Create varied entries
    entry_configs = [
        {"action": "create", "resource": "incident", "rid": resource_ids[0]},
        {"action": "update", "resource": "incident", "rid": resource_ids[0]},
        {"action": "delete", "resource": "incident", "rid": resource_ids[0]},
        {"action": "create", "resource": "vehicle", "rid": resource_ids[1]},
        {"action": "update", "resource": "vehicle", "rid": resource_ids[1]},
        {"action": "create", "resource": "personnel", "rid": resource_ids[2]},
    ]

    for i, config in enumerate(entry_configs):
        entry = AuditLog(
            id=uuid4(),
            user_id=test_editor_user.id,
            action_type=config["action"],
            resource_type=config["resource"],
            resource_id=config["rid"],
            changes_json={"field": f"value_{i}"},
            timestamp=datetime.now(timezone.utc) - timedelta(minutes=i),
        )
        db_session.add(entry)
        entries.append(entry)

    await db_session.commit()
    return entries


class TestAuditLogAuthentication:
    """Test authentication and authorization for audit endpoints."""

    @pytest.mark.asyncio
    async def test_query_audit_log_requires_editor(
        self, authenticated_viewer_client: AsyncClient
    ):
        """Verify viewer role gets 403 Forbidden."""
        response = await authenticated_viewer_client.get("/api/audit")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_query_audit_log_unauthenticated(self, client: AsyncClient):
        """Verify unauthenticated request gets 401."""
        response = await client.get("/api/audit")
        assert response.status_code == 401


class TestAuditLogQuery:
    """Test audit log query endpoint."""

    @pytest.mark.asyncio
    async def test_query_audit_log_no_filters(
        self, authenticated_editor_client: AsyncClient, test_audit_entries: list[AuditLog]
    ):
        """Verify default query returns entries ordered by timestamp desc."""
        response = await authenticated_editor_client.get("/api/audit")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 6

        # Verify ordering (most recent first)
        timestamps = [entry["timestamp"] for entry in data]
        assert timestamps == sorted(timestamps, reverse=True)

    @pytest.mark.asyncio
    async def test_query_audit_log_filter_resource_type(
        self, authenticated_editor_client: AsyncClient, test_audit_entries: list[AuditLog]
    ):
        """Query with resource_type filter."""
        response = await authenticated_editor_client.get(
            "/api/audit?resource_type=incident"
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 3  # Only incident entries
        assert all(entry["resource_type"] == "incident" for entry in data)

    @pytest.mark.asyncio
    async def test_query_audit_log_filter_resource_id(
        self, authenticated_editor_client: AsyncClient, test_audit_entries: list[AuditLog]
    ):
        """Query with resource_id filter."""
        # Get a specific resource_id from test entries
        resource_id = test_audit_entries[0].resource_id

        response = await authenticated_editor_client.get(
            f"/api/audit?resource_id={resource_id}"
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 3  # Three actions on same incident
        assert all(entry["resource_id"] == str(resource_id) for entry in data)

    @pytest.mark.asyncio
    async def test_query_audit_log_filter_user_id(
        self,
        authenticated_editor_client: AsyncClient,
        test_audit_entries: list[AuditLog],
        test_editor_user: User,
    ):
        """Query with user_id filter."""
        response = await authenticated_editor_client.get(
            f"/api/audit?user_id={test_editor_user.id}"
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data) >= 6
        assert all(entry["user_id"] == str(test_editor_user.id) for entry in data)

    @pytest.mark.asyncio
    async def test_query_audit_log_filter_action_type(
        self, authenticated_editor_client: AsyncClient, test_audit_entries: list[AuditLog]
    ):
        """Query with action_type filter."""
        response = await authenticated_editor_client.get("/api/audit?action_type=create")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 3  # Three create actions
        assert all(entry["action_type"] == "create" for entry in data)

    @pytest.mark.asyncio
    async def test_query_audit_log_filter_date_range(
        self, authenticated_editor_client: AsyncClient, test_audit_entries: list[AuditLog]
    ):
        """Query with date range filter."""
        now = datetime.now(timezone.utc)
        start_date = (now - timedelta(minutes=10)).isoformat()
        end_date = now.isoformat()

        response = await authenticated_editor_client.get(
            f"/api/audit?start_date={start_date}&end_date={end_date}"
        )
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, list)
        # All test entries should be within this range
        assert len(data) >= 6

    @pytest.mark.asyncio
    async def test_query_audit_log_pagination(
        self, authenticated_editor_client: AsyncClient, db_session: AsyncSession
    ):
        """Test pagination with limit and offset."""
        # Create many entries
        for i in range(150):
            entry = AuditLog(
                id=uuid4(),
                action_type="test",
                resource_type="test",
                timestamp=datetime.now(timezone.utc) - timedelta(seconds=i),
            )
            db_session.add(entry)
        await db_session.commit()

        # First page
        response1 = await authenticated_editor_client.get("/api/audit?limit=50&offset=0")
        assert response1.status_code == 200
        data1 = response1.json()
        assert len(data1) == 50

        # Second page
        response2 = await authenticated_editor_client.get("/api/audit?limit=50&offset=50")
        assert response2.status_code == 200
        data2 = response2.json()
        assert len(data2) == 50

        # Verify different results
        assert data1[0]["id"] != data2[0]["id"]

    @pytest.mark.asyncio
    async def test_query_audit_log_max_limit(
        self, authenticated_editor_client: AsyncClient
    ):
        """Query with limit > 1000 should be capped."""
        response = await authenticated_editor_client.get("/api/audit?limit=2000")
        # Should fail validation (le=1000)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_query_audit_log_empty_result(
        self, authenticated_editor_client: AsyncClient
    ):
        """Query with filters matching no entries."""
        response = await authenticated_editor_client.get(
            "/api/audit?resource_type=nonexistent_type"
        )
        assert response.status_code == 200

        data = response.json()
        assert data == []


class TestResourceHistory:
    """Test resource history endpoint."""

    @pytest.mark.asyncio
    async def test_get_resource_history(
        self, authenticated_editor_client: AsyncClient, test_audit_entries: list[AuditLog]
    ):
        """Get complete history for a specific resource."""
        resource_id = test_audit_entries[0].resource_id
        resource_type = test_audit_entries[0].resource_type

        response = await authenticated_editor_client.get(
            f"/api/audit/resource/{resource_type}/{resource_id}"
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 3  # create, update, delete for same resource
        assert all(entry["resource_id"] == str(resource_id) for entry in data)
        assert all(entry["resource_type"] == resource_type for entry in data)

        # Verify chronological order (most recent first)
        timestamps = [entry["timestamp"] for entry in data]
        assert timestamps == sorted(timestamps, reverse=True)

    @pytest.mark.asyncio
    async def test_get_resource_history_requires_editor(
        self, authenticated_viewer_client: AsyncClient
    ):
        """Verify viewer role gets 403."""
        fake_id = uuid4()
        response = await authenticated_viewer_client.get(
            f"/api/audit/resource/incident/{fake_id}"
        )
        assert response.status_code == 403
