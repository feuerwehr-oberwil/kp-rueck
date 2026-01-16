"""Tests for Traccar GPS Tracking API endpoints.

Tests cover:
- Traccar status endpoint
- Vehicle positions endpoint
- Configuration status handling
- Error handling
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.main import app


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


# ============================================
# Status Endpoint Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_traccar_status_not_configured(client: AsyncClient):
    """Test status when Traccar is not configured."""
    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = False

        response = await client.get("/api/traccar/status")
        assert response.status_code == 200

        data = response.json()
        assert data["configured"] is False
        assert data["url"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_traccar_status_configured(client: AsyncClient):
    """Test status when Traccar is configured."""
    with patch("app.api.traccar.traccar_client") as mock_client, patch(
        "app.api.traccar.settings"
    ) as mock_settings:
        mock_client.is_configured = True
        mock_settings.traccar_url = "https://traccar.example.com"

        response = await client.get("/api/traccar/status")
        assert response.status_code == 200

        data = response.json()
        assert data["configured"] is True
        assert data["url"] == "https://traccar.example.com"


@pytest.mark.asyncio
@pytest.mark.api
async def test_traccar_status_no_auth_required(client: AsyncClient):
    """Test that status endpoint doesn't require authentication."""
    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = False

        response = await client.get("/api/traccar/status")
        assert response.status_code == 200


# ============================================
# Positions Endpoint Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_positions_not_configured(client: AsyncClient):
    """Test positions endpoint when Traccar is not configured."""
    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = False

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 503

        data = response.json()
        assert "not configured" in data["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_positions_success(client: AsyncClient):
    """Test successful position retrieval."""
    mock_position = MagicMock()
    mock_position.device_id = 1
    mock_position.device_name = "TLF"
    mock_position.unique_id = "tlf-001"
    mock_position.status = "online"
    mock_position.latitude = 47.5
    mock_position.longitude = 7.5
    mock_position.speed = 50.0
    mock_position.course = 180.0
    mock_position.last_update = datetime.now()
    mock_position.address = "Test Street, Oberwil"

    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = True
        mock_client.get_vehicle_positions = AsyncMock(return_value=[mock_position])

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1
        assert data[0]["device_name"] == "TLF"
        assert data[0]["latitude"] == 47.5
        assert data[0]["longitude"] == 7.5


@pytest.mark.asyncio
@pytest.mark.api
async def test_positions_empty(client: AsyncClient):
    """Test positions when no vehicles are tracked."""
    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = True
        mock_client.get_vehicle_positions = AsyncMock(return_value=[])

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 200

        data = response.json()
        assert data == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_positions_multiple_vehicles(client: AsyncClient):
    """Test positions with multiple tracked vehicles."""
    mock_positions = []
    for i in range(3):
        pos = MagicMock()
        pos.device_id = i
        pos.device_name = f"Vehicle {i}"
        pos.unique_id = f"vehicle-{i:03d}"
        pos.status = "online"
        pos.latitude = 47.5 + i * 0.01
        pos.longitude = 7.5 + i * 0.01
        pos.speed = None
        pos.course = None
        pos.last_update = datetime.now()
        pos.address = None
        mock_positions.append(pos)

    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = True
        mock_client.get_vehicle_positions = AsyncMock(return_value=mock_positions)

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_positions_traccar_error(client: AsyncClient):
    """Test positions when Traccar service fails."""
    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = True
        mock_client.get_vehicle_positions = AsyncMock(side_effect=Exception("Connection refused"))

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 502

        data = response.json()
        # German error message
        assert "nicht erreichbar" in data["detail"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_positions_no_auth_required(client: AsyncClient):
    """Test that positions endpoint doesn't require authentication."""
    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = False

        # Should return 503 (not configured), not 401 (unauthorized)
        response = await client.get("/api/traccar/positions")
        assert response.status_code == 503


# ============================================
# Response Format Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_position_response_format(client: AsyncClient):
    """Test that position response has correct format."""
    mock_position = MagicMock()
    mock_position.device_id = 1
    mock_position.device_name = "TLF"
    mock_position.unique_id = "tlf-001"
    mock_position.status = "online"
    mock_position.latitude = 47.5
    mock_position.longitude = 7.5
    mock_position.speed = 50.0
    mock_position.course = 180.0
    mock_position.last_update = datetime.now()
    mock_position.address = "Test Street"

    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = True
        mock_client.get_vehicle_positions = AsyncMock(return_value=[mock_position])

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 200

        data = response.json()
        position = data[0]

        assert "device_id" in position
        assert "device_name" in position
        assert "unique_id" in position
        assert "status" in position
        assert "latitude" in position
        assert "longitude" in position
        assert "speed" in position
        assert "course" in position
        assert "last_update" in position
        assert "address" in position


@pytest.mark.asyncio
@pytest.mark.api
async def test_position_optional_fields(client: AsyncClient):
    """Test that optional fields can be null."""
    mock_position = MagicMock()
    mock_position.device_id = 1
    mock_position.device_name = "TLF"
    mock_position.unique_id = "tlf-001"
    mock_position.status = "offline"
    mock_position.latitude = 47.5
    mock_position.longitude = 7.5
    mock_position.speed = None
    mock_position.course = None
    mock_position.last_update = datetime.now()
    mock_position.address = None

    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = True
        mock_client.get_vehicle_positions = AsyncMock(return_value=[mock_position])

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 200

        data = response.json()
        position = data[0]

        assert position["speed"] is None
        assert position["course"] is None
        assert position["address"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_status_response_format(client: AsyncClient):
    """Test that status response has correct format."""
    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = False

        response = await client.get("/api/traccar/status")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"

        data = response.json()
        assert isinstance(data["configured"], bool)


# ============================================
# Edge Cases Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_positions_with_zero_coordinates(client: AsyncClient):
    """Test positions with coordinates at 0,0 (valid but unusual)."""
    mock_position = MagicMock()
    mock_position.device_id = 1
    mock_position.device_name = "TLF"
    mock_position.unique_id = "tlf-001"
    mock_position.status = "online"
    mock_position.latitude = 0.0
    mock_position.longitude = 0.0
    mock_position.speed = 0.0
    mock_position.course = 0.0
    mock_position.last_update = datetime.now()
    mock_position.address = None

    with patch("app.api.traccar.traccar_client") as mock_client:
        mock_client.is_configured = True
        mock_client.get_vehicle_positions = AsyncMock(return_value=[mock_position])

        response = await client.get("/api/traccar/positions")
        assert response.status_code == 200

        data = response.json()
        assert data[0]["latitude"] == 0.0
        assert data[0]["longitude"] == 0.0
