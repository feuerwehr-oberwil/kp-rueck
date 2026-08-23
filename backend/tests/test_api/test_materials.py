"""Tests for Material API endpoints.

Tests cover:
- Material CRUD operations (create, read, update, delete)
- Material listing
- Category sort order updates
- Permission enforcement (editor vs viewer)
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import IncidentAssignment, Material

# ============================================
# Fixtures
# ============================================


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
        "status": "unavailable",
    }
    response = await editor_client.put(f"/api/materials/{test_material.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Tauchpumpe"
    assert data["status"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_material_partial(editor_client: AsyncClient, test_material: Material):
    """Test partial update of material."""
    response = await editor_client.put(
        f"/api/materials/{test_material.id}",
        json={"status": "unavailable"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == test_material.name  # Unchanged
    assert data["status"] == "unavailable"


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
async def test_delete_material_archives_and_removes_it_from_the_board(
    editor_client: AsyncClient, test_material: Material
):
    """Deleting archives — and the row genuinely leaves the default listing.

    This is the defect the archive was built for: the old soft delete set
    status='unavailable' and the list endpoint kept serving the row, so the
    "deleted" item stood on the board afterwards, green and assignable.
    """
    response = await editor_client.delete(f"/api/materials/{test_material.id}")
    assert response.status_code == 204

    listed = await editor_client.get("/api/materials/")
    assert listed.json() == []

    with_archive = await editor_client.get("/api/materials/?include_archived=true")
    rows = with_archive.json()
    assert len(rows) == 1
    assert rows[0]["archived_at"] is not None
    # Archiving is not a defect: readiness stays where it was.
    assert rows[0]["out_of_service"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_material_brings_it_back(editor_client: AsyncClient, test_material: Material):
    """«Zurückholen» is a button, not a trick via Bearbeiten → Status."""
    await editor_client.delete(f"/api/materials/{test_material.id}")

    response = await editor_client.post(f"/api/materials/{test_material.id}/restore")
    assert response.status_code == 200
    assert response.json()["archived_at"] is None

    listed = await editor_client.get("/api/materials/")
    assert len(listed.json()) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_permanent_delete_requires_archiving_first(editor_client: AsyncClient, test_material: Material):
    """The irreversible action takes two deliberate steps."""
    response = await editor_client.delete(f"/api/materials/{test_material.id}?permanent=true")
    assert response.status_code == 409

    await editor_client.post(f"/api/materials/{test_material.id}/archive")
    response = await editor_client.delete(f"/api/materials/{test_material.id}?permanent=true")
    assert response.status_code == 204

    gone = await editor_client.get(f"/api/materials/{test_material.id}")
    assert gone.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_permanent_delete_refused_for_material_used_on_a_live_incident(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_material: Material,
    test_incident,
):
    """Purging would tear a hole in that Einsatz's Auswertung — 409, not a greyed button."""
    # Closed assignment: the purge refusal is about HISTORY. An open one would
    # already stop the archive step (its own 409, tested below).
    db_session.add(
        IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="material",
            resource_id=test_material.id,
            unassigned_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    await editor_client.post(f"/api/materials/{test_material.id}/archive")
    response = await editor_client.delete(f"/api/materials/{test_material.id}?permanent=true")
    assert response.status_code == 409

    archived = await editor_client.get(f"/api/materials/{test_material.id}")
    assert archived.json()["can_delete"] is False
    assert archived.json()["assignment_count"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_permanent_delete_allowed_for_material_used_only_in_training(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_material: Material,
    test_incident,
    test_event,
):
    """A test entry that only ever appeared on a Übung stays purgeable."""
    test_event.training_flag = True
    db_session.add(
        IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="material",
            resource_id=test_material.id,
        )
    )
    await db_session.commit()

    await editor_client.post(f"/api/materials/{test_material.id}/archive")
    archived = await editor_client.get(f"/api/materials/{test_material.id}")
    assert archived.json()["can_delete"] is True
    assert archived.json()["assignment_count"] == 1

    response = await editor_client.delete(f"/api/materials/{test_material.id}?permanent=true")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_refused_while_the_material_stands_on_a_live_einsatz(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_material: Material,
    test_incident,
):
    """Archiving mid-deployment would vanish the chip off a card an operator is working — 409.

    Same pattern as the purge's `in_use` refusal; closing the assignment reopens
    the normal retirement path.
    """
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=test_incident.id,
        resource_type="material",
        resource_id=test_material.id,
    )
    db_session.add(assignment)
    await db_session.commit()

    refused = await editor_client.post(f"/api/materials/{test_material.id}/archive")
    assert refused.status_code == 409
    assert test_material.name in refused.json()["detail"]

    # The default DELETE is the same archive — same refusal.
    assert (await editor_client.delete(f"/api/materials/{test_material.id}")).status_code == 409

    assignment.unassigned_at = datetime.now(UTC)
    await db_session.commit()
    assert (await editor_client.post(f"/api/materials/{test_material.id}/archive")).status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_out_of_service_is_its_own_state(editor_client: AsyncClient, test_material: Material):
    """«Nicht einsatzbereit» is a flag with a date, and it does not archive anything."""
    response = await editor_client.put(f"/api/materials/{test_material.id}", json={"out_of_service": True})
    assert response.status_code == 200
    data = response.json()
    assert data["out_of_service"] is True
    assert data["out_of_service_since"] is not None
    assert data["archived_at"] is None
    assert data["status"] == "unavailable"  # legacy mirror stays in lockstep

    # An unrelated edit must not reset "seit …".
    renamed = await editor_client.put(f"/api/materials/{test_material.id}", json={"name": "Tauchpumpe Gr."})
    assert renamed.json()["out_of_service_since"] == data["out_of_service_since"]

    cleared = await editor_client.put(f"/api/materials/{test_material.id}", json={"out_of_service": False})
    assert cleared.json()["out_of_service"] is False
    assert cleared.json()["out_of_service_since"] is None
    assert cleared.json()["status"] == "available"


@pytest.mark.asyncio
@pytest.mark.api
async def test_legacy_status_write_still_sets_readiness(editor_client: AsyncClient, test_material: Material):
    """Clients that only know `status` write the same flag as `out_of_service`."""
    response = await editor_client.put(f"/api/materials/{test_material.id}", json={"status": "unavailable"})
    assert response.status_code == 200
    assert response.json()["out_of_service"] is True
    assert response.json()["out_of_service_since"] is not None


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

    expected_fields = [
        "id",
        "name",
        "type",
        "location",
        "status",
        "out_of_service",
        "out_of_service_since",
        "archived_at",
        "assignment_count",
        "can_delete",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"
