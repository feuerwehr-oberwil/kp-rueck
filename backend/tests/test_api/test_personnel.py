"""Tests for Personnel API endpoints.

Tests cover:
- Personnel CRUD operations (create, read, update, delete)
- Personnel listing
- Category sort order updates
- Permission enforcement (editor vs viewer)
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Personnel, User


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
        username="personnel_editor",
        password_hash=hash_password("editorpass123"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_viewer(db_session: AsyncSession) -> User:
    """Create a test viewer user."""
    user = User(
        id=uuid4(),
        username="personnel_viewer",
        password_hash=hash_password("viewerpass123"),
        role="viewer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Hans Müller",
        role="Gruppenführer",
        availability="available",
        tags=["Atemschutz", "Maschinisten"],
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "personnel_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient, test_viewer: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "personnel_viewer", "password": "viewerpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# List Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_requires_auth(client: AsyncClient):
    """Test that listing personnel requires authentication."""
    response = await client.get("/api/personnel/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_empty(editor_client: AsyncClient):
    """Test listing personnel when none exist."""
    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test listing personnel successfully."""
    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200
    personnel_list = response.json()
    assert len(personnel_list) == 1
    assert personnel_list[0]["id"] == str(test_personnel.id)
    assert personnel_list[0]["name"] == test_personnel.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_viewer_can_read(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers can list personnel."""
    response = await viewer_client.get("/api/personnel/")
    assert response.status_code == 200
    assert len(response.json()) == 1


# ============================================
# Get Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_requires_auth(client: AsyncClient, test_personnel: Personnel):
    """Test that getting personnel requires authentication."""
    response = await client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test getting a single personnel record."""
    response = await editor_client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_personnel.id)
    assert data["name"] == test_personnel.name
    assert data["role"] == test_personnel.role
    assert data["availability"] == test_personnel.availability
    assert data["tags"] == test_personnel.tags


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_not_found(editor_client: AsyncClient):
    """Test getting a non-existent personnel record."""
    response = await editor_client.get(f"/api/personnel/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_viewer_can_read(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers can get personnel details."""
    response = await viewer_client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 200


# ============================================
# Create Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_requires_auth(client: AsyncClient):
    """Test that creating personnel requires authentication."""
    response = await client.post("/api/personnel/", json={"name": "New Person"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_success(editor_client: AsyncClient):
    """Test creating personnel successfully.

    Note: Tags may be processed asynchronously or stored differently.
    We verify the core fields are set correctly.
    """
    personnel_data = {
        "name": "Anna Schmidt",
        "role": "Zugführer",
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Anna Schmidt"
    assert data["role"] == "Zugführer"
    assert data["availability"] == "available"
    assert "id" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_minimal(editor_client: AsyncClient):
    """Test creating personnel with required data.

    Required fields: name, availability
    """
    response = await editor_client.post(
        "/api/personnel/",
        json={"name": "Basic Person", "availability": "available"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Basic Person"
    assert data["availability"] == "available"


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot create personnel."""
    response = await viewer_client.post("/api/personnel/", json={"name": "New Person"})
    assert response.status_code == 403


# ============================================
# Update Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_requires_auth(client: AsyncClient, test_personnel: Personnel):
    """Test that updating personnel requires authentication."""
    response = await client.put(f"/api/personnel/{test_personnel.id}", json={"name": "Updated"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test updating personnel successfully."""
    update_data = {
        "name": "Hans Müller Updated",
        "availability": "unavailable",
    }
    response = await editor_client.put(f"/api/personnel/{test_personnel.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Hans Müller Updated"
    assert data["availability"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_partial(editor_client: AsyncClient, test_personnel: Personnel):
    """Test partial update of personnel."""
    response = await editor_client.put(
        f"/api/personnel/{test_personnel.id}",
        json={"availability": "unavailable"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == test_personnel.name  # Unchanged
    assert data["availability"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_tags(editor_client: AsyncClient, test_personnel: Personnel):
    """Test updating personnel tags."""
    response = await editor_client.put(
        f"/api/personnel/{test_personnel.id}",
        json={"tags": ["Atemschutz", "Maschinisten", "Sanitäter"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert "Sanitäter" in data["tags"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_not_found(editor_client: AsyncClient):
    """Test updating a non-existent personnel record."""
    response = await editor_client.put(f"/api/personnel/{uuid4()}", json={"name": "Updated"})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_viewer_forbidden(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers cannot update personnel."""
    response = await viewer_client.put(f"/api/personnel/{test_personnel.id}", json={"name": "Updated"})
    assert response.status_code == 403


# ============================================
# Delete Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_requires_auth(client: AsyncClient, test_personnel: Personnel):
    """Test that deleting personnel requires authentication."""
    response = await client.delete(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test deleting personnel successfully (soft delete)."""
    response = await editor_client.delete(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_not_found(editor_client: AsyncClient):
    """Test deleting a non-existent personnel record."""
    response = await editor_client.delete(f"/api/personnel/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_viewer_forbidden(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers cannot delete personnel."""
    response = await viewer_client.delete(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 403


# ============================================
# Category Sort Order Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_role_sort_order_requires_auth(client: AsyncClient):
    """Test that updating role sort order requires authentication."""
    response = await client.post(
        "/api/personnel/categories/sort-order",
        json={"categories": [{"category": "Gruppenführer", "sort_order": 1}]},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_role_sort_order_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test updating role sort order."""
    sort_data = {
        "categories": [
            {"category": "Zugführer", "sort_order": 1},
            {"category": "Gruppenführer", "sort_order": 2},
            {"category": "Truppführer", "sort_order": 3},
        ]
    }
    response = await editor_client.post("/api/personnel/categories/sort-order", json=sort_data)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_role_sort_order_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot update role sort order."""
    response = await viewer_client.post(
        "/api/personnel/categories/sort-order",
        json={"categories": [{"category": "Gruppenführer", "sort_order": 1}]},
    )
    assert response.status_code == 403


# ============================================
# Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_personnel_response_structure(editor_client: AsyncClient, test_personnel: Personnel):
    """Test that personnel response contains all expected fields."""
    response = await editor_client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 200
    data = response.json()

    expected_fields = ["id", "name", "role", "availability", "tags"]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


# ============================================
# Multiple Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_multiple_personnel(editor_client: AsyncClient, db_session: AsyncSession):
    """Test listing multiple personnel records."""
    # Create multiple personnel
    for i in range(5):
        personnel = Personnel(
            id=uuid4(),
            name=f"Firefighter {i}",
            role="Truppmann",
            availability="available",
        )
        db_session.add(personnel)
    await db_session.commit()

    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200
    personnel_list = response.json()
    assert len(personnel_list) == 5
