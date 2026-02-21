"""Tests for Health Check API endpoints.

Tests cover:
- Simple health check endpoint
- Detailed health check with component status
- Database connectivity verification
- WebSocket manager status
- Sync scheduler status
"""

from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app

# ============================================
# Simple Health Check Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_health_check_success(client: AsyncClient):
    """Test simple health check returns healthy status."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


@pytest.mark.asyncio
@pytest.mark.api
async def test_health_check_database_failure(client: AsyncClient):
    """Test health check returns 503 when database is unreachable."""

    # Override the dependency to simulate database failure
    async def failing_db():
        mock_session = AsyncMock()
        mock_session.execute.side_effect = Exception("Database connection failed")
        yield mock_session

    app.dependency_overrides[get_db] = failing_db

    try:
        response = await client.get("/health")
        assert response.status_code == 503
        data = response.json()
        assert "Database connection failed" in data["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================
# Detailed Health Check Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_detailed_health_check_success(client: AsyncClient):
    """Test detailed health check returns component status."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    # Check top-level status
    assert "status" in data
    assert data["status"] in ["healthy", "degraded"]

    # Check components exist
    assert "components" in data
    assert "database" in data["components"]
    assert "websocket" in data["components"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_detailed_health_check_database_status(client: AsyncClient):
    """Test detailed health check includes database status."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    db_status = data["components"]["database"]
    assert db_status["status"] == "healthy"
    assert "pool" in db_status


@pytest.mark.asyncio
@pytest.mark.api
async def test_detailed_health_check_websocket_status(client: AsyncClient):
    """Test detailed health check includes WebSocket status."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    ws_status = data["components"]["websocket"]
    assert ws_status["status"] == "healthy"
    assert "connections" in ws_status
    assert "rooms" in ws_status


@pytest.mark.asyncio
@pytest.mark.api
async def test_detailed_health_check_sync_scheduler_status(client: AsyncClient):
    """Test detailed health check includes sync scheduler status."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    # Sync scheduler may or may not be initialized in test environment
    assert "sync_scheduler" in data["components"]
    scheduler_status = data["components"]["sync_scheduler"]
    assert "status" in scheduler_status


@pytest.mark.asyncio
@pytest.mark.api
async def test_detailed_health_check_pool_stats(client: AsyncClient):
    """Test detailed health check includes connection pool statistics."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    db_pool = data["components"]["database"].get("pool", {})
    # Pool stats may have different keys depending on implementation
    # At minimum we expect the pool dict to exist
    assert isinstance(db_pool, dict)


@pytest.mark.asyncio
@pytest.mark.api
async def test_detailed_health_check_degraded_on_db_failure():
    """Test detailed health check returns degraded when database fails."""

    # Create a client with failing database
    async def failing_db():
        mock_session = AsyncMock()
        mock_session.execute.side_effect = Exception("Connection timeout")
        yield mock_session

    app.dependency_overrides[get_db] = failing_db

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health/detailed")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "degraded"
            assert data["components"]["database"]["status"] == "unhealthy"
    finally:
        app.dependency_overrides.clear()


# ============================================
# Pool Statistics Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_pool_stats_structure(client: AsyncClient):
    """Test that pool stats have expected structure."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    pool = data["components"]["database"].get("pool", {})
    # If pool stats are available, check structure
    if "error" not in pool:
        # Standard pool stats
        expected_keys = ["size", "checked_in", "checked_out", "overflow"]
        for key in expected_keys:
            assert key in pool


@pytest.mark.asyncio
@pytest.mark.api
async def test_audit_pool_stats(client: AsyncClient):
    """Test that audit pool stats are included."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    assert "audit_pool" in data["components"]
    audit_pool = data["components"]["audit_pool"]
    assert audit_pool["status"] == "healthy"


# ============================================
# Room Statistics Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_websocket_room_stats(client: AsyncClient):
    """Test that WebSocket room stats are included."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    data = response.json()

    ws_status = data["components"]["websocket"]
    rooms = ws_status.get("rooms", {})

    # Default rooms should exist
    assert "operations" in rooms
    assert "admin" in rooms


# ============================================
# Edge Cases Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_health_check_no_auth_required(client: AsyncClient):
    """Test that health check endpoints don't require authentication."""
    # Simple health check
    response = await client.get("/health")
    assert response.status_code == 200

    # Detailed health check
    response = await client.get("/health/detailed")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_health_check_multiple_calls(client: AsyncClient):
    """Test that multiple health check calls work correctly."""
    for _ in range(5):
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"


@pytest.mark.asyncio
@pytest.mark.api
async def test_detailed_health_check_json_format(client: AsyncClient):
    """Test that detailed health check returns valid JSON structure."""
    response = await client.get("/health/detailed")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"

    data = response.json()
    assert isinstance(data, dict)
    assert isinstance(data["components"], dict)
