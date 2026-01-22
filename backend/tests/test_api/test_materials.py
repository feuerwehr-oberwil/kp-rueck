"""Tests for Material API endpoints.

Tests cover:
- Material CRUD operations (create, read, update, delete)
- Material listing
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
from app.models import Material, User

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
        username="material_editor",
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
        username="material_viewer",
        password_hash=hash_password("viewerpass123"),
        role="viewer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_material(db_session: AsyncSession) -> Material:
    """Create a test material."""
    material = Material(
        id=uuid4(),
        name="Tauchpumpe TP 8/1",
        type="Tauchpumpen",
        location="TLF",
        status="available",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "material_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient, test_viewer: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "material_viewer", "password": "viewerpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# List Materials Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_materials_requires_auth(client: AsyncClient):
    """Test that listing materials requires authentication."""
    response = await client.get("/api/materials/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_materials_empty(editor_client: AsyncClient):
    """Test listing materials when none exist."""
    response = await editor_client.get("/api/materials/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_materials_success(editor_client: AsyncClient, test_material: Material):
    """Test listing materials successfully."""
    response = await editor_client.get("/api/materials/")
    assert response.status_code == 200
    materials = response.json()
    assert len(materials) == 1
    assert materials[0]["id"] == str(test_material.id)
    assert materials[0]["name"] == test_material.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_materials_viewer_can_read(viewer_client: AsyncClient, test_material: Material):
    """Test that viewers can list materials."""
    response = await viewer_client.get("/api/materials/")
    assert response.status_code == 200
    assert len(response.json()) == 1


# ============================================
# Get Material Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_material_requires_auth(client: AsyncClient, test_material: Material):
    """Test that getting material requires authentication."""
    response = await client.get(f"/api/materials/{test_material.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_material_success(editor_client: AsyncClient, test_material: Material):
    """Test getting a single material."""
    response = await editor_client.get(f"/api/materials/{test_material.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_material.id)
    assert data["name"] == test_material.name
    assert data["type"] == test_material.type
    assert data["location"] == test_material.location
    assert data["status"] == test_material.status


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_material_not_found(editor_client: AsyncClient):
    """Test getting a non-existent material."""
    response = await editor_client.get(f"/api/materials/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_material_viewer_can_read(viewer_client: AsyncClient, test_material: Material):
    """Test that viewers can get material details."""
    response = await viewer_client.get(f"/api/materials/{test_material.id}")
    assert response.status_code == 200


# ============================================
# Create Material Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_material_requires_auth(client: AsyncClient):
    """Test that creating material requires authentication."""
    response = await client.post("/api/materials/", json={"name": "New Material"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_material_success(editor_client: AsyncClient):
    """Test creating a material successfully."""
    material_data = {
        "name": "Schlauchpaket B 20m",
        "type": "Tauchpumpen",
        "location": "TLF",
        "status": "available",
    }
    response = await editor_client.post("/api/materials/", json=material_data)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Schlauchpaket B 20m"
    assert data["type"] == "Tauchpumpen"
    assert data["location"] == "TLF"
    assert data["status"] == "available"
    assert "id" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_material_minimal(editor_client: AsyncClient):
    """Test creating material with required fields.

    name, type, and location are all required fields.
    """
    response = await editor_client.post(
        "/api/materials/",
        json={"name": "Basic Material", "type": "Sonstiges", "location": "Depot"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Basic Material"


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_material_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot create materials."""
    response = await viewer_client.post("/api/materials/", json={"name": "New Material"})
    assert response.status_code == 403


# ============================================
# Update Material Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_material_requires_auth(client: AsyncClient, test_material: Material):
    """Test that updating material requires authentication."""
    response = await client.put(f"/api/materials/{test_material.id}", json={"name": "Updated"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_material_success(editor_client: AsyncClient, test_material: Material):
    """Test updating a material successfully."""
    update_data = {
        "name": "Updated Tauchpumpe",
        "status": "assigned",
    }
    response = await editor_client.put(f"/api/materials/{test_material.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Tauchpumpe"
    assert data["status"] == "assigned"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_material_partial(editor_client: AsyncClient, test_material: Material):
    """Test partial update of material."""
    response = await editor_client.put(
        f"/api/materials/{test_material.id}",
        json={"status": "maintenance"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == test_material.name  # Unchanged
    assert data["status"] == "maintenance"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_material_not_found(editor_client: AsyncClient):
    """Test updating a non-existent material."""
    response = await editor_client.put(f"/api/materials/{uuid4()}", json={"name": "Updated"})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_material_viewer_forbidden(viewer_client: AsyncClient, test_material: Material):
    """Test that viewers cannot update materials."""
    response = await viewer_client.put(f"/api/materials/{test_material.id}", json={"name": "Updated"})
    assert response.status_code == 403


# ============================================
# Delete Material Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_material_requires_auth(client: AsyncClient, test_material: Material):
    """Test that deleting material requires authentication."""
    response = await client.delete(f"/api/materials/{test_material.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_material_success(editor_client: AsyncClient, test_material: Material):
    """Test deleting a material successfully (soft delete)."""
    response = await editor_client.delete(f"/api/materials/{test_material.id}")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_material_not_found(editor_client: AsyncClient):
    """Test deleting a non-existent material."""
    response = await editor_client.delete(f"/api/materials/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_material_viewer_forbidden(viewer_client: AsyncClient, test_material: Material):
    """Test that viewers cannot delete materials."""
    response = await viewer_client.delete(f"/api/materials/{test_material.id}")
    assert response.status_code == 403


# ============================================
# Category Sort Order Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_category_sort_order_requires_auth(client: AsyncClient):
    """Test that updating category sort order requires authentication."""
    response = await client.post(
        "/api/materials/categories/sort-order",
        json={"categories": [{"category": "TLF", "sort_order": 1}]},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_category_sort_order_success(editor_client: AsyncClient, test_material: Material):
    """Test updating category sort order."""
    sort_data = {
        "categories": [
            {"category": "TLF", "sort_order": 1},
            {"category": "Magazin", "sort_order": 2},
        ]
    }
    response = await editor_client.post("/api/materials/categories/sort-order", json=sort_data)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["updated_categories"] == 2


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_category_sort_order_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot update category sort order."""
    response = await viewer_client.post(
        "/api/materials/categories/sort-order",
        json={"categories": [{"category": "TLF", "sort_order": 1}]},
    )
    assert response.status_code == 403


# ============================================
# Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_material_response_structure(editor_client: AsyncClient, test_material: Material):
    """Test that material response contains all expected fields."""
    response = await editor_client.get(f"/api/materials/{test_material.id}")
    assert response.status_code == 200
    data = response.json()

    expected_fields = ["id", "name", "type", "location", "status"]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"
