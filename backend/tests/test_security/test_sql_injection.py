"""SQL Injection prevention tests.

Tests verify that:
1. SQLAlchemy's parameterized queries protect against SQL injection
2. Malicious payloads in string fields don't cause SQL errors
3. Malicious payloads in search/filter parameters are handled safely
4. Application responds gracefully to injection attempts
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, Incident, Personnel, User, Vehicle, Material


# SQL injection payloads to test - reduced set to avoid overwhelming test database
SQL_INJECTION_PAYLOADS = [
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "admin'--",
    "' OR ''='",
    "${7*7}",  # Server-side template injection attempt
]


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
        username="security_test_editor",
        password_hash=hash_password("editorpass123"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Security Test Event",
        training_flag=False,
        auto_attach_divera=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "security_test_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# SQL Injection in Incident Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)  # Test first 8 payloads
async def test_incident_title_sql_injection(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that SQL injection in incident title is safely handled."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": payload,
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)

    # Should either succeed (payload stored as literal string) or return validation error
    # Should NOT return 500 (SQL error) or execute SQL
    assert response.status_code in [201, 422]

    if response.status_code == 201:
        # Verify payload was stored as literal text, not executed
        data = response.json()
        assert data["title"] == payload.strip()


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_incident_description_sql_injection(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that SQL injection in incident description is safely handled."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Test Incident",
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
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_incident_location_sql_injection(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that SQL injection in incident location is safely handled."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Location Injection Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "location_address": payload,
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["location_address"] == payload


# ============================================
# SQL Injection in Personnel Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_personnel_name_sql_injection(
    editor_client: AsyncClient, payload: str
):
    """Test that SQL injection in personnel name is safely handled."""
    personnel_data = {
        "name": payload,
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        # Name is normalized (excessive whitespace removed)
        assert payload.strip() in data["name"] or data["name"] == " ".join(payload.split())


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_personnel_role_sql_injection(
    editor_client: AsyncClient, payload: str
):
    """Test that SQL injection in personnel role is safely handled."""
    personnel_data = {
        "name": "Test Person",
        "role": payload,
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)

    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        assert data["role"] == payload


# ============================================
# SQL Injection in Vehicle Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_vehicle_name_sql_injection(
    editor_client: AsyncClient, payload: str
):
    """Test that SQL injection in vehicle name is safely handled."""
    import uuid
    # Use unique radio call sign to avoid conflicts
    unique_call_sign = f"SQLInjTest-{uuid.uuid4().hex[:8]}"
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


# ============================================
# SQL Injection in Material Fields
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_material_name_sql_injection(
    editor_client: AsyncClient, payload: str
):
    """Test that SQL injection in material name is safely handled."""
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


# ============================================
# SQL Injection in Query Parameters
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_status_filter_sql_injection(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that SQL injection in status query parameter is safely handled."""
    response = await editor_client.get(
        f"/api/incidents/?event_id={test_event.id}&status={payload}"
    )

    # Should return empty list or validation error, not 500
    assert response.status_code in [200, 422, 400]

    if response.status_code == 200:
        # Should be empty - payload won't match any valid status
        data = response.json()
        assert isinstance(data, list)


@pytest.mark.asyncio
@pytest.mark.security
async def test_event_id_sql_injection(editor_client: AsyncClient):
    """Test that SQL injection in event_id parameter is safely handled."""
    # Try various malicious event_id values
    malicious_ids = [
        "'; DROP TABLE events; --",
        "1' OR '1'='1",
        "uuid(); DROP TABLE events--",
    ]

    for malicious_id in malicious_ids:
        response = await editor_client.get(f"/api/incidents/?event_id={malicious_id}")
        # Should return 422 (validation error for invalid UUID) not 500
        assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_id_path_sql_injection(editor_client: AsyncClient):
    """Test that SQL injection in incident_id path parameter is safely handled."""
    malicious_ids = [
        "'; DROP TABLE incidents; --",
        "1' OR '1'='1",
        "../../../etc/passwd",
    ]

    for malicious_id in malicious_ids:
        response = await editor_client.get(f"/api/incidents/{malicious_id}")
        # Should return 422 (invalid UUID) or 404 (not found), not 500
        assert response.status_code in [404, 422]


# ============================================
# SQL Injection in Search/Filter Operations
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_settings_key_sql_injection(editor_client: AsyncClient, payload: str):
    """Test that SQL injection in settings key is safely handled."""
    response = await editor_client.get(f"/api/settings/{payload}")

    # Should return 404 (not found) or validation error, not 500
    assert response.status_code in [200, 404, 422, 400]


# ============================================
# SQL Injection via Update Operations
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
@pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
async def test_update_incident_sql_injection(
    editor_client: AsyncClient, test_event: Event, payload: str
):
    """Test that SQL injection in update operations is safely handled."""
    # First create a valid incident
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Incident for Update Test",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    create_response = await editor_client.post("/api/incidents/", json=incident_data)
    assert create_response.status_code == 201
    incident_id = create_response.json()["id"]

    # Try to update with malicious payload
    update_data = {
        "title": payload,
        "description": payload,
    }
    response = await editor_client.patch(f"/api/incidents/{incident_id}", json=update_data)

    assert response.status_code in [200, 422]

    if response.status_code == 200:
        data = response.json()
        # Verify payload was stored literally, not executed
        assert data["title"] == payload.strip()


# ============================================
# Verify Database Integrity
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_database_tables_intact_after_injections(
    editor_client: AsyncClient, test_event: Event, db_session: AsyncSession
):
    """Verify that database tables are still intact after injection attempts."""
    from sqlalchemy import text

    # Run a series of injection attempts
    for payload in SQL_INJECTION_PAYLOADS:
        incident_data = {
            "event_id": str(test_event.id),
            "title": payload,
            "type": "brandbekaempfung",
            "priority": "medium",
        }
        await editor_client.post("/api/incidents/", json=incident_data)

    # Verify all critical tables still exist by querying them
    tables_to_check = ["users", "incidents", "personnel", "vehicles", "materials", "events"]

    for table in tables_to_check:
        result = await db_session.execute(
            text(f"SELECT COUNT(*) FROM {table}")
        )
        count = result.scalar()
        # Table exists if we can query it (count >= 0)
        assert count >= 0, f"Table {table} appears to be compromised"


@pytest.mark.asyncio
@pytest.mark.security
async def test_no_additional_users_after_injection(
    editor_client: AsyncClient, test_event: Event, db_session: AsyncSession
):
    """Verify that no additional users were created via SQL injection."""
    from sqlalchemy import select, func
    from app.models import User

    # Get initial user count
    initial_result = await db_session.execute(select(func.count()).select_from(User))
    initial_count = initial_result.scalar()

    # Attempt injection that tries to create users
    injection_payloads = [
        "'; INSERT INTO users (username, password_hash, role) VALUES ('hacker', 'x', 'editor'); --",
        "1'; INSERT INTO users VALUES (gen_random_uuid(), 'hacker2', 'x', 'editor'); --",
    ]

    for payload in injection_payloads:
        incident_data = {
            "event_id": str(test_event.id),
            "title": payload,
            "type": "brandbekaempfung",
            "priority": "medium",
        }
        await editor_client.post("/api/incidents/", json=incident_data)

    # Verify user count hasn't changed (except for test fixtures)
    final_result = await db_session.execute(select(func.count()).select_from(User))
    final_count = final_result.scalar()

    # No new users should have been created via injection
    assert final_count == initial_count, "SQL injection may have created unauthorized users"
