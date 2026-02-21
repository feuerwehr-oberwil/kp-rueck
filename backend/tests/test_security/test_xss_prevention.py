"""XSS (Cross-Site Scripting) prevention tests.

Tests verify that:
1. XSS payloads in input fields are stored as literal text (not executed)
2. Output encoding is correct (JSON responses escape content properly)
3. Stored content is returned unchanged (data integrity)
4. Special characters are handled correctly

Note: Since this is a JSON API, XSS prevention is primarily a frontend concern.
However, we test that the backend stores and returns content safely.
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event

# XSS payloads to test - reduced set to avoid overwhelming test database
XSS_PAYLOADS = [
    "<script>alert('XSS')</script>",
    "<img src=x onerror=alert('XSS')>",
    "javascript:alert('XSS')",
    "${alert(1)}",  # ES6 template injection
    "{{constructor.constructor('alert(1)')()}}",  # Template injection
]


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="XSS Test Event",
        training_flag=False,
        auto_attach_divera=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


# ============================================
# XSS in Incident Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_incident_title_xss_stored_safely(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that XSS payloads in incident title are stored as literal text."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": payload,
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        # Payload should be stored as literal text
        assert data["title"] == payload.strip()

        # Fetch it back to verify storage
        incident_id = data["id"]
        get_response = await editor_client.get(f"/api/incidents/{incident_id}")
        assert get_response.status_code == 200
        assert get_response.json()["title"] == payload.strip()


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_incident_description_xss_stored_safely(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that XSS payloads in incident description are stored as literal text."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "XSS Description Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "description": payload,
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["description"] == payload


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_incident_location_xss_stored_safely(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that XSS payloads in incident location are stored as literal text."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "XSS Location Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "location_address": payload,
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["location_address"] == payload


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_incident_contact_xss_stored_safely(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that XSS payloads in incident contact are stored as literal text."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "XSS Contact Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "contact": payload,
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["contact"] == payload


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_incident_internal_notes_xss_stored_safely(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that XSS payloads in incident internal notes are stored as literal text."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "XSS Internal Notes Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "internal_notes": payload,
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["internal_notes"] == payload


# ============================================
# XSS in Personnel Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_personnel_name_xss_stored_safely(
    editor_client: AsyncClient, payload: str
):
    """Test that XSS payloads in personnel name are stored as literal text."""
    personnel_data = {
        "name": payload,
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        # Name is normalized but content should be preserved
        expected = " ".join(payload.split())  # Whitespace normalization
        assert data["name"] == expected


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_personnel_role_xss_stored_safely(
    editor_client: AsyncClient, payload: str
):
    """Test that XSS payloads in personnel role are stored as literal text."""
    personnel_data = {
        "name": "XSS Test Person",
        "role": payload,
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["role"] == payload


# ============================================
# XSS in Vehicle Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_vehicle_name_xss_stored_safely(
    editor_client: AsyncClient, payload: str
):
    """Test that XSS payloads in vehicle name are stored as literal text."""
    import uuid
    unique_call_sign = f"XSSNameTest-{uuid.uuid4().hex[:8]}"
    vehicle_data = {
        "name": payload,
        "type": "TLF",
        "status": "available",
        "display_order": 1,
        "radio_call_sign": unique_call_sign,
    }
    response = await editor_client.post("/api/vehicles/", json=vehicle_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["name"] == payload.strip()


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_vehicle_type_xss_stored_safely(
    editor_client: AsyncClient, payload: str
):
    """Test that XSS payloads in vehicle type are stored as literal text."""
    import uuid
    unique_call_sign = f"XSSTypeTest-{uuid.uuid4().hex[:8]}"
    vehicle_data = {
        "name": "XSS Test Vehicle",
        "type": payload,
        "status": "available",
        "display_order": 1,
        "radio_call_sign": unique_call_sign,
    }
    response = await editor_client.post("/api/vehicles/", json=vehicle_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["type"] == payload


# ============================================
# XSS in Material Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_material_name_xss_stored_safely(
    editor_client: AsyncClient, payload: str
):
    """Test that XSS payloads in material name are stored as literal text."""
    material_data = {
        "name": payload,
        "type": "Stromerzeuger",
        "location": "Depot",
        "status": "available",
    }
    response = await editor_client.post("/api/materials/", json=material_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["name"] == payload.strip()


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_material_description_xss_stored_safely(
    editor_client: AsyncClient, payload: str
):
    """Test that XSS payloads in material description are stored as literal text."""
    material_data = {
        "name": "XSS Test Material",
        "type": "Stromerzeuger",
        "location": "Depot",
        "description": payload,
        "status": "available",
    }
    response = await editor_client.post("/api/materials/", json=material_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        # Description whitespace is stripped
        expected = payload.strip() if payload else payload
        assert data["description"] == expected


# ============================================
# XSS in Event Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_event_name_xss_stored_safely(
    editor_client: AsyncClient, payload: str
):
    """Test that XSS payloads in event name are stored as literal text."""
    event_data = {
        "name": payload,
        "training_flag": False,
    }
    response = await editor_client.post("/api/events/", json=event_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["name"] == payload


# ============================================
# JSON Response Security
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_json_response_content_type(
    editor_client: AsyncClient, test_event: Event
):
    """Test that API responses have correct Content-Type header."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")

    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type


@pytest.mark.asyncio
@pytest.mark.security
async def test_no_script_execution_in_json(
    editor_client: AsyncClient, test_event: Event
):
    """Test that XSS payloads in JSON responses don't execute."""
    # Create incident with XSS payload
    incident_data = {
        "event_id": str(test_event.id),
        "title": "<script>alert('XSS')</script>",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    create_response = await editor_client.post("/api/incidents/", json=incident_data)
    assert create_response.status_code == 201

    # Fetch incidents list
    list_response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert list_response.status_code == 200

    # Response should be valid JSON with script stored as literal text
    data = list_response.json()
    assert len(data) >= 1

    # Find our incident
    xss_incident = next((i for i in data if "script" in i["title"].lower()), None)
    assert xss_incident is not None
    assert xss_incident["title"] == "<script>alert('XSS')</script>"


# ============================================
# Update Operations with XSS
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", XSS_PAYLOADS)
async def test_update_incident_xss_stored_safely(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that XSS payloads in update operations are stored safely."""
    # Create a clean incident first
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Clean Incident",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    create_response = await editor_client.post("/api/incidents/", json=incident_data)
    assert create_response.status_code == 201
    incident_id = create_response.json()["id"]

    # Update with XSS payload
    update_data = {"title": payload}
    update_response = await editor_client.patch(
        f"/api/incidents/{incident_id}", json=update_data
    )

    assert update_response.status_code in [200, 422]

    if update_response.status_code == 200:
        data = update_response.json()
        assert data["title"] == payload.strip()


# ============================================
# Special Character Handling
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_unicode_special_characters(
    editor_client: AsyncClient, test_event: Event
):
    """Test that unicode and special characters are handled correctly."""
    # Note: Null bytes (0x00) are rejected by PostgreSQL, so we don't test them
    special_chars = [
        "Test with \u200b zero-width space",
        "Test with \ufeff BOM",
        "Test with \u2028 line separator",
        "Test with \u2029 paragraph separator",
        "Test with emoji 🔥🚒",
        "Test with Cyrillic мир",
        "Test with Chinese 中文",
        "Test with Japanese 日本語",
        "Test with <>&\"' special HTML chars",
    ]

    for chars in special_chars:
        incident_data = {
            "event_id": str(test_event.id),
            "title": chars,
            "type": "brandbekaempfung",
            "priority": "medium",
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)

        # Should handle gracefully - either accept or reject with validation error
        assert response.status_code in [201, 422, 400]


@pytest.mark.asyncio
@pytest.mark.security
async def test_html_entities_preserved(
    editor_client: AsyncClient, test_event: Event
):
    """Test that HTML entities are preserved as literal text."""
    html_entities = [
        "&lt;script&gt;alert(1)&lt;/script&gt;",
        "&amp;",
        "&quot;",
        "&#60;&#62;",
        "&#x3C;&#x3E;",
    ]

    for entity in html_entities:
        incident_data = {
            "event_id": str(test_event.id),
            "title": entity,
            "type": "brandbekaempfung",
            "priority": "medium",
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)

        assert response.status_code in [201, 422]

        if response.status_code == 201:
            data = response.json()
            # HTML entities should be preserved, not decoded
            assert data["title"] == entity.strip()
