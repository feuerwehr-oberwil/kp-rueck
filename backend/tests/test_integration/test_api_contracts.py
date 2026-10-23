"""API contract claims FastAPI does not already make for us.

A response validated against the schema that produced it proves nothing, so
those tests are gone; `test_openapi_committed.py` pins the real contract. What
stays: a minimal incident answers with nulls (not missing keys), the enum values
the board switches on, and the 422 shape `frontend/lib/api/http.ts` parses.
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.models import Event


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Contract Test Event",
        training_flag=False,
        auto_attach_divera=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


# ============================================
# Incident API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_response_contract_minimal(editor_client: AsyncClient, test_event: Event):
    """Test that minimal Incident response (only required fields) matches schema."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Minimal Incident",
        "type": "brandbekaempfung",
        "priority": "low",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201

    data = response.json()

    # Validate against Pydantic schema
    incident_response = schemas.IncidentResponse.model_validate(data)

    # Optional fields should be None or empty
    assert incident_response.location_address is None
    assert incident_response.location_lat is None
    assert incident_response.location_lng is None
    assert incident_response.description is None
    assert incident_response.contact is None
    assert incident_response.internal_notes is None
    assert incident_response.assigned_vehicles == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_enum_values(editor_client: AsyncClient, test_event: Event):
    """Test that incident enum fields accept all valid values."""
    valid_types = [e.value for e in schemas.IncidentType]
    valid_priorities = [e.value for e in schemas.IncidentPriority]

    # Test each incident type
    for incident_type in valid_types:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Incident type {incident_type}",
            "type": incident_type,
            "priority": "medium",
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for type: {incident_type}"

        data = response.json()
        incident_response = schemas.IncidentResponse.model_validate(data)
        assert incident_response.type.value == incident_type

    # Test each priority
    for priority in valid_priorities:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Incident priority {priority}",
            "type": "brandbekaempfung",
            "priority": priority,
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for priority: {priority}"

        data = response.json()
        incident_response = schemas.IncidentResponse.model_validate(data)
        assert incident_response.priority.value == priority


# ============================================
# Error Response Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_422_validation_error_contract(editor_client: AsyncClient, test_event: Event):
    """Test that validation error responses have consistent structure."""
    # Missing required field
    incident_data = {
        "event_id": str(test_event.id),
        # Missing title
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422

    data = response.json()
    assert "detail" in data
    assert isinstance(data["detail"], list)

    # Each validation error should have loc, msg, type
    for error in data["detail"]:
        assert "loc" in error
        assert "msg" in error
        assert "type" in error
