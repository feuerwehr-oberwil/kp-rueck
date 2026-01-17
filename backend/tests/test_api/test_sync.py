"""Tests for Sync API endpoints.

Tests cover:
- Sync status endpoint
- Sync config endpoint
- Sync logs endpoint
- Error handling (sync in progress, Railway unreachable)
- Permission requirements

Note: These tests mock the sync_service since we can't connect
to Railway in the test environment. Integration tests with actual
Railway sync would need a separate test environment.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import User

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """Create an async test client with test database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_editor(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="sync_editor",
        password_hash=hash_password("editorpass123"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "sync_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Sync Status Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_status_requires_auth(client: AsyncClient):
    """Test that sync status endpoint requires authentication."""
    response = await client.get("/api/sync/status")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_status_success(editor_client: AsyncClient):
    """Test getting sync status."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        # Mock the sync service
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=False)  # Railway not configured in test
        mock_create.return_value = mock_service

        response = await editor_client.get("/api/sync/status")
        assert response.status_code == 200
        data = response.json()

        # Verify response structure
        assert "railway_healthy" in data
        assert "is_syncing" in data
        assert "records_pending" in data
        # last_sync may be None if no syncs have been done
        assert "last_sync" in data


# ============================================
# Sync Config Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_config_requires_auth(client: AsyncClient):
    """Test that sync config endpoint requires authentication."""
    response = await client.get("/api/sync/config")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_config_success(editor_client: AsyncClient):
    """Test getting sync configuration."""
    response = await editor_client.get("/api/sync/config")
    assert response.status_code == 200
    data = response.json()

    # Verify response structure
    assert "sync_interval_minutes" in data
    assert "auto_sync_on_create" in data
    assert "is_production" in data
    assert isinstance(data["sync_interval_minutes"], int)
    assert isinstance(data["auto_sync_on_create"], bool)


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_sync_config(editor_client: AsyncClient):
    """Test updating sync configuration."""
    config_update = {
        "sync_interval_minutes": 5,
        "auto_sync_on_create": False,
    }

    response = await editor_client.put("/api/sync/config", json=config_update)
    assert response.status_code == 200
    data = response.json()

    assert data["sync_interval_minutes"] == 5
    assert data["auto_sync_on_create"] is False


# ============================================
# Sync Logs Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_logs_requires_auth(client: AsyncClient):
    """Test that sync logs endpoint requires authentication."""
    response = await client.get("/api/sync/logs")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_logs_empty(editor_client: AsyncClient):
    """Test getting sync logs when none exist."""
    response = await editor_client.get("/api/sync/logs")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_history_alias(editor_client: AsyncClient):
    """Test that /history is an alias for /logs."""
    response = await editor_client.get("/api/sync/history")
    assert response.status_code == 200
    # Should return same format as /logs
    assert isinstance(response.json(), list)


# ============================================
# Sync Trigger Tests (Mocked)
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_from_railway_requires_auth(client: AsyncClient):
    """Test that sync from Railway requires authentication."""
    response = await client.post("/api/sync/from-railway")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_to_railway_requires_auth(client: AsyncClient):
    """Test that sync to Railway requires authentication."""
    response = await client.post("/api/sync/to-railway")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_bidirectional_requires_auth(client: AsyncClient):
    """Test that bidirectional sync requires authentication."""
    response = await client.post("/api/sync/bidirectional")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_bidirectional_railway_unreachable(editor_client: AsyncClient):
    """Test that sync fails gracefully when Railway is unreachable."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=False)
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/bidirectional")
        assert response.status_code == 503
        assert "unreachable" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_trigger_immediate_sync_railway_unavailable(editor_client: AsyncClient):
    """Test immediate sync when Railway is unavailable."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=False)
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/trigger-immediate")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["railway_healthy"] is False


# ============================================
# Delta Endpoint Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_invalid_table(editor_client: AsyncClient):
    """Test getting delta for invalid table name."""
    response = await editor_client.get("/api/sync/delta/invalid_table")
    assert response.status_code == 400
    assert "invalid table" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_valid_table(editor_client: AsyncClient):
    """Test getting delta for valid table."""
    response = await editor_client.get("/api/sync/delta/personnel")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_with_timestamp_filter(editor_client: AsyncClient):
    """Test getting delta with timestamp filter."""
    response = await editor_client.get("/api/sync/delta/personnel?updated_since=2024-01-01T00:00:00")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_invalid_timestamp(editor_client: AsyncClient):
    """Test getting delta with invalid timestamp."""
    response = await editor_client.get("/api/sync/delta/personnel?updated_since=invalid")
    assert response.status_code == 400
    assert "timestamp" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_apply_delta_invalid_table(editor_client: AsyncClient):
    """Test applying delta to invalid table."""
    response = await editor_client.post("/api/sync/apply/invalid_table", json=[])
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_apply_delta_empty_records(editor_client: AsyncClient):
    """Test applying empty delta."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.apply_delta = AsyncMock(return_value={"personnel": 0})
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/apply/personnel", json=[])
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0


# ============================================
# Sync Lock Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_rejects_concurrent_operations(editor_client: AsyncClient):
    """Test that concurrent sync operations are rejected.

    This test simulates the scenario where a sync is already in progress
    and another sync request comes in.
    """
    import app.api.sync as sync_module

    # Manually set the sync lock
    original_is_syncing = sync_module._is_syncing
    sync_module._is_syncing = True

    try:
        response = await editor_client.post("/api/sync/from-railway")
        assert response.status_code == 409
        assert "already in progress" in response.json()["detail"].lower()

        response = await editor_client.post("/api/sync/to-railway")
        assert response.status_code == 409

        response = await editor_client.post("/api/sync/bidirectional")
        assert response.status_code == 409
    finally:
        # Restore original state
        sync_module._is_syncing = original_is_syncing


# ============================================
# Sync Status with Data Tests
# ============================================


@pytest_asyncio.fixture
async def sync_log_success(db_session: AsyncSession) -> "SyncLog":
    """Create a successful sync log entry."""
    from datetime import datetime, UTC
    from uuid import uuid4

    from app.models import SyncLog

    log = SyncLog(
        id=uuid4(),
        sync_direction="from_railway",
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
        status="success",
        records_synced={"incidents": 5, "personnel": 3},
        errors=None,
    )
    db_session.add(log)
    await db_session.commit()
    await db_session.refresh(log)
    return log


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_status_with_successful_sync(editor_client: AsyncClient, sync_log_success):
    """Test getting sync status when a successful sync exists."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=True)
        mock_create.return_value = mock_service

        response = await editor_client.get("/api/sync/status")
        assert response.status_code == 200
        data = response.json()

        # Should have sync data from the log
        assert data["last_sync"] is not None
        assert data["direction"] == "from_railway"
        assert data["railway_healthy"] is True
        assert data["records_pending"] == 8  # 5 + 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_status_with_last_error(editor_client: AsyncClient):
    """Test getting sync status shows last error."""
    import app.api.sync as sync_module

    original_result = sync_module._last_sync_result
    sync_module._last_sync_result = {
        "success": False,
        "errors": ["Connection timeout", "Database locked"],
    }

    try:
        with patch("app.api.sync.create_sync_service") as mock_create:
            mock_service = AsyncMock()
            mock_service.check_railway_health = AsyncMock(return_value=False)
            mock_create.return_value = mock_service

            response = await editor_client.get("/api/sync/status")
            assert response.status_code == 200
            data = response.json()

            assert data["last_error"] == "Connection timeout"
    finally:
        sync_module._last_sync_result = original_result


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_status_with_empty_errors(editor_client: AsyncClient):
    """Test getting sync status with failed result but no error messages."""
    import app.api.sync as sync_module

    original_result = sync_module._last_sync_result
    sync_module._last_sync_result = {"success": False, "errors": []}

    try:
        with patch("app.api.sync.create_sync_service") as mock_create:
            mock_service = AsyncMock()
            mock_service.check_railway_health = AsyncMock(return_value=True)
            mock_create.return_value = mock_service

            response = await editor_client.get("/api/sync/status")
            assert response.status_code == 200
            data = response.json()
            assert data["last_error"] is None
    finally:
        sync_module._last_sync_result = original_result


# ============================================
# Sync Operations Success Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_from_railway_success(editor_client: AsyncClient):
    """Test successful sync from Railway."""
    from datetime import datetime, UTC

    from app.schemas import SyncDirection, SyncResult

    mock_result = SyncResult(
        success=True,
        direction=SyncDirection.FROM_RAILWAY,
        records_synced={"incidents": 10, "personnel": 5},
        errors=None,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
    )

    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.sync_from_railway = AsyncMock(return_value=mock_result)
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/from-railway")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["direction"] == "from_railway"
        assert data["records_synced"]["incidents"] == 10
        assert data["completed_at"] is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_to_railway_success(editor_client: AsyncClient):
    """Test successful sync to Railway."""
    from datetime import datetime, UTC

    from app.schemas import SyncDirection, SyncResult

    mock_result = SyncResult(
        success=True,
        direction=SyncDirection.TO_RAILWAY,
        records_synced={"incidents": 3, "vehicles": 2},
        errors=None,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
    )

    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.sync_to_railway = AsyncMock(return_value=mock_result)
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/to-railway")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["direction"] == "to_railway"
        assert data["records_synced"]["incidents"] == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_bidirectional_success(editor_client: AsyncClient):
    """Test successful bidirectional sync."""
    from datetime import datetime, UTC

    from app.schemas import SyncDirection, SyncResult

    from_railway_result = SyncResult(
        success=True,
        direction=SyncDirection.FROM_RAILWAY,
        records_synced={"incidents": 5},
        errors=None,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
    )
    to_railway_result = SyncResult(
        success=True,
        direction=SyncDirection.TO_RAILWAY,
        records_synced={"personnel": 3},
        errors=None,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
    )

    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=True)
        mock_service.sync_bidirectional = AsyncMock(
            return_value={"from_railway": from_railway_result, "to_railway": to_railway_result}
        )
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/bidirectional")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["from_railway"]["success"] is True
        assert data["to_railway"]["success"] is True
        assert data["from_railway"]["records_synced"]["incidents"] == 5
        assert data["to_railway"]["records_synced"]["personnel"] == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_trigger_immediate_sync_success(editor_client: AsyncClient):
    """Test successful immediate sync trigger."""
    from datetime import datetime, UTC

    from app.schemas import SyncDirection, SyncResult

    from_railway_result = SyncResult(
        success=True,
        direction=SyncDirection.FROM_RAILWAY,
        records_synced={"incidents": 2},
        errors=None,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
    )
    to_railway_result = SyncResult(
        success=True,
        direction=SyncDirection.TO_RAILWAY,
        records_synced={"materials": 1},
        errors=None,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
    )

    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=True)
        mock_service.sync_bidirectional = AsyncMock(
            return_value={"from_railway": from_railway_result, "to_railway": to_railway_result}
        )
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/trigger-immediate")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["from_railway"]["records_synced"]["incidents"] == 2
        assert data["to_railway"]["records_synced"]["materials"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_trigger_immediate_already_syncing(editor_client: AsyncClient):
    """Test that immediate sync returns graceful response when already syncing."""
    import app.api.sync as sync_module

    original_is_syncing = sync_module._is_syncing
    sync_module._is_syncing = True

    try:
        response = await editor_client.post("/api/sync/trigger-immediate")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["is_syncing"] is True
        assert "already in progress" in data["message"].lower()
    finally:
        sync_module._is_syncing = original_is_syncing


# ============================================
# Sync Logs with Data Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_logs_with_entries(editor_client: AsyncClient, sync_log_success):
    """Test getting sync logs when entries exist."""
    response = await editor_client.get("/api/sync/logs")
    assert response.status_code == 200
    logs = response.json()

    assert len(logs) == 1
    log = logs[0]
    assert log["sync_direction"] == "from_railway"
    assert log["status"] == "success"
    assert log["records_synced"] == {"incidents": 5, "personnel": 3}


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_logs_with_limit(editor_client: AsyncClient, db_session: AsyncSession):
    """Test getting sync logs with custom limit."""
    from datetime import datetime, UTC
    from uuid import uuid4

    from app.models import SyncLog

    # Create multiple logs
    for i in range(5):
        log = SyncLog(
            id=uuid4(),
            sync_direction="from_railway",
            started_at=datetime.now(UTC),
            completed_at=datetime.now(UTC),
            status="success",
            records_synced={"incidents": i},
        )
        db_session.add(log)
    await db_session.commit()

    response = await editor_client.get("/api/sync/logs?limit=3")
    assert response.status_code == 200
    logs = response.json()
    assert len(logs) == 3


# ============================================
# Sync Config Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_sync_config_all_fields(editor_client: AsyncClient):
    """Test updating all sync configuration fields."""
    config_update = {
        "sync_interval_minutes": 10,
        "auto_sync_on_create": False,
        "sync_conflict_buffer_seconds": 15,
        "railway_database_url": "postgresql://test:test@localhost/testdb",
    }

    response = await editor_client.put("/api/sync/config", json=config_update)
    assert response.status_code == 200
    data = response.json()

    assert data["sync_interval_minutes"] == 10
    assert data["auto_sync_on_create"] is False
    assert data["sync_conflict_buffer_seconds"] == 15


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_sync_config_partial(editor_client: AsyncClient):
    """Test updating only some sync configuration fields."""
    # Only update interval
    response = await editor_client.put("/api/sync/config", json={"sync_interval_minutes": 15})
    assert response.status_code == 200
    data = response.json()
    assert data["sync_interval_minutes"] == 15


# ============================================
# Delta Endpoint Tests with Data
# ============================================


@pytest_asyncio.fixture
async def test_personnel_for_sync(db_session: AsyncSession):
    """Create test personnel for delta tests."""
    from uuid import uuid4

    from app.models import Personnel

    personnel = Personnel(
        id=uuid4(),
        name="Delta Test Person",
        role="Gruppenführer",
        availability="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_returns_records(editor_client: AsyncClient, test_personnel_for_sync):
    """Test getting delta returns actual records."""
    response = await editor_client.get("/api/sync/delta/personnel")
    assert response.status_code == 200
    records = response.json()

    assert len(records) >= 1
    # Find our test personnel
    found = any(r["name"] == "Delta Test Person" for r in records)
    assert found


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_with_timestamp_filter(editor_client: AsyncClient, test_personnel_for_sync):
    """Test that timestamp filter parameter is accepted."""
    # Use past timestamp - should return some records including our test personnel
    past_time = "2020-01-01T00:00:00"
    response = await editor_client.get(f"/api/sync/delta/personnel?updated_since={past_time}")
    assert response.status_code == 200
    records = response.json()
    # Should return at least the test personnel we created
    assert len(records) >= 1
    found = any(r["name"] == "Delta Test Person" for r in records)
    assert found


@pytest.mark.asyncio
@pytest.mark.api
async def test_apply_delta_with_records(editor_client: AsyncClient):
    """Test applying delta with actual records."""
    from uuid import uuid4

    records = [
        {
            "id": str(uuid4()),
            "name": "New Applied Personnel",
            "role": "Mannschaft",
            "availability": "available",
        }
    ]

    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.apply_delta = AsyncMock(return_value={"personnel": 1})
        mock_create.return_value = mock_service

        response = await editor_client.post("/api/sync/apply/personnel", json=records)
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_all_syncable_tables(editor_client: AsyncClient):
    """Test getting delta for all syncable tables."""
    syncable_tables = ["incidents", "personnel", "vehicles", "materials", "settings"]

    for table in syncable_tables:
        response = await editor_client.get(f"/api/sync/delta/{table}")
        assert response.status_code == 200, f"Failed for table: {table}"
        assert isinstance(response.json(), list)
