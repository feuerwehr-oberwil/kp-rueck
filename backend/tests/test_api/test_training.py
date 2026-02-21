"""Tests for Training Automation API endpoints.

Tests cover:
- Training emergency generation
- Emergency template listing
- Training location listing
- Permission enforcement
- Validation rules
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmergencyTemplate, Event, Incident, TrainingLocation

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def training_event(db_session: AsyncSession) -> Event:
    """Create a training event."""
    event = Event(
        id=uuid4(),
        name="Training Event",
        training_flag=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def live_event(db_session: AsyncSession) -> Event:
    """Create a live (non-training) event."""
    event = Event(
        id=uuid4(),
        name="Live Event",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_templates(db_session: AsyncSession) -> list[EmergencyTemplate]:
    """Create test emergency templates."""
    templates = []
    for i, category in enumerate(["normal", "critical", "normal"]):
        template = EmergencyTemplate(
            id=uuid4(),
            title_pattern=f"Test Emergency {i}",
            message_pattern=f"Test emergency description {i}",
            category=category,
            incident_type="brandbekaempfung",
            is_active=True,
        )
        db_session.add(template)
        templates.append(template)

    # Add inactive template
    inactive = EmergencyTemplate(
        id=uuid4(),
        title_pattern="Inactive Emergency",
        message_pattern="Inactive template",
        category="normal",
        incident_type="brandbekaempfung",
        is_active=False,
    )
    db_session.add(inactive)

    await db_session.commit()
    return templates


@pytest_asyncio.fixture
async def test_locations(db_session: AsyncSession) -> list[TrainingLocation]:
    """Create test training locations."""
    locations = []
    for i in range(3):
        location = TrainingLocation(
            id=uuid4(),
            street=f"Test Street {i}",
            house_number=str(i + 1),
            postal_code="4104",
            city="Oberwil",
            latitude=47.5 + i * 0.01,
            longitude=7.5 + i * 0.01,
            is_active=True,
        )
        db_session.add(location)
        locations.append(location)

    # Add inactive location
    inactive = TrainingLocation(
        id=uuid4(),
        street="Inactive Street",
        house_number="1",
        postal_code="4104",
        city="Oberwil",
        latitude=47.5,
        longitude=7.5,
        is_active=False,
    )
    db_session.add(inactive)

    await db_session.commit()
    return locations


# ============================================
# Generate Emergencies Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_requires_auth(client: AsyncClient, training_event: Event):
    """Test that generating emergencies requires authentication."""
    response = await client.post(
        f"/api/training/events/{training_event.id}/generate/",
        json={"count": 1},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_viewer_forbidden(viewer_client: AsyncClient, training_event: Event):
    """Test that viewers cannot generate emergencies."""
    response = await viewer_client.post(
        f"/api/training/events/{training_event.id}/generate/",
        json={"count": 1},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_event_not_found(editor_client: AsyncClient):
    """Test generating emergencies for non-existent event."""
    response = await editor_client.post(
        f"/api/training/events/{uuid4()}/generate/",
        json={"count": 1},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_live_event_forbidden(editor_client: AsyncClient, live_event: Event):
    """Test that emergencies cannot be generated for live events."""
    response = await editor_client.post(
        f"/api/training/events/{live_event.id}/generate/",
        json={"count": 1},
    )
    assert response.status_code == 400
    assert "training" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_success(
    editor_client: AsyncClient, training_event: Event, test_templates, test_locations
):
    """Test successful emergency generation."""
    with patch("app.api.training.generate_training_emergency", new_callable=AsyncMock) as mock_gen:
        # Create a mock incident
        mock_incident = Incident(
            id=uuid4(),
            event_id=training_event.id,
            title="Generated Emergency",
            type="brandbekaempfung",
            status="eingegangen",
            priority="medium",
            location_address="Test Street",
            nachbarhilfe=False,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        mock_gen.return_value = [mock_incident]

        response = await editor_client.post(
            f"/api/training/events/{training_event.id}/generate/",
            json={"count": 1},
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_with_category(
    editor_client: AsyncClient, training_event: Event, test_templates, test_locations
):
    """Test generating emergencies with specific category."""
    with patch("app.api.training.generate_training_emergency", new_callable=AsyncMock) as mock_gen:
        mock_incident = Incident(
            id=uuid4(),
            event_id=training_event.id,
            title="Critical Emergency",
            type="brandbekaempfung",
            status="eingegangen",
            priority="high",
            location_address="Test Street",
            nachbarhilfe=False,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        mock_gen.return_value = [mock_incident]

        response = await editor_client.post(
            f"/api/training/events/{training_event.id}/generate/",
            json={"count": 1, "category": "critical"},
        )
        assert response.status_code == 200

        mock_gen.assert_called_once()
        call_kwargs = mock_gen.call_args
        assert call_kwargs[1]["category"] == "critical"


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_invalid_category(editor_client: AsyncClient, training_event: Event):
    """Test that invalid category is rejected."""
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/generate/",
        json={"count": 1, "category": "invalid"},
    )
    assert response.status_code == 400
    assert "category" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_emergencies_count_validation(editor_client: AsyncClient, training_event: Event):
    """Test that count is validated (1-10)."""
    # Too low
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/generate/",
        json={"count": 0},
    )
    assert response.status_code == 400

    # Too high
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/generate/",
        json={"count": 11},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_multiple_emergencies(
    editor_client: AsyncClient, training_event: Event, test_templates, test_locations
):
    """Test generating multiple emergencies at once."""
    with patch("app.api.training.generate_training_emergency", new_callable=AsyncMock) as mock_gen:
        mock_incidents = [
            Incident(
                id=uuid4(),
                event_id=training_event.id,
                title=f"Emergency {i}",
                type="brandbekaempfung",
                status="eingegangen",
                priority="medium",
                location_address=f"Street {i}",
                nachbarhilfe=False,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            for i in range(3)
        ]
        mock_gen.return_value = mock_incidents

        response = await editor_client.post(
            f"/api/training/events/{training_event.id}/generate/",
            json={"count": 3},
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 3


# ============================================
# List Templates Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_templates_requires_auth(client: AsyncClient):
    """Test that listing templates requires authentication."""
    response = await client.get("/api/training/templates/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_templates_viewer_can_access(viewer_client: AsyncClient, test_templates):
    """Test that viewers can list templates."""
    response = await viewer_client.get("/api/training/templates/")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_templates_success(editor_client: AsyncClient, test_templates):
    """Test successful template listing."""
    response = await editor_client.get("/api/training/templates/")
    assert response.status_code == 200

    data = response.json()
    # Should only return active templates (3, not the inactive one)
    assert len(data) == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_templates_filter_by_category(editor_client: AsyncClient, test_templates):
    """Test filtering templates by category."""
    response = await editor_client.get("/api/training/templates/?category=normal")
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 2
    for template in data:
        assert template["category"] == "normal"


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_templates_filter_critical(editor_client: AsyncClient, test_templates):
    """Test filtering templates by critical category."""
    response = await editor_client.get("/api/training/templates/?category=critical")
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 1
    assert data[0]["category"] == "critical"


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_templates_invalid_category_filter(editor_client: AsyncClient, test_templates):
    """Test that invalid category filter is rejected."""
    response = await editor_client.get("/api/training/templates/?category=invalid")
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_templates_excludes_inactive(editor_client: AsyncClient, test_templates):
    """Test that inactive templates are excluded."""
    response = await editor_client.get("/api/training/templates/")
    assert response.status_code == 200

    data = response.json()
    titles = [t["title_pattern"] for t in data]
    assert "Inactive Emergency" not in titles


# ============================================
# List Locations Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_locations_requires_auth(client: AsyncClient):
    """Test that listing locations requires authentication."""
    response = await client.get("/api/training/locations/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_locations_viewer_can_access(viewer_client: AsyncClient, test_locations):
    """Test that viewers can list locations."""
    response = await viewer_client.get("/api/training/locations/")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_locations_success(editor_client: AsyncClient, test_locations):
    """Test successful location listing."""
    response = await editor_client.get("/api/training/locations/")
    assert response.status_code == 200

    data = response.json()
    # Should only return active locations (3, not the inactive one)
    assert len(data) == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_locations_excludes_inactive(editor_client: AsyncClient, test_locations):
    """Test that inactive locations are excluded."""
    response = await editor_client.get("/api/training/locations/")
    assert response.status_code == 200

    data = response.json()
    streets = [loc["street"] for loc in data]
    assert "Inactive Street" not in streets


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_locations_has_coordinates(editor_client: AsyncClient, test_locations):
    """Test that locations include coordinates."""
    response = await editor_client.get("/api/training/locations/")
    assert response.status_code == 200

    data = response.json()
    for location in data:
        assert "latitude" in location
        assert "longitude" in location
        assert location["latitude"] is not None
        assert location["longitude"] is not None


# ============================================
# Response Format Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_template_response_format(editor_client: AsyncClient, test_templates):
    """Test that template response has correct format."""
    response = await editor_client.get("/api/training/templates/")
    assert response.status_code == 200

    data = response.json()
    template = data[0]

    assert "id" in template
    assert "title_pattern" in template
    assert "message_pattern" in template
    assert "category" in template
    assert "incident_type" in template


@pytest.mark.asyncio
@pytest.mark.api
async def test_location_response_format(editor_client: AsyncClient, test_locations):
    """Test that location response has correct format."""
    response = await editor_client.get("/api/training/locations/")
    assert response.status_code == 200

    data = response.json()
    location = data[0]

    assert "id" in location
    assert "street" in location
    assert "house_number" in location
    assert "latitude" in location
    assert "longitude" in location
