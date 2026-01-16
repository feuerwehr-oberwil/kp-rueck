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
