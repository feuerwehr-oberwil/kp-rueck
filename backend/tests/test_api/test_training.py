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
async def test_generate_emergencies_success_in_demo_mode(
    editor_client: AsyncClient, training_event: Event, test_templates, test_locations, monkeypatch
):
    """Test successful emergency generation in the public demo."""
    monkeypatch.setattr("app.api.training.settings.demo_mode", True)
    with patch("app.api.training.generate_training_emergency", new_callable=AsyncMock) as mock_gen:
        # Create a mock incident
        mock_incident = Incident(
            id=uuid4(),
            event_id=training_event.id,
            title="Generated Emergency",
            type="brandbekaempfung",
            status="incoming",
            priority="medium",
            location_address="Test Street",
            nachbarhilfe=False,
            am_warten=False,
            zu_fuss=False,
            # Unflushed mock instances skip column defaults - set the NOT NULL
            # fields IncidentResponse requires explicitly.
            position=0,
            group_position=0,
            source="operator",
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
            status="incoming",
            priority="high",
            location_address="Test Street",
            nachbarhilfe=False,
            am_warten=False,
            zu_fuss=False,
            # Unflushed mock instances skip column defaults - set the NOT NULL
            # fields IncidentResponse requires explicitly.
            position=0,
            group_position=0,
            source="operator",
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
                status="incoming",
                priority="medium",
                location_address=f"Street {i}",
                nachbarhilfe=False,
                am_warten=False,
                zu_fuss=False,
                # Unflushed mock instances skip column defaults - set the NOT NULL
                # fields IncidentResponse requires explicitly.
                position=0,
                group_position=0,
                source="operator",
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


# ============================================
# Simulated Divera Intake Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_divera_creates_training_pool_entry(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    training_event: Event,
    test_templates,
    test_locations,
):
    """The inject lands in the Divera pool as a training-marked entry."""
    with patch("app.api.training.broadcast_emergency_received", new_callable=AsyncMock) as mock_bc:
        response = await editor_client.post(
            f"/api/training/events/{training_event.id}/simulate/divera",
            json={"category": "normal"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["is_training"] is True
    assert data["divera_id"] < 0
    assert data["attached_to_event_id"] is None
    assert data["title"]
    mock_bc.assert_called_once()

    # Nothing on the board — the trainee has to attach it via the pool.
    from sqlalchemy import func, select

    incident_count = (
        await db_session.execute(
            select(func.count()).select_from(Incident).where(Incident.event_id == training_event.id)
        )
    ).scalar_one()
    assert incident_count == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_divera_live_event_forbidden(
    editor_client: AsyncClient, live_event: Event, test_templates, test_locations
):
    """Simulated Divera alarms only exist for training events."""
    response = await editor_client.post(f"/api/training/events/{live_event.id}/simulate/divera", json={})
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_divera_invalid_category(editor_client: AsyncClient, training_event: Event):
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/divera",
        json={"category": "apocalyptic"},
    )
    assert response.status_code == 400


# ============================================
# Escalation Inject Tests
# ============================================


@pytest_asyncio.fixture
async def active_incident(db_session: AsyncSession, training_event: Event) -> Incident:
    """An incident being worked (status einsatz) in the training event."""
    incident = Incident(
        id=uuid4(),
        event_id=training_event.id,
        title="Wassereinbruch Keller",
        type="elementarereignis",
        priority="low",
        status="active",
        location_address="Hauptstrasse 1, 4104 Oberwil",
        description="Ca. 20cm Wasser im Keller.",
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_escalation_bumps_priority_and_notifies(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, active_incident: Incident
):
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/escalate/{active_incident.id}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["priority"] == "high"
    assert "Lagemeldung Feld" in data["description"]

    from sqlalchemy import select

    from app.models import Notification

    notification = (
        (await db_session.execute(select(Notification).where(Notification.incident_id == active_incident.id)))
        .scalars()
        .first()
    )
    assert notification is not None
    assert notification.severity == "critical"
    assert "Lage verschärft" in notification.message


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_escalation_rejects_completed_incident(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, active_incident: Incident
):
    active_incident.status = "complete"
    active_incident.completed_at = datetime.now(UTC)
    await db_session.commit()

    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/escalate/{active_incident.id}"
    )
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_reinforcement_creates_notification(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, active_incident: Incident
):
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/reinforcement/{active_incident.id}"
    )
    assert response.status_code == 200
    message = response.json()["message"]
    assert "Verstärkung" in message

    from sqlalchemy import select

    from app.models import Notification

    notification = (
        (await db_session.execute(select(Notification).where(Notification.incident_id == active_incident.id)))
        .scalars()
        .first()
    )
    assert notification is not None
    assert notification.severity == "warning"


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_vehicle_breakdown(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, active_incident: Incident
):
    """Breakdown makes an assigned vehicle unavailable and keeps the assignment."""
    from app.models import IncidentAssignment, Vehicle

    vehicle = Vehicle(id=uuid4(), name="TLF 1", type="TLF", status="available", display_order=1)
    db_session.add(vehicle)
    await db_session.flush()
    db_session.add(
        IncidentAssignment(
            id=uuid4(),
            incident_id=active_incident.id,
            resource_type="vehicle",
            resource_id=vehicle.id,
        )
    )
    await db_session.commit()

    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/vehicle-breakdown/{active_incident.id}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["vehicle_name"] == "TLF 1"

    await db_session.refresh(vehicle)
    assert vehicle.status == "unavailable"

    # Assignment deliberately stays — cleaning up is the trainee's job.
    from sqlalchemy import select

    assignment = (
        (
            await db_session.execute(
                select(IncidentAssignment).where(IncidentAssignment.incident_id == active_incident.id)
            )
        )
        .scalars()
        .first()
    )
    assert assignment.unassigned_at is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_vehicle_breakdown_without_vehicle_conflicts(
    editor_client: AsyncClient, training_event: Event, active_incident: Incident
):
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/vehicle-breakdown/{active_incident.id}"
    )
    assert response.status_code == 409


# ============================================
# Trickled Check-in Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_checkin_trickle_schedules(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event
):
    """Trickle mode returns the schedule instead of checking in immediately."""
    from app.api.training import _trickle_tasks
    from app.models import Personnel

    for i in range(3):
        db_session.add(Personnel(id=uuid4(), name=f"AdF Trickle {i}", status="available"))
    await db_session.commit()

    try:
        response = await editor_client.post(
            f"/api/training/events/{training_event.id}/simulate/checkin",
            json={"count": 3, "over_minutes": 5},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["checked_in"] == []
        assert len(data["scheduled"]) == 3
        assert data["trickle_minutes"] == 5

        # A second trickle while one is running is refused.
        response = await editor_client.post(
            f"/api/training/events/{training_event.id}/simulate/checkin",
            json={"count": 3, "over_minutes": 5},
        )
        assert response.status_code == 409
    finally:
        task = _trickle_tasks.pop(training_event.id, None)
        if task:
            task.cancel()


# ============================================
# Simulated Reko Report Photos
# ============================================


@pytest_asyncio.fixture
async def reko_incident(db_session: AsyncSession, training_event: Event) -> Incident:
    """An incident awaiting Reko (status reko) in the training event."""
    incident = Incident(
        id=uuid4(),
        event_id=training_event.id,
        title="Brand Dachstock",
        type="brandbekaempfung",
        priority="high",
        status="reko",
        location_address="Hauptstrasse 1, 4104 Oberwil",
        description="Starke Rauchentwicklung aus dem Dachstock.",
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest.fixture
def stub_photo_pool(tmp_path, monkeypatch):
    """Stubbed offline pool + temp photo storage; forces 2 photos per report."""
    import io

    from PIL import Image

    from app.services import training_photos
    from app.services.photo_storage import photo_storage

    pool = tmp_path / "pool" / "brandbekaempfung"
    pool.mkdir(parents=True)
    for i in range(1, 4):
        img = Image.new("RGB", (64, 48), (200, 30, 30))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        (pool / f"{i:02d}.jpg").write_bytes(buf.getvalue())

    photos_dir = tmp_path / "photos"
    monkeypatch.setattr(training_photos, "POOL_DIR", tmp_path / "pool")
    monkeypatch.setattr(training_photos, "_PHOTO_COUNT_WEIGHTS", (0, 0, 1))
    monkeypatch.setattr(photo_storage, "photos_dir", photos_dir)
    return photos_dir


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_reko_attaches_pool_photos(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    training_event: Event,
    reko_incident: Incident,
    stub_photo_pool,
):
    """Simulated reko reports carry pool photos shaped exactly like real uploads."""
    import re

    response = await editor_client.post(f"/api/training/events/{training_event.id}/simulate/reko/{reko_incident.id}")
    assert response.status_code == 200
    data = response.json()

    photos = data["photos_json"]
    assert len(photos) == 2
    for filename in photos:
        # photos_json entries are plain UUID.jpg strings, same as real uploads
        assert re.match(r"^[0-9a-f-]{36}\.jpg$", filename)
        # and the files exist in the incident's photo directory on disk
        assert (stub_photo_pool / str(reko_incident.id) / filename).exists()

    # The stored report matches the response
    from sqlalchemy import select

    from app.models import RekoReport

    report = (
        (await db_session.execute(select(RekoReport).where(RekoReport.incident_id == reko_incident.id)))
        .scalars()
        .first()
    )
    assert report is not None
    assert report.photos_json == photos


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_reko_without_pool_still_succeeds(
    editor_client: AsyncClient,
    training_event: Event,
    reko_incident: Incident,
    tmp_path,
    monkeypatch,
):
    """A brigade that stripped the bundled pool gets reports without photos."""
    from app.services import training_photos
    from app.services.photo_storage import photo_storage

    monkeypatch.setattr(training_photos, "POOL_DIR", tmp_path / "missing-pool")
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path / "photos")

    response = await editor_client.post(f"/api/training/events/{training_event.id}/simulate/reko/{reko_incident.id}")
    assert response.status_code == 200
    assert response.json()["photos_json"] == []


# ============================================
# Schadenplatz-Rapport injects (plan 25, §16)
# ============================================


@pytest_asyncio.fixture
async def rapport_incident(db_session: AsyncSession, training_event: Event) -> Incident:
    """A finished Schadenplatz with a crew, a leader of record and material.

    Completed on purpose: that is the state the bulk inject picks up, and the
    state in which `IncidentAssignment.is_leader` has been cleared from every
    row — so the leader can only come from `Incident.leader_personnel_id`
    through the resolver (decision 29).
    """
    from app.models import IncidentAssignment, Material, Personnel

    leader = Personnel(id=uuid4(), name="Muster Hans", role="Offizier", status="available")
    helper = Personnel(id=uuid4(), name="Muster Anna", role="Soldat", status="available")
    pump = Material(id=uuid4(), name="Tauchpumpe Gr.", type="Tauchpumpen", location="MoWa", status="available")
    binder = Material(
        id=uuid4(),
        name="Ölbindemittel",
        type="Ölwehr",
        location="Magazin",
        status="available",
        consumable=True,
    )
    db_session.add_all([leader, helper, pump, binder])
    await db_session.flush()

    incident = Incident(
        id=uuid4(),
        event_id=training_event.id,
        title="Wasser im Keller MFH",
        type="elementarereignis",
        priority="medium",
        status="complete",
        completed_at=datetime.now(UTC),
        location_address="Mühlemattstrasse 12, 4104 Oberwil",
        description="Ca. 20 cm Wasser im Keller.",
        leader_personnel_id=leader.id,
    )
    db_session.add(incident)
    await db_session.flush()
    for resource_type, resource in (
        ("personnel", leader),
        ("personnel", helper),
        ("material", pump),
        ("material", binder),
    ):
        db_session.add(
            IncidentAssignment(
                id=uuid4(),
                incident_id=incident.id,
                resource_type=resource_type,
                resource_id=resource.id,
            )
        )
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("path", ["simulate/rapport/{incident}", "simulate/field-message/{incident}"])
async def test_rapport_injects_only_touch_training_events(
    editor_client: AsyncClient, db_session: AsyncSession, live_event: Event, path: str
):
    """A live Ereignis is not a rehearsal — every inject refuses it."""
    incident = Incident(
        id=uuid4(),
        event_id=live_event.id,
        title="Wasser im Keller",
        type="elementarereignis",
        priority="low",
        status="complete",
        completed_at=datetime.now(UTC),
    )
    db_session.add(incident)
    await db_session.commit()

    url = f"/api/training/events/{live_event.id}/{path.format(incident=incident.id)}"
    response = await editor_client.post(url)
    assert response.status_code == 400

    bulk = await editor_client.post(f"/api/training/events/{live_event.id}/simulate/rapport")
    assert bulk.status_code == 400

    field_complete = await editor_client.post(
        f"/api/training/events/{live_event.id}/simulate/field-complete/{incident.id}"
    )
    assert field_complete.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_rapport_files_a_real_rapport(
    editor_client: AsyncClient, training_event: Event, rapport_incident: Incident
):
    """The inject goes through the shared upsert, so the result IS a rapport.

    Asserted through the KP-parity GET rather than by re-checking columns: if it
    reads back as a submitted rapport there, it obeys exactly the rules a
    crew-filed one obeys.
    """
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/rapport/{rapport_incident.id}"
    )
    assert response.status_code == 200
    inject = response.json()
    assert inject["incident_id"] == str(rapport_incident.id)
    # 70/30 between the EL and another assigned person — both are Muster names,
    # and neither is the editor: a simulated rapport comes from the field.
    assert inject["filed_by"] in {"Muster Hans", "Muster Anna"}

    rapport = (await editor_client.get(f"/api/incidents/{rapport_incident.id}/rapport")).json()
    assert rapport["exists"] is True
    assert rapport["is_draft"] is False
    assert rapport["submitted_at"] is not None
    # Frozen at submit (decision 6) — a later board edit cannot change it.
    assert rapport["cost_snapshot_json"]
    assert rapport["kurzbericht"]
    assert len(rapport["materials"]) == 2
    assert rapport["created_by_name"] in {"Muster Hans", "Muster Anna"}
    assert rapport["created_in_kp"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_rapport_never_leaves_a_consumable_on_site(
    editor_client: AsyncClient, training_event: Event, rapport_incident: Incident
):
    """Decision 26: a consumable that was used is gone. Rate 0 %, always."""
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/rapport/{rapport_incident.id}"
    )
    assert response.status_code == 200

    rapport = (await editor_client.get(f"/api/incidents/{rapport_incident.id}/rapport")).json()
    consumables = [row for row in rapport["materials"] if row["consumable"]]
    assert consumables, "fixture must contain a consumable for this to mean anything"
    assert all(row["left_on_site"] is False for row in consumables)


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_rapport_leaves_the_kfz_block_empty_on_a_non_vehicle_type(
    editor_client: AsyncClient, training_event: Event, rapport_incident: Incident
):
    """`elementarereignis` is 0 % — a Kennzeichen on a flooded cellar is noise."""
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/rapport/{rapport_incident.id}"
    )
    assert response.status_code == 200

    rapport = (await editor_client.get(f"/api/incidents/{rapport_incident.id}/rapport")).json()
    note = rapport["owner_note"] or ""
    assert not any(line.startswith("BL ") for line in note.splitlines())


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_bulk_rapport_covers_80_percent_and_leaves_gaps(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event
):
    """80 %, rounded down: five completed Schadenplätze leave one for the Restliste."""
    incidents = []
    for index in range(5):
        incident = Incident(
            id=uuid4(),
            event_id=training_event.id,
            title=f"Wasser im Keller {index}",
            type="elementarereignis",
            priority="low",
            status="complete",
            completed_at=datetime.now(UTC),
            location_address=f"Musterstrasse {index}, 4104 Oberwil",
        )
        db_session.add(incident)
        incidents.append(incident)
    await db_session.commit()

    response = await editor_client.post(f"/api/training/events/{training_event.id}/simulate/rapport")
    assert response.status_code == 200
    data = response.json()
    assert data["candidates"] == 5
    assert data["covered"] == 4
    assert data["skipped"] == 1
    assert len(data["rapports"]) == 4

    # The gap is real, not just a counter: exactly one incident is still without
    # a rapport, which is what the Restliste shows at 02:00.
    from sqlalchemy import select

    from app.models import SchadenplatzReport

    filed = (
        (await db_session.execute(select(SchadenplatzReport.incident_id).where(SchadenplatzReport.is_draft.is_(False))))
        .scalars()
        .all()
    )
    assert len({i.id for i in incidents} - set(filed)) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_bulk_rapport_skips_incidents_that_already_have_one(
    editor_client: AsyncClient, training_event: Event, rapport_incident: Incident
):
    """A filed rapport is never overwritten — the bulk fills gaps, nothing else."""
    first = await editor_client.post(f"/api/training/events/{training_event.id}/simulate/rapport/{rapport_incident.id}")
    assert first.status_code == 200

    response = await editor_client.post(f"/api/training/events/{training_event.id}/simulate/rapport")
    assert response.status_code == 200
    assert response.json()["candidates"] == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_field_complete_stamps_provenance_and_rings_the_bell(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, active_incident: Incident
):
    """The direct attribute write is gone: it now goes through the parity endpoint.

    Which means an exercise finally rehearses the bell — and the audit entry
    that carries the operator, since a KP write leaves the personnel FK NULL
    (decision 28).
    """
    from sqlalchemy import select

    from app.models import AuditLog, Notification

    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/field-complete/{active_incident.id}",
        json={"pickup_needed": False},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["field_complete_reported_at"] is not None
    # Informational only — closing stays the operator's board action.
    assert data["status"] == "active"

    notification = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.incident_id == active_incident.id,
                    Notification.type == "field_complete",
                )
            )
        )
        .scalars()
        .first()
    )
    assert notification is not None

    entry = (
        (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.resource_id == active_incident.id,
                    AuditLog.action_type == "field_complete",
                )
            )
        )
        .scalars()
        .first()
    )
    assert entry is not None
    assert entry.user_id is not None
    await db_session.refresh(active_incident)
    assert active_incident.field_complete_reported_by is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_field_complete_asks_the_abholung_follow_up(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, active_incident: Incident
):
    """ "Kommt ihr selbst zurück?" — preselected by the situation, overridable."""
    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/field-complete/{active_incident.id}",
        json={"pickup_needed": True, "pickup_note": "Trupp wartet an der Hauptstrasse"},
    )
    assert response.status_code == 200
    assert response.json()["pickup_needed"] is True

    await db_session.refresh(active_incident)
    assert active_incident.pickup_note == "Trupp wartet an der Hauptstrasse"
    assert active_incident.pickup_requested_at is not None

    # And the crew tapping "abgeholt" clears it again.
    cleared = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/field-complete/{active_incident.id}",
        json={"pickup_needed": False},
    )
    assert cleared.status_code == 200
    await db_session.refresh(active_incident)
    assert active_incident.pickup_needed is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_simulate_field_message_reaches_the_kp(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, active_incident: Incident
):
    """The generic channel: a chip or a sentence, as a `field_message` bell entry."""
    from sqlalchemy import select

    from app.models import Notification

    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/field-message/{active_incident.id}"
    )
    assert response.status_code == 200
    assert response.json()["message"]

    notification = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.incident_id == active_incident.id,
                    Notification.type == "field_message",
                )
            )
        )
        .scalars()
        .first()
    )
    assert notification is not None
    assert "Meldung vom Feld" in notification.message
