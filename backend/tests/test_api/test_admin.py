"""Tests for Admin API endpoints.

Tests cover:
- Excel import/export functionality
- Template download
- Import preview and execution
- Training data seeding
- Permission enforcement
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import _refuse_active_assignments
from app.models import (
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    Personnel,
    User,
    Vehicle,
)
from app.services.excel_import_export import ExcelImportError, ParsedImport, ParsedSheet


def full_workbook(
    *,
    personnel: list[dict] | None = None,
    vehicles: list[dict] | None = None,
    materials: list[dict] | None = None,
) -> ParsedImport:
    """What the parser returns for a file that has all three sheets in it.

    Empty here means "the sheet is there with only its header" – which in `replace`
    mode legitimately clears that table. A sheet the file does not have at all is a
    different thing entirely (`ParsedSheet(present=False)`) and is built by hand in
    the tests that care.
    """
    return ParsedImport(
        personnel=ParsedSheet(present=True, rows=personnel or []),
        vehicles=ParsedSheet(present=True, rows=vehicles or []),
        materials=ParsedSheet(present=True, rows=materials or []),
    )


@pytest_asyncio.fixture
async def test_data(db_session: AsyncSession):
    """Create test data for export testing."""
    # Create personnel
    personnel = Personnel(
        id=uuid4(),
        name="Test Person",
        role="atemschutz",
        status="available",
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
    response = await editor_client.post("/api/admin/import/preview", files=files, data={"mode": "replace"})
    assert response.status_code == 400
    assert "Excel format" in response.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_with_valid_excel(editor_client: AsyncClient):
    """Test import preview with valid Excel file (mocked)."""
    with patch(
        "app.api.admin.validate_and_parse_excel",
        return_value=full_workbook(
            personnel=[{"name": "Test", "role": "atemschutz"}],
            vehicles=[{"name": "TLF", "type": "tlf"}],
            materials=[{"name": "Schlauch", "category": "schlauch"}],
        ),
    ):
        files = {
            "file": (
                "test.xlsx",
                b"fake excel content",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        }
        response = await editor_client.post("/api/admin/import/preview", files=files, data={"mode": "append"})
        assert response.status_code == 200
        data = response.json()
        assert "personnel_preview" in data
        assert "vehicles_preview" in data
        assert "materials_preview" in data
        assert data["personnel_total"] == 1


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("endpoint", ["preview", "execute"])
async def test_import_rejects_with_sheet_and_row(editor_client: AsyncClient, endpoint: str):
    """The parser names the cell; both handlers used to throw that away.

    They answered a flat "Excel-Datei konnte nicht verarbeitet werden", which leaves a
    volunteer bisecting an 18-row spreadsheet by hand. The German framing stays, the
    parser's sheet and row come with it – on both endpoints, since preview is where an
    operator looks first.
    """
    error = ExcelImportError("ungültiger Status 'einsatzbereit'.", sheet="Vehicles", row=7)
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", side_effect=error):
        response = await editor_client.post(f"/api/admin/import/{endpoint}", files=files, data={"mode": "append"})

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail.startswith("Excel-Datei konnte nicht verarbeitet werden: ")
    assert "Vehicles Zeile 7" in detail
    assert "einsatzbereit" in detail


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
        "app.api.admin.validate_and_parse_excel", return_value=full_workbook(personnel=[], vehicles=[], materials=[])
    ):
        files = {
            "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "invalid"})
        assert response.status_code == 400
        detail = response.json()["detail"]
        assert "'replace'" in detail and "'append'" in detail


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_mode(editor_client: AsyncClient):
    """Test import execution in replace mode (mocked)."""
    with (
        patch(
            "app.api.admin.validate_and_parse_excel",
            return_value=full_workbook(personnel=[], vehicles=[], materials=[]),
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
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "replace"})
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
            return_value=full_workbook(personnel=[], vehicles=[], materials=[]),
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
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "append"})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["mode"] == "append"


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_append_keeps_existing_rows(editor_client: AsyncClient, db_session: AsyncSession):
    """`append` must actually append – the regression that deleted a station's roster.

    `mode` had no `Form(...)`, so FastAPI bound it from the QUERY STRING while the client
    sends it in the multipart body next to the file. Nothing ever supplied it, the default
    won every time, and each import ran as `replace`: `delete(Personnel)`, `delete(Vehicle)`,
    `delete(Material)` – cascading into check-in history and Divera identities.

    The old tests missed it twice over: they passed `mode` as a query param (so they proved
    the binding the frontend does NOT use), and they mocked `import_data` away (so no row was
    ever really deleted). This one sends `mode` the way `api-client.ts:1202` sends it and lets
    the real `import_data` run against the database.
    """
    survivor = Personnel(id=uuid4(), name="Bestand Bea", role="Gruppenführer", status="available")
    db_session.add(survivor)
    await db_session.commit()

    parsed = full_workbook(
        personnel=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}], vehicles=[], materials=[]
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "append"})

    assert response.status_code == 200
    assert response.json()["mode"] == "append"

    names = {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()}
    assert names == {"Bestand Bea", "Neu Nina"}, "append deleted existing personnel – this is the full-wipe bug"


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_still_replaces(editor_client: AsyncClient, db_session: AsyncSession):
    """The other side of the same fix: `replace` must keep deleting when it is asked for.

    Fixing the binding must not quietly turn the destructive mode off for the operators who
    want it – "load a fresh station" is what this endpoint is for. It is no longer the
    default, though: see `test_import_execute_without_mode_is_rejected`.
    """
    doomed = Personnel(id=uuid4(), name="Alt Anna", role="Maschinist", status="available")
    db_session.add(doomed)
    await db_session.commit()

    parsed = full_workbook(
        personnel=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}], vehicles=[], materials=[]
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "replace"})

    assert response.status_code == 200
    assert response.json()["mode"] == "replace"

    names = {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()}
    assert names == {"Neu Nina"}


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_merge_is_rejected(editor_client: AsyncClient, db_session: AsyncSession):
    """`merge` was accepted, documented as "update existing by name" – and ran replace's DELETEs.

    A station uploaded a one-row sheet with `mode=merge` to add two recruits and was left
    with one person, no vehicles and no material. The mode is gone; the error has to name
    the two that work and say what they do, because "invalid mode" would send the same
    operator straight back to guessing.
    """
    survivor = Personnel(id=uuid4(), name="Bestand Bea", role="Gruppenführer", status="available")
    db_session.add(survivor)
    await db_session.commit()

    parsed = full_workbook(
        personnel=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}], vehicles=[], materials=[]
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "merge"})

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "'replace'" in detail and "'append'" in detail
    assert "löscht" in detail and "behält" in detail

    names = {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()}
    assert names == {"Bestand Bea"}, "the rejected import still touched the database"


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_without_mode_is_rejected(editor_client: AsyncClient, db_session: AsyncSession):
    """No mode used to mean `replace` – a forgotten form field wiped the station."""
    survivor = Personnel(id=uuid4(), name="Bestand Bea", role="Gruppenführer", status="available")
    db_session.add(survivor)
    await db_session.commit()

    parsed = full_workbook(
        personnel=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}], vehicles=[], materials=[]
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "'replace'" in detail and "'append'" in detail

    names = {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()}
    assert names == {"Bestand Bea"}, "a mode-less import deleted data – the default is back"


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_append_keeps_vehicles_and_materials(
    editor_client: AsyncClient, db_session: AsyncSession, test_data
):
    """`append` deletes nothing – not personnel, not the fleet, not the material list."""
    parsed = full_workbook(
        personnel=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}],
        vehicles=[{"name": "TLF Neu", "type": "tlf", "status": "available"}],
        materials=[{"name": "Schlauch Neu", "type": "Schlauch", "status": "available"}],
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "append"})

    assert response.status_code == 200
    assert {v.name for v in (await db_session.execute(select(Vehicle))).scalars().all()} == {"TLF Test", "TLF Neu"}
    assert {m.name for m in (await db_session.execute(select(Material))).scalars().all()} == {
        "Test Schlauch",
        "Schlauch Neu",
    }


# ============================================
# Import Preview: deletion impact
# ============================================


@pytest_asyncio.fixture
async def assigned_resources(db_session: AsyncSession, test_incident: Incident, test_editor: User):
    """A person and a vehicle on a running incident, plus one already-released person.

    Reproduces what a `replace` import walks into: assignments reference their resource by
    a bare UUID, so deleting the resource leaves these rows behind pointing at nothing.
    """
    person = Personnel(id=uuid4(), name="Eingeteilt Erna", role="Atemschutz", status="available")
    released = Personnel(id=uuid4(), name="Abgelöst Aldo", role="Maschinist", status="available")
    vehicle = Vehicle(id=uuid4(), name="TLF 1", type="tlf", status="available")
    db_session.add_all([person, released, vehicle])
    await db_session.flush()

    db_session.add_all(
        [
            IncidentAssignment(
                id=uuid4(),
                incident_id=test_incident.id,
                resource_type="personnel",
                resource_id=person.id,
                assigned_by=test_editor.id,
            ),
            IncidentAssignment(
                id=uuid4(),
                incident_id=test_incident.id,
                resource_type="vehicle",
                resource_id=vehicle.id,
                assigned_by=test_editor.id,
            ),
            IncidentAssignment(
                id=uuid4(),
                incident_id=test_incident.id,
                resource_type="personnel",
                resource_id=released.id,
                assigned_by=test_editor.id,
                unassigned_at=datetime.now(UTC),
            ),
        ]
    )
    await db_session.commit()
    return {"person": person, "released": released, "vehicle": vehicle}


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_replace_reports_deletions(editor_client: AsyncClient, assigned_resources):
    """The preview showed only what would be ADDED, which reads harmless in either mode.

    The assignment count is the one nobody sees coming: 24 rows on three running incidents
    survived the roster wipe pointing at personnel that no longer existed.
    """
    parsed = full_workbook(personnel=[{"name": "Neu Nina", "role": "Atemschutz"}], vehicles=[], materials=[])
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/preview", files=files, data={"mode": "replace"})

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "replace"
    assert data["deletions"] == {
        "personnel": 2,
        "vehicles": 1,
        "materials": 0,
        "incident_assignments": 3,
        "active_incident_assignments": 2,
        "incident_group_assignments": 0,
        "active_incident_group_assignments": 0,
        "cascade_event_attendance": 0,
        "cascade_event_special_functions": 0,
        "cascade_personnel_identities": 0,
    }
    # The additive numbers stay exactly where the UI already reads them.
    assert data["personnel_total"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_append_reports_no_deletions(editor_client: AsyncClient, assigned_resources):
    """`append` deletes nothing, so the warning must not appear where it does not apply."""
    parsed = full_workbook(personnel=[{"name": "Neu Nina", "role": "Atemschutz"}], vehicles=[], materials=[])
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/preview", files=files, data={"mode": "append"})

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "append"
    assert set(data["deletions"].values()) == {0}


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_refuses_live_assignments(
    editor_client: AsyncClient, db_session: AsyncSession, assigned_resources
):
    """`replace` must not orphan assignments that are still on a running incident.

    There is no foreign key to cascade through, so the rows would simply survive their
    resource. Refuse instead – the operator can release them, close the incident, or append.
    """
    parsed = full_workbook(
        personnel=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}], vehicles=[], materials=[]
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "replace"})

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "'append'" in detail

    # The count alone was a dead end – it told the operator that two assignments
    # were in the way and nothing about where to find them.
    assert "'Wohnungsbrand' (Hauptstrasse 123, Basel): 1 Person, 1 Fahrzeug" in detail
    # No material on this incident, so the Rapport sentence would only be noise.
    assert "Material zurück" not in detail

    names = {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()}
    assert names == {"Eingeteilt Erna", "Abgelöst Aldo"}


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_names_material_blockers(
    editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident, test_editor: User
):
    """The state an operator lands in after doing the one thing they know about.

    "Alle freigeben" releases personnel and vehicles and deliberately leaves
    material assigned, so a released incident still blocks the import – with the
    operator convinced the board is clear. The refusal has to name the material
    and say where it goes back, or they retry forever.
    """
    material = Material(id=uuid4(), name="Tauchpumpe 2", type="Tauchpumpen", location="TLF")
    db_session.add(material)
    await db_session.flush()
    db_session.add(
        IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="material",
            resource_id=material.id,
            assigned_by=test_editor.id,
        )
    )
    await db_session.commit()

    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=full_workbook()):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "replace"})

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "'Wohnungsbrand' (Hauptstrasse 123, Basel): 1 Material" in detail
    assert "Material zurück – freigeben" in detail


def test_refuse_active_assignments_caps_the_list():
    """Beyond a handful the list stops being walkable, so it counts the rest instead."""
    blockers = [
        {
            "kind": "incident",
            "title": f"Einsatz {index}",
            "location": None,
            "deleted": False,
            "personnel": 1,
            "vehicles": 0,
            "materials": 0,
            "total": 1,
        }
        for index in range(8)
    ]

    with pytest.raises(HTTPException) as excinfo:
        _refuse_active_assignments(8, blockers)

    detail = excinfo.value.detail
    assert "'Einsatz 4': 1 Person" in detail
    assert "'Einsatz 5'" not in detail
    assert "und 3 weitere Einsätze" in detail
    # Nothing in the way is an Auftrag, so the message must not invent the concept.
    assert "Auftrag" not in detail


@pytest_asyncio.fixture
async def group_assigned_person(db_session: AsyncSession, test_event: Event, test_editor: User):
    """A person assigned to an Auftrag – on the route, not on any of its stops.

    The shape the `replace` guard was blind to: `incident_group_assignments` is a
    second polymorphic table with the same bare `resource_id`, so the wipe orphaned
    it exactly the same way and nothing counted it or refused because of it.
    """
    person = Personnel(id=uuid4(), name="Route Rico", role="Maschinist", status="available")
    group = IncidentGroup(id=uuid4(), name="Sturm Nord", event_id=test_event.id)
    db_session.add_all([person, group])
    await db_session.flush()
    db_session.add(
        IncidentGroupAssignment(
            id=uuid4(),
            incident_group_id=group.id,
            resource_type="personnel",
            resource_id=person.id,
            assigned_by=test_editor.id,
        )
    )
    await db_session.commit()
    return {"person": person, "group": group}


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_counts_group_assignments(editor_client: AsyncClient, group_assigned_person):
    """The preview has to show the Auftrag's assignments, not only the incidents'."""
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=full_workbook()):
        response = await editor_client.post("/api/admin/import/preview", files=files, data={"mode": "replace"})

    assert response.status_code == 200
    deletions = response.json()["deletions"]
    assert deletions["incident_group_assignments"] == 1
    assert deletions["active_incident_group_assignments"] == 1
    # No incident holds anything here – proof the number comes from the second table.
    assert deletions["active_incident_assignments"] == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_refuses_group_assignments(
    editor_client: AsyncClient, db_session: AsyncSession, group_assigned_person
):
    """An Auftrag holding a squad blocks the wipe, and the refusal says it is an Auftrag."""
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=full_workbook()):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "replace"})

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "Auftrag 'Sturm Nord': 1 Person" in detail
    # Sent to the stop the operator finds an empty resource list, so the wording has
    # to name Aufträge as a place resources are held.
    assert "laufenden Einsätzen und Aufträgen" in detail

    survivors = {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()}
    assert survivors == {"Route Rico"}


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_preview_counts_cascaded_check_ins(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
):
    """Deleting the roster CASCADEs into `event_attendance` – silently, until now.

    `event_attendance.personnel_id` is a real FK with ON DELETE CASCADE, so a
    `replace` during a running event takes every check-in with it and leaves no
    row to notice afterwards. The preview has to say the number beforehand.
    """
    person = Personnel(id=uuid4(), name="Angemeldet Anna", role="Atemschutz", status="available")
    db_session.add(person)
    await db_session.flush()
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=person.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=full_workbook()):
        response = await editor_client.post("/api/admin/import/preview", files=files, data={"mode": "replace"})

    assert response.status_code == 200
    assert response.json()["deletions"]["cascade_event_attendance"] == 1

    # `append` deletes nothing, so it must not report a cascade either.
    with patch("app.api.admin.validate_and_parse_excel", return_value=full_workbook()):
        appended = await editor_client.post("/api/admin/import/preview", files=files, data={"mode": "append"})
    assert appended.json()["deletions"]["cascade_event_attendance"] == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_refuses_missing_sheet(
    editor_client: AsyncClient, db_session: AsyncSession, test_data
):
    """A Personnel-only workbook in `replace` mode wiped the fleet and the material list.

    `validate_and_parse_excel` skips a sheet the file does not have, `import_data` deleted
    all three tables regardless, and the response said `success: true`. The preview's
    numbers could not warn either – they say how much would go, not that nothing is coming
    back. So: refuse, name the sheets and the rows at stake, and say what to do instead.
    """
    parsed = ParsedImport(
        personnel=ParsedSheet(present=True, rows=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}]),
        vehicles=ParsedSheet(present=False),
        materials=ParsedSheet(present=False),
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "replace"})

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "'Vehicles'" in detail and "'Materials'" in detail
    assert "'Personnel'" not in detail, "the sheet that IS in the file must not be blamed"
    assert "1 Zeile)" in detail
    assert "'append'" in detail

    # Nothing was deleted, and nothing was inserted either.
    assert {v.name for v in (await db_session.execute(select(Vehicle))).scalars().all()} == {"TLF Test"}
    assert {m.name for m in (await db_session.execute(select(Material))).scalars().all()} == {"Test Schlauch"}
    assert {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()} == {"Test Person"}


@pytest.mark.asyncio
@pytest.mark.api
async def test_import_execute_replace_accepts_empty_sheet(
    editor_client: AsyncClient, db_session: AsyncSession, test_data
):
    """An empty sheet is an answer – "the station has no vehicles" – and must still clear.

    This is the case the missing-sheet refusal must not swallow: header row, no data rows,
    table emptied on purpose.
    """
    parsed = ParsedImport(
        personnel=ParsedSheet(present=True, rows=[{"name": "Neu Nina", "role": "Atemschutz", "status": "available"}]),
        vehicles=ParsedSheet(present=True),
        materials=ParsedSheet(present=True),
    )
    files = {
        "file": ("test.xlsx", b"fake content", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    with patch("app.api.admin.validate_and_parse_excel", return_value=parsed):
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "replace"})

    assert response.status_code == 200
    assert (await db_session.execute(select(Vehicle))).scalars().all() == []
    assert (await db_session.execute(select(Material))).scalars().all() == []
    assert {p.name for p in (await db_session.execute(select(Personnel))).scalars().all()} == {"Neu Nina"}


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
            return_value=full_workbook(personnel=[], vehicles=[], materials=[]),
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
        response = await editor_client.post("/api/admin/import/execute", files=files, data={"mode": "append"})
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
