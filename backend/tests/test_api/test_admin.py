"""Tests for Admin API endpoints.

Tests cover:
- Excel import/export functionality
- Template download
- Import preview and execution
- Training data seeding
- Permission enforcement
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Material, Personnel, Vehicle


@pytest_asyncio.fixture
async def test_data(db_session: AsyncSession):
    """Create test data for export testing."""
    # Create personnel
    personnel = Personnel(
        id=uuid4(),
        name="Test Person",
        role="atemschutz",
        availability="available",
    )
    db_session.add(personnel)

    # Create vehicle
    vehicle = Vehicle(
        id=uuid4(),
        name="TLF Test",
        type="tlf",
        status="available",
    )
    db_session.add(vehicle)

    # Create material
    material = Material(
        id=uuid4(),
        name="Test Schlauch",
        type="Schlauch",
        status="available",
    )
    db_session.add(material)

    await db_session.commit()
    return {"personnel": personnel, "vehicle": vehicle, "material": material}


# ============================================
# Template Download Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_download_template_requires_auth(client: AsyncClient):
    """Test that downloading template requires authentication."""
    response = await client.get("/api/admin/import/template")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_download_template_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot download template."""
    response = await viewer_client.get("/api/admin/import/template")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_download_template_success(editor_client: AsyncClient):
    """Test successful template download."""
    response = await editor_client.get("/api/admin/import/template")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert "kprueck_import_template.xlsx" in response.headers.get("content-disposition", "")


# ============================================
# Import Preview Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_requires_auth(client: AsyncClient):
    """Test that import preview requires authentication."""
    response = await client.post("/api/admin/import/preview")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot preview import."""
    # Create a mock file
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    response = await viewer_client.post("/api/admin/import/preview", files=files)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_invalid_file_type(editor_client: AsyncClient):
    """Test that non-Excel files are rejected."""
    files = {"file": ("test.txt", b"fake content", "text/plain")}
    response = await editor_client.post("/api/admin/import/preview", files=files)
    assert response.status_code == 400
    assert "Excel format" in response.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_with_valid_excel(editor_client: AsyncClient):
    """Test import preview with valid Excel file (mocked)."""
    with patch(
        "app.api.admin.validate_and_parse_excel",
        return_value={
            "personnel": [{"name": "Test", "role": "atemschutz"}],
            "vehicles": [{"name": "TLF", "type": "tlf"}],
            "materials": [{"name": "Schlauch", "category": "schlauch"}],
        },
    ):
        files = {
            "file": (
                "test.xlsx",
                b"fake excel content",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        }
        response = await editor_client.post("/api/admin/import/preview", files=files)
        assert response.status_code == 200
        data = response.json()
        assert "personnel_preview" in data
        assert "vehicles_preview" in data
        assert "materials_preview" in data
        assert data["personnel_total"] == 1


# ============================================
# Import Execute Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_requires_auth(client: AsyncClient):
    """Test that import execution requires authentication."""
    response = await client.post("/api/admin/import/execute")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot execute import."""
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    response = await viewer_client.post("/api/admin/import/execute", files=files)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_invalid_mode(editor_client: AsyncClient):
    """Test that invalid import mode is rejected."""
    with patch(
        "app.api.admin.validate_and_parse_excel", return_value={"personnel": [], "vehicles": [], "materials": []}
    ):
        files = {
            "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        response = await editor_client.post("/api/admin/import/execute", files=files, params={"mode": "invalid"})
        assert response.status_code == 400
        assert "Invalid mode" in response.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_mode(editor_client: AsyncClient):
    """Test import execution in replace mode (mocked)."""
    with (
        patch(
            "app.api.admin.validate_and_parse_excel",
            return_value={"personnel": [], "vehicles": [], "materials": []},
        ),
        patch(
            "app.api.admin.import_data",
            new_callable=AsyncMock,
            return_value={"personnel": 5, "vehicles": 3, "materials": 10},
        ),
    ):
        files = {
            "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        response = await editor_client.post("/api/admin/import/execute", files=files, params={"mode": "replace"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["mode"] == "replace"
        assert data["counts"]["personnel"] == 5


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_append_mode(editor_client: AsyncClient):
    """Test import execution in append mode (mocked)."""
    with (
        patch(
            "app.api.admin.validate_and_parse_excel",
            return_value={"personnel": [], "vehicles": [], "materials": []},
        ),
        patch(
            "app.api.admin.import_data",
            new_callable=AsyncMock,
            return_value={"personnel": 2, "vehicles": 1, "materials": 5},
        ),
    ):
        files = {
            "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        response = await editor_client.post("/api/admin/import/execute", files=files, params={"mode": "append"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["mode"] == "append"


# ============================================
# Export Data Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_data_requires_auth(client: AsyncClient):
    """Test that data export requires authentication."""
    response = await client.get("/api/admin/export/data")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_data_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot export data."""
    response = await viewer_client.get("/api/admin/export/data")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_data_success(editor_client: AsyncClient, test_data):
    """Test successful data export."""
    response = await editor_client.get("/api/admin/export/data")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    disposition = response.headers.get("content-disposition", "")
    assert "kprueck_export_" in disposition
    assert ".xlsx" in disposition


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_data_filename_format(editor_client: AsyncClient):
    """Test that export filename follows expected format."""
    response = await editor_client.get("/api/admin/export/data")
    assert response.status_code == 200
    disposition = response.headers.get("content-disposition", "")
    # Filename should have timestamp format: kprueck_export_YYYYMMDD_HHMMSS.xlsx
    assert "kprueck_export_" in disposition
    assert ".xlsx" in disposition


# ============================================
# Seed Training Data Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_seed_training_requires_auth(client: AsyncClient):
    """Test that seeding training data requires authentication."""
    response = await client.post("/api/admin/seed-training")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_seed_training_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot seed training data."""
    response = await viewer_client.post("/api/admin/seed-training")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_seed_training_success(editor_client: AsyncClient):
    """Test successful training data seeding (mocked)."""
    with patch("app.api.admin.seed_training_data", new_callable=AsyncMock):
        response = await editor_client.post("/api/admin/seed-training")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "skip_geocoding" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_seed_training_with_geocoding_skip(editor_client: AsyncClient):
    """Test seeding with skip_geocoding parameter."""
    with patch("app.api.admin.seed_training_data", new_callable=AsyncMock):
        response = await editor_client.post("/api/admin/seed-training", params={"skip_geocoding": True})
        assert response.status_code == 200
        data = response.json()
        assert data["skip_geocoding"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_seed_training_force_reseed(editor_client: AsyncClient):
    """Test seeding with force_reseed parameter."""
    with patch("app.api.admin.seed_training_data", new_callable=AsyncMock):
        response = await editor_client.post("/api/admin/seed-training", params={"force_reseed": True})
        assert response.status_code == 200
        data = response.json()
        assert data["force_reseed"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_seed_training_failure(editor_client: AsyncClient):
    """Test handling of seeding failure."""
    with patch("app.api.admin.seed_training_data", new_callable=AsyncMock, side_effect=Exception("Seeding failed")):
        response = await editor_client.post("/api/admin/seed-training")
        assert response.status_code == 500
        assert response.json()["detail"] == "Verarbeitung fehlgeschlagen"


# ============================================
# Audit Log Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_creates_audit_log(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that import execution creates audit log entry."""
    from sqlalchemy import select

    from app.models import AuditLog

    with (
        patch(
            "app.api.admin.validate_and_parse_excel",
            return_value={"personnel": [], "vehicles": [], "materials": []},
        ),
        patch(
            "app.api.admin.import_data",
            new_callable=AsyncMock,
            return_value={"personnel": 0, "vehicles": 0, "materials": 0},
        ),
    ):
        files = {
            "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        response = await editor_client.post("/api/admin/import/execute", files=files)
        assert response.status_code == 200

    # Check audit log
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action_type == "import").where(AuditLog.resource_type == "bulk_data")
    )
    audit_entry = result.scalar_one_or_none()
    assert audit_entry is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_creates_audit_log(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that data export creates audit log entry."""
    from sqlalchemy import select

    from app.models import AuditLog

    response = await editor_client.get("/api/admin/export/data")
    assert response.status_code == 200

    # Check audit log
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action_type == "export").where(AuditLog.resource_type == "bulk_data")
    )
    audit_entry = result.scalar_one_or_none()
    assert audit_entry is not None
