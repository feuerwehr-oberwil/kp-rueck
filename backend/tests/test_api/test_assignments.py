"""Tests for Assignment API endpoints.

Tests cover:
- Assigning resources (personnel, vehicles, materials) to incidents
- Unassigning resources
- Getting assignments for incidents
- Releasing all resources
- Permission enforcement (editor vs viewer)
- Conflict detection
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    Personnel,
    SchadenplatzReport,
    User,
    Vehicle,
)


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Assignment Test Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_event: Event, test_editor: User) -> Incident:
    """Create a test incident."""
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Assignment Test Incident",
        type="brandbekaempfung",
        priority="medium",
        status="incoming",
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def second_incident(db_session: AsyncSession, test_event: Event, test_editor: User) -> Incident:
    """Create a second test incident for conflict testing."""
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Second Test Incident",
        type="elementarereignis",
        priority="high",
        status="enroute",
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Test Firefighter",
        role="Gruppenführer",
        status="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    """Create test vehicle."""
    vehicle = Vehicle(
        id=uuid4(),
        name="TLF 1",
        type="TLF",
        status="available",
        display_order=1,
        radio_call_sign="Florian 1",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def test_material(db_session: AsyncSession) -> Material:
    """Create test material."""
    material = Material(
        id=uuid4(),
        name="Tauchpumpe 1",
        type="Tauchpumpen",
        location="TLF",
        status="available",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


# ============================================
# Assign Resource Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_personnel_success(editor_client: AsyncClient, test_incident: Incident, test_personnel: Personnel):
    """Test assigning personnel to incident."""
    assignment_data = {
        "resource_type": "personnel",
        "resource_id": str(test_personnel.id),
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)
    assert response.status_code == 200
    data = response.json()
    assert data["resource_type"] == "personnel"
    assert data["resource_id"] == str(test_personnel.id)
    assert data["incident_id"] == str(test_incident.id)
    assert "id" in data
    assert "assigned_at" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_assigning_twice_is_a_coded_race(
    editor_client: AsyncClient, test_incident: Incident, test_personnel: Personnel
):
    """The board tells a lost race from a refusal it must show by ``code``, not by the sentence."""
    body = {"resource_type": "personnel", "resource_id": str(test_personnel.id)}
    assert (await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=body)).status_code == 200
    again = await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=body)
    assert (again.status_code, again.json().get("code")) == (409, "assignment_race")


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_vehicle_success(editor_client: AsyncClient, test_incident: Incident, test_vehicle: Vehicle):
    """Test assigning vehicle to incident."""
    assignment_data = {
        "resource_type": "vehicle",
        "resource_id": str(test_vehicle.id),
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)
    assert response.status_code == 200
    data = response.json()
    assert data["resource_type"] == "vehicle"
    assert data["resource_id"] == str(test_vehicle.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_driver_stay_broadcasts(
    editor_client: AsyncClient, test_incident: Incident, test_vehicle: Vehicle
):
    """Toggling driver_stay persists and broadcasts a 'driver_stay' action for live sync."""
    assign = await editor_client.post(
        f"/api/incidents/{test_incident.id}/assign",
        json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
    )
    assignment_id = assign.json()["id"]

    with patch("app.api.assignments.broadcast_assignment_update", new_callable=AsyncMock) as mock_broadcast:
        response = await editor_client.patch(
            f"/api/incidents/{test_incident.id}/assignments/{assignment_id}",
            json={"driver_stay": True},
        )

    assert response.status_code == 200
    assert response.json()["driver_stay"] is True
    mock_broadcast.assert_awaited_once()
    # Second positional arg is the action — must be the surgical "driver_stay" signal
    assert mock_broadcast.await_args.args[1] == "driver_stay"


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_material_success(editor_client: AsyncClient, test_incident: Incident, test_material: Material):
    """Test assigning material to incident."""
    assignment_data = {
        "resource_type": "material",
        "resource_id": str(test_material.id),
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)
    assert response.status_code == 200
    data = response.json()
    assert data["resource_type"] == "material"
    assert data["resource_id"] == str(test_material.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_invalid_resource_type(editor_client: AsyncClient, test_incident: Incident):
    """A bad resource_type is refused with a message that names the legal values.

    `resource_type` used to be a bare `str` with a hand-written validator, so
    `docs/openapi.json` – the only API reference a self-hoster has, Swagger being off
    in production – said "string" and the three legal values were discoverable only by
    provoking this 422. It is a `Literal` now; this asserts the 422 it produces is at
    least as useful as the sentence the validator used to write.
    """
    assignment_data = {
        "resource_type": "invalid_type",
        "resource_id": str(uuid4()),
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)
    assert response.status_code == 422
    detail = str(response.json()).lower()
    assert "resource_type" in detail
    for legal in ("personnel", "vehicle", "material"):
        assert legal in detail, detail


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_nonexistent_resource(editor_client: AsyncClient, test_incident: Incident):
    """Test assigning a resource that doesn't exist.

    The API used to trust the caller here and store the assignment anyway, which left an
    orphan row pointing at no personnel record — something the board would show as a resource
    nobody could find. It now checks, and answers 404 like the other endpoints do for a
    missing target.
    """
    assignment_data = {
        "resource_type": "personnel",
        "resource_id": str(uuid4()),
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_requires_auth(client: AsyncClient, test_incident: Incident, test_personnel: Personnel):
    """Test that assigning requires authentication."""
    assignment_data = {
        "resource_type": "personnel",
        "resource_id": str(test_personnel.id),
    }
    response = await client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)
    assert response.status_code == 401


# ============================================
# Unassign Resource Tests
# ============================================


@pytest_asyncio.fixture
async def existing_assignment(
    db_session: AsyncSession, test_incident: Incident, test_personnel: Personnel, test_editor: User
) -> IncidentAssignment:
    """Create an existing assignment for testing unassign."""
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=test_incident.id,
        resource_type="personnel",
        resource_id=test_personnel.id,
        assigned_by=test_editor.id,
    )
    db_session.add(assignment)
    await db_session.commit()
    await db_session.refresh(assignment)
    return assignment


@pytest.mark.asyncio
@pytest.mark.api
async def test_unassign_success(
    editor_client: AsyncClient, test_incident: Incident, existing_assignment: IncidentAssignment
):
    """Test unassigning a resource from incident."""
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/unassign/{existing_assignment.id}")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_unassign_not_found(editor_client: AsyncClient, test_incident: Incident):
    """Test unassigning a non-existent assignment."""
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/unassign/{uuid4()}")
    assert response.status_code == 404


# ============================================
# «Abgeholt – freigeben» (owner pick 6A, 24.11.2026)
# ============================================


@pytest_asyncio.fixture
async def material_on_site(
    db_session: AsyncSession, test_incident: Incident, test_material: Material, test_editor: User
) -> IncidentAssignment:
    """A unit still on a CLOSED Einsatz – the Restliste's case: the crew left, the pump stayed,
    and the filed rapport says so."""
    test_incident.status = "complete"
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=test_incident.id,
        resource_type="material",
        resource_id=test_material.id,
        assigned_by=test_editor.id,
    )
    db_session.add(assignment)
    db_session.add(
        SchadenplatzReport(
            incident_id=test_incident.id,
            is_draft=False,
            submitted_at=datetime.now(UTC),
            materials_json=[
                {"assignment_id": str(assignment.id), "name": test_material.name, "used": True, "left_on_site": True}
            ],
        )
    )
    await db_session.commit()
    await db_session.refresh(assignment)
    return assignment


async def _field_facts(db_session: AsyncSession, incident_id) -> list[tuple[str, str | None]]:
    from app.models import JournalEntry

    rows = await db_session.execute(
        select(JournalEntry)
        .where(JournalEntry.incident_id == incident_id, JournalEntry.kind == "field")
        .order_by(JournalEntry.seq)
    )
    return [(row.data["type"], row.text) for row in rows.scalars().all()]


async def _collect(client: AsyncClient, incident_id, assignment_id) -> str:
    """«Abgeholt» – the undo token the POST answers."""
    response = await client.post(f"/api/incidents/{incident_id}/material-collected/{assignment_id}")
    assert response.status_code == 200, response.text
    return response.json()["released_at"]


async def _undo(client: AsyncClient, incident_id, assignment_id, released_at: str) -> int:
    response = await client.delete(
        f"/api/incidents/{incident_id}/material-collected/{assignment_id}", params={"released_at": released_at}
    )
    return response.status_code


@pytest.mark.asyncio
@pytest.mark.api
async def test_collect_material_releases_exactly_that_assignment_and_logs_abgeholt(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
    existing_assignment: IncidentAssignment,
):
    released_at = await _collect(editor_client, test_incident.id, material_on_site.id)

    await db_session.refresh(material_on_site)
    await db_session.refresh(existing_assignment)
    assert material_on_site.unassigned_at == datetime.fromisoformat(released_at)
    assert existing_assignment.unassigned_at is None  # the person on the same card stays
    assert await _field_facts(db_session, test_incident.id) == [("material_collected", "Tauchpumpe 1")]

    # A second «Abgeholt» on the released row is refused, not logged twice.
    again = await editor_client.post(f"/api/incidents/{test_incident.id}/material-collected/{material_on_site.id}")
    assert again.status_code == 409


@pytest.mark.asyncio
@pytest.mark.api
async def test_collect_material_refuses_a_person_and_a_foreign_card(
    editor_client: AsyncClient,
    test_incident: Incident,
    second_incident: Incident,
    existing_assignment: IncidentAssignment,
    material_on_site: IncidentAssignment,
):
    person = await editor_client.post(f"/api/incidents/{test_incident.id}/material-collected/{existing_assignment.id}")
    assert person.status_code == 404
    foreign = await editor_client.post(f"/api/incidents/{second_incident.id}/material-collected/{material_on_site.id}")
    assert foreign.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_collect_material_refuses_a_unit_the_amended_rapport_took_back(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
):
    # The crew cleared «Vor Ort verblieben» after the operator opened the confirm.
    report = await db_session.scalar(
        select(SchadenplatzReport).where(SchadenplatzReport.incident_id == test_incident.id)
    )
    assert report is not None
    report.materials_json = [{**report.materials_json[0], "left_on_site": False}]
    await db_session.commit()

    response = await editor_client.post(f"/api/incidents/{test_incident.id}/material-collected/{material_on_site.id}")
    assert response.status_code == 409
    assert response.json()["detail"] == "Laut Rapport ist dieses Material nicht mehr vor Ort."
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_undo_collect_reopens_the_same_row_on_the_closed_card(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
):
    released_at = await _collect(editor_client, test_incident.id, material_on_site.id)
    assert await _undo(editor_client, test_incident.id, material_on_site.id, released_at) == 204

    await db_session.refresh(material_on_site)
    # The same row – the rapport's «vor Ort verblieben» points at it, so the Restliste finds it again.
    assert material_on_site.unassigned_at is None
    assert await _field_facts(db_session, test_incident.id) == [
        ("material_collected", "Tauchpumpe 1"),
        ("material_collected_cleared", "Tauchpumpe 1"),
    ]


@pytest.mark.asyncio
@pytest.mark.api
async def test_undo_collect_reverses_only_its_own_release(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
):
    stale = await _collect(editor_client, test_incident.id, material_on_site.id)
    assert await _undo(editor_client, test_incident.id, material_on_site.id, stale) == 204
    # A regular release of the re-opened row – no collection happened.
    released = await editor_client.post(f"/api/incidents/{test_incident.id}/unassign/{material_on_site.id}")
    assert released.status_code == 204, released.text

    # The old toast's undo must not reopen it.
    assert await _undo(editor_client, test_incident.id, material_on_site.id, stale) == 409
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is not None
    assert [fact for fact, _ in await _field_facts(db_session, test_incident.id)] == [
        "material_collected",
        "material_collected_cleared",
    ]


@pytest.mark.asyncio
@pytest.mark.api
async def test_undo_collect_refuses_when_the_unit_is_elsewhere_now(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    second_incident: Incident,
    material_on_site: IncidentAssignment,
    test_material: Material,
):
    released_at = await _collect(editor_client, test_incident.id, material_on_site.id)
    reassigned = await editor_client.post(
        f"/api/incidents/{second_incident.id}/assign",
        json={"resource_type": "material", "resource_id": str(test_material.id)},
    )
    assert reassigned.status_code == 200

    assert await _undo(editor_client, test_incident.id, material_on_site.id, released_at) == 409
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_undo_collect_refuses_when_the_unit_is_on_an_auftrag_now(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
    test_material: Material,
):
    released_at = await _collect(editor_client, test_incident.id, material_on_site.id)
    auftrag = IncidentGroup(id=uuid4(), event_id=test_event.id, name="Sturmholz Nord")
    db_session.add(auftrag)
    db_session.add(
        IncidentGroupAssignment(incident_group_id=auftrag.id, resource_type="material", resource_id=test_material.id)
    )
    await db_session.commit()

    assert await _undo(editor_client, test_incident.id, material_on_site.id, released_at) == 409
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_undo_collect_refuses_archived_material(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
    test_material: Material,
):
    released_at = await _collect(editor_client, test_incident.id, material_on_site.id)
    test_material.archived_at = datetime.now(UTC)
    await db_session.commit()

    assert await _undo(editor_client, test_incident.id, material_on_site.id, released_at) == 409
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_undo_collect_refuses_a_regular_release_time(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
):
    # A regular release also stamps unassigned_at, and the participants API shows it – but no
    # «Abgeholt» recorded that time, so it is no undo token.
    released = await editor_client.post(f"/api/incidents/{test_incident.id}/unassign/{material_on_site.id}")
    assert released.status_code == 204, released.text
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is not None

    assert (
        await _undo(editor_client, test_incident.id, material_on_site.id, material_on_site.unassigned_at.isoformat())
        == 409
    )
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_undo_collect_after_a_purge_took_the_row_is_409_not_404(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
):
    released_at = await _collect(editor_client, test_incident.id, material_on_site.id)
    # The training-only material purge removes the assignment history; the audit row stays.
    await db_session.delete(material_on_site)
    await db_session.commit()

    assert await _undo(editor_client, test_incident.id, material_on_site.id, released_at) == 409
    # A row that never was collected stays a 404.
    assert await _undo(editor_client, test_incident.id, uuid4(), released_at) == 404


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("change", ["einsatz_deleted", "rapport_amended"])
async def test_undo_collect_refuses_a_row_the_restliste_would_hide(
    change: str,
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_incident: Incident,
    material_on_site: IncidentAssignment,
):
    released_at = await _collect(editor_client, test_incident.id, material_on_site.id)
    if change == "einsatz_deleted":
        test_incident.deleted_at = datetime.now(UTC)
    else:
        report = await db_session.scalar(
            select(SchadenplatzReport).where(SchadenplatzReport.incident_id == test_incident.id)
        )
        assert report is not None
        report.materials_json = [{**report.materials_json[0], "left_on_site": False}]
    await db_session.commit()

    response = await editor_client.delete(
        f"/api/incidents/{test_incident.id}/material-collected/{material_on_site.id}",
        params={"released_at": released_at},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Das Material steht nicht mehr auf der Restliste."
    await db_session.refresh(material_on_site)
    assert material_on_site.unassigned_at is not None


# ============================================
# Get Assignments Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_assignments_empty(editor_client: AsyncClient, test_incident: Incident):
    """Test getting assignments when none exist."""
    response = await editor_client.get(f"/api/incidents/{test_incident.id}/assignments")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_assignments_with_data(
    editor_client: AsyncClient, test_incident: Incident, existing_assignment: IncidentAssignment
):
    """Test getting assignments when some exist."""
    response = await editor_client.get(f"/api/incidents/{test_incident.id}/assignments")
    assert response.status_code == 200
    assignments = response.json()
    assert len(assignments) == 1
    assert assignments[0]["id"] == str(existing_assignment.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_assignments_viewer_can_read(
    viewer_client: AsyncClient, test_incident: Incident, existing_assignment: IncidentAssignment
):
    """Test that viewers can read assignments."""
    response = await viewer_client.get(f"/api/incidents/{test_incident.id}/assignments")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_assignments_requires_auth(client: AsyncClient, test_incident: Incident):
    """Test that getting assignments requires authentication."""
    response = await client.get(f"/api/incidents/{test_incident.id}/assignments")
    assert response.status_code == 401


# ============================================
# Get Assignments By Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_assignments_by_event(
    editor_client: AsyncClient, test_event: Event, test_incident: Incident, existing_assignment: IncidentAssignment
):
    """Test getting all assignments for an event."""
    response = await editor_client.get(f"/api/assignments/by-event/{test_event.id}")
    assert response.status_code == 200
    data = response.json()
    assert str(test_incident.id) in data
    assert len(data[str(test_incident.id)]) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_assignments_by_event_empty(editor_client: AsyncClient, test_event: Event, test_incident: Incident):
    """Test getting assignments by event when none exist."""
    response = await editor_client.get(f"/api/assignments/by-event/{test_event.id}")
    assert response.status_code == 200
    # Should return empty dict or dict with empty lists


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_assignments_by_event_viewer_can_read(
    viewer_client: AsyncClient, test_event: Event, test_incident: Incident, existing_assignment: IncidentAssignment
):
    """Test that viewers can read assignments by event."""
    response = await viewer_client.get(f"/api/assignments/by-event/{test_event.id}")
    assert response.status_code == 200


# ============================================
# Multiple Assignments Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_multiple_resources(
    editor_client: AsyncClient,
    test_incident: Incident,
    test_personnel: Personnel,
    test_vehicle: Vehicle,
    test_material: Material,
):
    """Test assigning multiple different resources to same incident."""
    # Assign personnel
    response = await editor_client.post(
        f"/api/incidents/{test_incident.id}/assign",
        json={"resource_type": "personnel", "resource_id": str(test_personnel.id)},
    )
    assert response.status_code == 200

    # Assign vehicle
    response = await editor_client.post(
        f"/api/incidents/{test_incident.id}/assign",
        json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
    )
    assert response.status_code == 200

    # Assign material
    response = await editor_client.post(
        f"/api/incidents/{test_incident.id}/assign",
        json={"resource_type": "material", "resource_id": str(test_material.id)},
    )
    assert response.status_code == 200

    # Verify all assignments
    response = await editor_client.get(f"/api/incidents/{test_incident.id}/assignments")
    assert response.status_code == 200
    assignments = response.json()
    assert len(assignments) == 3
    resource_types = {a["resource_type"] for a in assignments}
    assert resource_types == {"personnel", "vehicle", "material"}
