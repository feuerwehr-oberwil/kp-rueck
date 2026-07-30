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
    # Route audit-middleware writes into the rolled-back test session.
    # Without this they fire-and-forget into the shared test DB and pollute
    # global-count assertions elsewhere (e.g. the audit-cleanup tests).
    app.state.test_db_session = db_session

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    app.state.test_db_session = None


@pytest_asyncio.fixture
async def sync_admin_user(db_session: AsyncSession) -> User:
    """Create an admin user (sync endpoints are admin-only)."""
    user = User(
        id=uuid4(),
        username="sync_admin",
        password_hash=hash_password("editorpass123"),
        role="admin",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def sync_admin_client(client: AsyncClient, sync_admin_user: User) -> AsyncClient:
    """Create an authenticated client with admin privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "sync_admin", "password": "editorpass123"},
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
async def test_get_sync_status_success(sync_admin_client: AsyncClient):
    """Test getting sync status."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        # Mock the sync service
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=False)  # Railway not configured in test
        mock_create.return_value = mock_service

        response = await sync_admin_client.get("/api/sync/status")
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
async def test_get_sync_config_success(sync_admin_client: AsyncClient):
    """Test getting sync configuration."""
    response = await sync_admin_client.get("/api/sync/config")
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
async def test_update_sync_config(sync_admin_client: AsyncClient):
    """Test updating sync configuration."""
    config_update = {
        "sync_interval_minutes": 5,
        "auto_sync_on_create": False,
    }

    response = await sync_admin_client.put("/api/sync/config", json=config_update)
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
async def test_get_sync_logs_empty(sync_admin_client: AsyncClient):
    """Test getting sync logs when none exist."""
    response = await sync_admin_client.get("/api/sync/logs")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_history_alias(sync_admin_client: AsyncClient):
    """Test that /history is an alias for /logs."""
    response = await sync_admin_client.get("/api/sync/history")
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
async def test_sync_bidirectional_railway_unreachable(sync_admin_client: AsyncClient):
    """Test that sync fails gracefully when Railway is unreachable."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=False)
        mock_create.return_value = mock_service

        response = await sync_admin_client.post("/api/sync/bidirectional")
        assert response.status_code == 503
        assert "unreachable" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_trigger_immediate_sync_railway_unavailable(sync_admin_client: AsyncClient):
    """Test immediate sync when Railway is unavailable."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=False)
        mock_create.return_value = mock_service

        response = await sync_admin_client.post("/api/sync/trigger-immediate")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["railway_healthy"] is False


# ============================================
# Delta Endpoint Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_invalid_table(sync_admin_client: AsyncClient):
    """Test getting delta for invalid table name."""
    response = await sync_admin_client.get("/api/sync/delta/invalid_table")
    assert response.status_code == 400
    assert "invalid table" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_valid_table(sync_admin_client: AsyncClient):
    """Test getting delta for valid table."""
    response = await sync_admin_client.get("/api/sync/delta/personnel")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_with_timestamp_filter(sync_admin_client: AsyncClient):
    """Test getting delta with timestamp filter."""
    response = await sync_admin_client.get("/api/sync/delta/personnel?updated_since=2024-01-01T00:00:00")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_invalid_timestamp(sync_admin_client: AsyncClient):
    """Test getting delta with invalid timestamp."""
    response = await sync_admin_client.get("/api/sync/delta/personnel?updated_since=invalid")
    assert response.status_code == 400
    assert "timestamp" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_apply_delta_invalid_table(sync_admin_client: AsyncClient):
    """Test applying delta to invalid table."""
    response = await sync_admin_client.post("/api/sync/apply/invalid_table", json=[])
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_apply_delta_empty_records(sync_admin_client: AsyncClient):
    """Test applying empty delta."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.apply_delta = AsyncMock(return_value={"personnel": 0})
        mock_create.return_value = mock_service

        response = await sync_admin_client.post("/api/sync/apply/personnel", json=[])
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0


# ============================================
# Sync Lock Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_rejects_concurrent_operations(sync_admin_client: AsyncClient):
    """Test that concurrent sync operations are rejected.

    This test simulates the scenario where a sync is already in progress
    and another sync request comes in.
    """
    import app.api.sync as sync_module

    # Manually set the sync lock
    original_is_syncing = sync_module._is_syncing
    sync_module._is_syncing = True

    try:
        response = await sync_admin_client.post("/api/sync/from-railway")
        assert response.status_code == 409
        assert "already in progress" in response.json()["detail"].lower()

        response = await sync_admin_client.post("/api/sync/to-railway")
        assert response.status_code == 409

        response = await sync_admin_client.post("/api/sync/bidirectional")
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
    from datetime import UTC, datetime
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
async def test_get_sync_status_with_successful_sync(sync_admin_client: AsyncClient, sync_log_success):
    """Test getting sync status when a successful sync exists."""
    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.check_railway_health = AsyncMock(return_value=True)
        mock_create.return_value = mock_service

        response = await sync_admin_client.get("/api/sync/status")
        assert response.status_code == 200
        data = response.json()

        # Should have sync data from the log
        assert data["last_sync"] is not None
        assert data["direction"] == "from_railway"
        assert data["railway_healthy"] is True
        assert data["records_pending"] == 8  # 5 + 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_status_with_last_error(sync_admin_client: AsyncClient):
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

            response = await sync_admin_client.get("/api/sync/status")
            assert response.status_code == 200
            data = response.json()

            assert data["last_error"] == "Connection timeout"
    finally:
        sync_module._last_sync_result = original_result


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_status_with_empty_errors(sync_admin_client: AsyncClient):
    """Test getting sync status with failed result but no error messages."""
    import app.api.sync as sync_module

    original_result = sync_module._last_sync_result
    sync_module._last_sync_result = {"success": False, "errors": []}

    try:
        with patch("app.api.sync.create_sync_service") as mock_create:
            mock_service = AsyncMock()
            mock_service.check_railway_health = AsyncMock(return_value=True)
            mock_create.return_value = mock_service

            response = await sync_admin_client.get("/api/sync/status")
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
async def test_sync_from_railway_success(sync_admin_client: AsyncClient):
    """Test successful sync from Railway."""
    from datetime import UTC, datetime

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

        response = await sync_admin_client.post("/api/sync/from-railway")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["direction"] == "from_railway"
        assert data["records_synced"]["incidents"] == 10
        assert data["completed_at"] is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_to_railway_success(sync_admin_client: AsyncClient):
    """Test successful sync to Railway."""
    from datetime import UTC, datetime

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

        response = await sync_admin_client.post("/api/sync/to-railway")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["direction"] == "to_railway"
        assert data["records_synced"]["incidents"] == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_bidirectional_success(sync_admin_client: AsyncClient):
    """Test successful bidirectional sync."""
    from datetime import UTC, datetime

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

        response = await sync_admin_client.post("/api/sync/bidirectional")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["from_railway"]["success"] is True
        assert data["to_railway"]["success"] is True
        assert data["from_railway"]["records_synced"]["incidents"] == 5
        assert data["to_railway"]["records_synced"]["personnel"] == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_trigger_immediate_sync_success(sync_admin_client: AsyncClient):
    """Test successful immediate sync trigger."""
    from datetime import UTC, datetime

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

        response = await sync_admin_client.post("/api/sync/trigger-immediate")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["from_railway"]["records_synced"]["incidents"] == 2
        assert data["to_railway"]["records_synced"]["materials"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_trigger_immediate_already_syncing(sync_admin_client: AsyncClient):
    """Test that immediate sync returns graceful response when already syncing."""
    import app.api.sync as sync_module

    original_is_syncing = sync_module._is_syncing
    sync_module._is_syncing = True

    try:
        response = await sync_admin_client.post("/api/sync/trigger-immediate")
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
async def test_get_sync_logs_with_entries(sync_admin_client: AsyncClient, sync_log_success):
    """Test getting sync logs when entries exist."""
    response = await sync_admin_client.get("/api/sync/logs")
    assert response.status_code == 200
    logs = response.json()

    assert len(logs) == 1
    log = logs[0]
    assert log["sync_direction"] == "from_railway"
    assert log["status"] == "success"
    assert log["records_synced"] == {"incidents": 5, "personnel": 3}


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_sync_logs_with_limit(sync_admin_client: AsyncClient, db_session: AsyncSession):
    """Test getting sync logs with custom limit."""
    from datetime import UTC, datetime
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

    response = await sync_admin_client.get("/api/sync/logs?limit=3")
    assert response.status_code == 200
    logs = response.json()
    assert len(logs) == 3


# ============================================
# Sync Config Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_sync_config_all_fields(sync_admin_client: AsyncClient):
    """Test updating all sync configuration fields."""
    config_update = {
        "sync_interval_minutes": 10,
        "auto_sync_on_create": False,
        "sync_conflict_buffer_seconds": 15,
        "railway_database_url": "postgresql://test:test@localhost/testdb",
    }

    response = await sync_admin_client.put("/api/sync/config", json=config_update)
    assert response.status_code == 200
    data = response.json()

    assert data["sync_interval_minutes"] == 10
    assert data["auto_sync_on_create"] is False
    assert data["sync_conflict_buffer_seconds"] == 15


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_sync_config_partial(sync_admin_client: AsyncClient):
    """Test updating only some sync configuration fields."""
    # Only update interval
    response = await sync_admin_client.put("/api/sync/config", json={"sync_interval_minutes": 15})
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
        status="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_returns_records(sync_admin_client: AsyncClient, test_personnel_for_sync):
    """Test getting delta returns actual records."""
    response = await sync_admin_client.get("/api/sync/delta/personnel")
    assert response.status_code == 200
    records = response.json()

    assert len(records) >= 1
    # Find our test personnel
    found = any(r["name"] == "Delta Test Person" for r in records)
    assert found


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_with_timestamp_filter(sync_admin_client: AsyncClient, test_personnel_for_sync):
    """Test that timestamp filter parameter is accepted."""
    # Use past timestamp - should return some records including our test personnel
    past_time = "2020-01-01T00:00:00"
    response = await sync_admin_client.get(f"/api/sync/delta/personnel?updated_since={past_time}")
    assert response.status_code == 200
    records = response.json()
    # Should return at least the test personnel we created
    assert len(records) >= 1
    found = any(r["name"] == "Delta Test Person" for r in records)
    assert found


@pytest.mark.asyncio
@pytest.mark.api
async def test_apply_delta_with_records(sync_admin_client: AsyncClient):
    """Test applying delta with actual records."""
    from uuid import uuid4

    records = [
        {
            "id": str(uuid4()),
            "name": "New Applied Personnel",
            "role": "Mannschaft",
            "status": "available",
        }
    ]

    with patch("app.api.sync.create_sync_service") as mock_create:
        mock_service = AsyncMock()
        mock_service.apply_delta = AsyncMock(return_value={"personnel": 1})
        mock_create.return_value = mock_service

        response = await sync_admin_client.post("/api/sync/apply/personnel", json=records)
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_delta_all_syncable_tables(sync_admin_client: AsyncClient):
    """Test getting delta for all syncable tables."""
    syncable_tables = ["incidents", "personnel", "vehicles", "materials", "settings"]

    for table in syncable_tables:
        response = await sync_admin_client.get(f"/api/sync/delta/{table}")
        assert response.status_code == 200, f"Failed for table: {table}"
        assert isinstance(response.json(), list)


# ============================================
# Admin-only Access + Credential Redaction (audit item C4)
# ============================================

# (method, path, json body) — everything that can write data, move data, or
# expose connection details must be admin-only.
ADMIN_ONLY_ENDPOINTS = [
    ("GET", "/api/sync/config", None),
    ("PUT", "/api/sync/config", {}),
    ("POST", "/api/sync/from-railway", None),
    ("POST", "/api/sync/to-railway", None),
    ("POST", "/api/sync/trigger-immediate", None),
    ("POST", "/api/sync/bidirectional", None),
    ("GET", "/api/sync/delta/incidents", None),
    ("POST", "/api/sync/apply/incidents", []),
]

REAL_URL = "postgresql://kprueck:supersecret@railway.example:5432/kprueck"
REDACTED_URL = "postgresql://kprueck:********@railway.example:5432/kprueck"


class TestSyncEndpointsRequireAdmin:
    """Regression: sync endpoints were gated on any authenticated user, letting a
    viewer/editor write arbitrary rows via /apply/{table} and read the production
    DATABASE_URL from /config."""

    @pytest.mark.api
    @pytest.mark.parametrize(("method", "path", "body"), ADMIN_ONLY_ENDPOINTS)
    async def test_editor_gets_403(self, editor_client: AsyncClient, method: str, path: str, body):
        response = await editor_client.request(method, path, json=body)
        assert response.status_code == 403, f"{method} {path}: expected 403, got {response.status_code}"

    @pytest.mark.api
    @pytest.mark.parametrize(("method", "path", "body"), ADMIN_ONLY_ENDPOINTS)
    async def test_unauthenticated_gets_401(self, client: AsyncClient, method: str, path: str, body):
        response = await client.request(method, path, json=body)
        assert response.status_code == 401, f"{method} {path}: expected 401, got {response.status_code}"

    @pytest.mark.api
    async def test_status_still_readable_by_editor(self, editor_client: AsyncClient):
        # /status is polled by the user menu for every logged-in user and
        # exposes no credentials — it stays open to authenticated users.
        response = await editor_client.get("/api/sync/status")
        assert response.status_code == 200

    @pytest.mark.api
    async def test_logs_still_readable_by_editor(self, editor_client: AsyncClient):
        response = await editor_client.get("/api/sync/logs")
        assert response.status_code == 200


class TestSyncConfigRedaction:
    """The config response must never contain the database password."""

    async def _seed_url(self, db_session: AsyncSession) -> None:
        from app.models import Setting

        db_session.add(Setting(key="railway_database_url", value=REAL_URL))
        await db_session.commit()

    @pytest.mark.api
    async def test_config_masks_password(self, sync_admin_client: AsyncClient, db_session: AsyncSession):
        await self._seed_url(db_session)

        response = await sync_admin_client.get("/api/sync/config")

        assert response.status_code == 200
        assert "supersecret" not in response.text
        assert response.json()["railway_database_url"] == REDACTED_URL

    @pytest.mark.api
    async def test_saving_redacted_url_keeps_stored_value(
        self, sync_admin_client: AsyncClient, db_session: AsyncSession
    ):
        # A client that loads the (masked) config and saves it back unchanged
        # must not overwrite the stored URL with the mask.
        from sqlalchemy import select

        from app.models import Setting

        await self._seed_url(db_session)

        response = await sync_admin_client.put("/api/sync/config", json={"railway_database_url": REDACTED_URL})
        assert response.status_code == 200

        result = await db_session.execute(select(Setting).where(Setting.key == "railway_database_url"))
        assert result.scalar_one().value == REAL_URL

    @pytest.mark.api
    async def test_saving_new_url_persists(self, sync_admin_client: AsyncClient, db_session: AsyncSession):
        from sqlalchemy import select

        from app.models import Setting

        await self._seed_url(db_session)
        new_url = "postgresql://kprueck:newpassword@other.example:5432/kprueck"

        response = await sync_admin_client.put("/api/sync/config", json={"railway_database_url": new_url})
        assert response.status_code == 200

        result = await db_session.execute(select(Setting).where(Setting.key == "railway_database_url"))
        assert result.scalar_one().value == new_url
        # And the response echoes the masked form, not the password.
        assert "newpassword" not in response.text
