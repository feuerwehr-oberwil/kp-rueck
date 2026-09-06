"""Tests for Reko API endpoints.

Tests cover:
- Reko form access with token validation
- Report creation and updates (draft vs submitted)
- Report retrieval by ID and by incident
- Token generation for form links
- Photo upload and deletion
- Photo serving with authentication
- Permission enforcement for authenticated endpoints
"""

import io
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import jwt
import pytest
import pytest_asyncio
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Event, Incident, IncidentAssignment, Personnel, RekoReport, User
from app.services.photo_storage import photo_storage
from app.services.tokens import generate_feld_token, generate_form_token
from tests.conftest import TEST_PASSWORD

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Reko Test Event",
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
        title="Reko Test Incident",
        type="brandbekaempfung",
        priority="medium",
        status="reko",
        location_address="Teststrasse 1",
        description="Test incident for reko",
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
        role="Zugführer",
        status="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
def valid_token(test_incident: Incident) -> str:
    """Generate a valid token for the test incident."""
    return generate_form_token(str(test_incident.id), "reko")


@pytest_asyncio.fixture
async def test_reko_report(db_session: AsyncSession, test_incident: Incident) -> RekoReport:
    """Create a test reko report."""
    token = generate_form_token(str(test_incident.id), "reko")
    report = RekoReport(
        id=uuid4(),
        incident_id=test_incident.id,
        token=token,
        is_relevant=True,
        summary_text="Test report summary",
        additional_notes="Additional test notes",
        is_draft=True,
    )
    db_session.add(report)
    await db_session.commit()
    await db_session.refresh(report)
    return report


# ============================================
# Get Form Tests (Token-based, no auth)
# ============================================


@pytest.mark.asyncio
async def test_old_form_link_is_reset_without_losing_board_report(
    client, db_session, test_incident, test_reko_report, test_editor
):
    payload = jwt.decode(test_reko_report.token, get_settings().secret_key, algorithms=["HS256"])
    del payload["form_version"]
    old = jwt.encode(payload, get_settings().secret_key, algorithm="HS256")
    test_reko_report.token = old
    test_reko_report.photos_json = ["historical-photo.jpg"]
    await db_session.commit()
    assert (await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={old}")).status_code == 400
    assert (await client.get(f"/api/reko/{test_reko_report.id}?token={old}")).status_code == 401
    assert (
        await client.patch(
            f"/api/reko/{test_reko_report.id}", json={"summary_text": "overwrite"}, headers={"X-Reko-Token": old}
        )
    ).status_code == 401
    assert (
        await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
    ).status_code == 200
    board = await client.get(f"/api/reko/{test_reko_report.id}")
    assert board.status_code == 200
    assert board.json()["summary_text"] == "Test report summary"
    assert board.json()["photos_json"] == ["historical-photo.jpg"]
    await db_session.refresh(test_reko_report)
    assert test_reko_report.token == old
    current = generate_form_token(str(test_incident.id))
    assert (await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={current}")).status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_reko_form_creates_new_report(client: AsyncClient, test_incident: Incident, valid_token: str):
    """Test that getting form creates a new report if none exists."""
    response = await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={valid_token}")
    assert response.status_code == 200
    data = response.json()
    assert data["incident_id"] == str(test_incident.id)
    assert data["is_draft"] is True
    assert "id" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_reko_form_returns_existing_report(
    client: AsyncClient, test_incident: Incident, test_reko_report: RekoReport
):
    """Test that getting form returns existing report."""
    response = await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={test_reko_report.token}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_reko_report.id)
    assert data["summary_text"] == test_reko_report.summary_text


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_reko_form_includes_incident_details(client: AsyncClient, test_incident: Incident, valid_token: str):
    """Test that form response includes incident details."""
    response = await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={valid_token}")
    assert response.status_code == 200
    data = response.json()
    assert data["incident_title"] == test_incident.title
    assert data["incident_location"] == test_incident.location_address
    assert data["incident_type"] == test_incident.type


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_reko_form_with_personnel(
    client: AsyncClient, test_incident: Incident, test_personnel: Personnel, valid_token: str
):
    """Test getting form with personnel ID."""
    response = await client.get(
        f"/api/reko/form?incident_id={test_incident.id}&token={valid_token}&personnel_id={test_personnel.id}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["submitted_by_personnel_id"] == str(test_personnel.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_reko_form_invalid_token(client: AsyncClient, test_incident: Incident):
    """Test that invalid token is rejected."""
    response = await client.get(f"/api/reko/form?incident_id={test_incident.id}&token=invalid_token")
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_reko_form_missing_incident_id(client: AsyncClient, valid_token: str):
    """Test that missing incident_id returns error."""
    response = await client.get(f"/api/reko/form?token={valid_token}")
    assert response.status_code == 422


# ============================================
# Submit Report Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_submit_reko_report_draft(client: AsyncClient, test_incident: Incident, valid_token: str):
    """Test saving report as draft."""
    report_data = {
        "incident_id": str(test_incident.id),
        "token": valid_token,
        "is_relevant": True,
        "summary_text": "Initial reconnaissance notes",
        "is_draft": True,
    }
    response = await client.post("/api/reko/?submit=false", json=report_data)
    assert response.status_code == 200
    data = response.json()
    assert data["is_draft"] is True
    assert data["summary_text"] == "Initial reconnaissance notes"


@pytest.mark.asyncio
@pytest.mark.api
async def test_submit_reko_report_final(client: AsyncClient, test_incident: Incident, valid_token: str):
    """Test submitting report as final.

    Note: This test mocks the notification creation to avoid DB constraint issues
    since the notification type 'reko_submitted' may not be in the allowed types.
    """
    report_data = {
        "incident_id": str(test_incident.id),
        "token": valid_token,
        "is_relevant": True,
        "summary_text": "Full reconnaissance complete",
        "additional_notes": "Access via side entrance",
        "power_supply": "available",
    }

    # Mock the notification creation to avoid DB constraint issues
    with patch("app.services.notification_service.create_reko_notification", new_callable=AsyncMock):
        response = await client.post("/api/reko/?submit=true", json=report_data)
        assert response.status_code == 200
        data = response.json()
        assert data["is_draft"] is False
        assert data["submitted_at"] is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_submit_reko_report_invalid_token(client: AsyncClient, test_incident: Incident):
    """Test that invalid token is rejected on submit."""
    report_data = {
        "incident_id": str(test_incident.id),
        "token": "invalid_token",
        "is_relevant": True,
    }
    response = await client.post("/api/reko/", json=report_data)
    assert response.status_code == 400
    assert "invalid token" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_submit_reko_report_updates_existing(
    client: AsyncClient, test_incident: Incident, test_reko_report: RekoReport
):
    """Test that submitting updates existing report."""
    report_data = {
        "incident_id": str(test_incident.id),
        "token": test_reko_report.token,
        "is_relevant": False,
        "summary_text": "Updated summary after second visit",
    }

    with patch("app.services.notification_service.create_reko_notification", new_callable=AsyncMock):
        response = await client.post("/api/reko/?submit=true", json=report_data)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(test_reko_report.id)
        assert data["summary_text"] == "Updated summary after second visit"
        assert data["is_relevant"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_draft_save_cannot_unsubmit_report(client: AsyncClient, test_incident: Incident, valid_token: str):
    """Regression: a stray draft-save (auto-save with is_draft=true in the body)
    landing after submission must not flip a submitted report back to draft."""
    report_data = {
        "incident_id": str(test_incident.id),
        "token": valid_token,
        "is_relevant": True,
        "summary_text": "Full reconnaissance complete",
    }
    with patch("app.services.notification_service.create_reko_notification", new_callable=AsyncMock):
        response = await client.post("/api/reko/?submit=true", json=report_data)
        assert response.status_code == 200
        assert response.json()["is_draft"] is False

    # Simulate a late auto-save that was still in flight when the user submitted
    stray_draft = {**report_data, "summary_text": "Late auto-save", "is_draft": True}
    response = await client.post("/api/reko/?submit=false", json=stray_draft)
    assert response.status_code == 200
    data = response.json()
    assert data["is_draft"] is False  # must stay submitted
    assert data["summary_text"] == "Late auto-save"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_with_is_draft_true_cannot_unsubmit(editor_client: AsyncClient, test_reko_report: RekoReport):
    """Regression: PATCH with is_draft=true in the body must not un-submit."""
    response = await editor_client.patch(f"/api/reko/{test_reko_report.id}?submit=true", json={})
    assert response.status_code == 200
    assert response.json()["is_draft"] is False

    response = await editor_client.patch(
        f"/api/reko/{test_reko_report.id}",
        json={"summary_text": "Nachtrag", "is_draft": True},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_draft"] is False
    assert data["summary_text"] == "Nachtrag"


# ============================================
# Get Report Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_report_by_id(editor_client: AsyncClient, test_reko_report: RekoReport):
    """Test getting report by ID as a logged-in user."""
    response = await editor_client.get(f"/api/reko/{test_reko_report.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_reko_report.id)
    assert data["summary_text"] == test_reko_report.summary_text


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_report_by_id_with_form_token(client: AsyncClient, test_reko_report: RekoReport):
    """The incident's form token grants read access without a login (field crew)."""
    response = await client.get(f"/api/reko/{test_reko_report.id}?token={test_reko_report.token}")
    assert response.status_code == 200
    assert response.json()["id"] == str(test_reko_report.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_report_by_id_unauthenticated(client: AsyncClient, test_reko_report: RekoReport):
    """Regression (audit H1): report reads were fully open."""
    response = await client.get(f"/api/reko/{test_reko_report.id}")
    assert response.status_code == 401

    # A token for a DIFFERENT incident must not work either
    wrong_token = generate_form_token(str(uuid4()), "reko")
    response = await client.get(f"/api/reko/{test_reko_report.id}?token={wrong_token}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_report_not_found(client: AsyncClient):
    """Test getting non-existent report."""
    response = await client.get(f"/api/reko/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_incident_reports(editor_client: AsyncClient, test_incident: Incident, test_reko_report: RekoReport):
    """Test getting all reports for an incident."""
    response = await editor_client.get(f"/api/reko/incident/{test_incident.id}/reports")
    assert response.status_code == 200
    reports = response.json()
    assert len(reports) == 1
    assert reports[0]["id"] == str(test_reko_report.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_incident_reports_empty(editor_client: AsyncClient, test_incident: Incident):
    """Test getting reports when none exist."""
    response = await editor_client.get(f"/api/reko/incident/{test_incident.id}/reports")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_incident_reports_unauthenticated(client: AsyncClient, test_incident: Incident):
    """Regression (audit H1): the incident reports list was fully open."""
    response = await client.get(f"/api/reko/incident/{test_incident.id}/reports")
    assert response.status_code == 401


# ============================================
# Update Report Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_report(editor_client: AsyncClient, test_reko_report: RekoReport):
    """Test updating existing report via PATCH as a logged-in user."""
    update_data = {
        "summary_text": "Updated summary via patch",
        "additional_notes": "New hazard identified",
    }
    response = await editor_client.patch(f"/api/reko/{test_reko_report.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["summary_text"] == "Updated summary via patch"
    assert data["additional_notes"] == "New hazard identified"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_report_with_form_token(client: AsyncClient, test_reko_report: RekoReport):
    """The incident's form token grants edit access without a login (field crew)."""
    response = await client.patch(
        f"/api/reko/{test_reko_report.id}",
        json={"summary_text": "Updated by field crew"},
        headers={"X-Reko-Token": test_reko_report.token},
    )
    assert response.status_code == 200
    assert response.json()["summary_text"] == "Updated by field crew"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_report_unauthenticated(
    client: AsyncClient, db_session: AsyncSession, test_reko_report: RekoReport
):
    """Regression (audit H1): recon reports were rewritable by anyone."""
    response = await client.patch(f"/api/reko/{test_reko_report.id}", json={"summary_text": "tampered"})
    assert response.status_code == 401

    # Wrong-incident token must not work either
    wrong_token = generate_form_token(str(uuid4()), "reko")
    response = await client.patch(
        f"/api/reko/{test_reko_report.id}",
        json={"summary_text": "tampered"},
        headers={"X-Reko-Token": wrong_token},
    )
    assert response.status_code == 401

    await db_session.refresh(test_reko_report)
    assert test_reko_report.summary_text == "Test report summary"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_report_not_found(client: AsyncClient):
    """Test updating non-existent report."""
    response = await client.patch(f"/api/reko/{uuid4()}", json={"summary_text": "test"})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_report_and_submit(editor_client: AsyncClient, test_reko_report: RekoReport):
    """Test updating report and marking as submitted."""
    update_data = {
        "summary_text": "Final update before submission",
    }
    response = await editor_client.patch(f"/api/reko/{test_reko_report.id}?submit=true", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["is_draft"] is False


# ============================================
# Generate Link Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_reko_link(editor_client: AsyncClient, test_incident: Incident):
    """Test generating reko form link as an editor."""
    response = await editor_client.post(f"/api/reko/generate-link?incident_id={test_incident.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["incident_id"] == str(test_incident.id)
    assert "token" in data
    assert "link" in data
    assert str(test_incident.id) in data["link"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_reko_link_with_personnel(
    editor_client: AsyncClient, test_incident: Incident, test_personnel: Personnel
):
    """With a person the direct link is a `/feld` deep link on a BOUND token
    (§P2.1): the person lands on the field surface already authenticated, and
    the incident rides along as the deep link. The person never appears in the
    URL as plain text — they are inside the token, where the server checks them.
    """
    from app.services.tokens import validate_feld_token

    response = await editor_client.post(
        f"/api/reko/generate-link?incident_id={test_incident.id}&personnel_id={test_personnel.id}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["personnel_id"] == str(test_personnel.id)
    assert data["link"].startswith("/feld?token=")
    assert f"incident_id={test_incident.id}" in data["link"]

    claims = validate_feld_token(data["token"])
    assert claims is not None
    assert claims.personnel_id == test_personnel.id
    assert claims.unlocked is True
    assert claims.claim_id is not None
    assert claims.event_id == test_incident.event_id


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_reko_link_unauthenticated(client: AsyncClient, test_incident: Incident):
    """Regression (audit H1): anyone reaching the backend could mint valid
    reko tokens for any incident."""
    response = await client.post(f"/api/reko/generate-link?incident_id={test_incident.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_reko_link_viewer_forbidden(
    client: AsyncClient, db_session: AsyncSession, test_incident: Incident
):
    """Viewers must not mint reko tokens.

    Uses a real logged-in viewer: generate-link resolves the user manually
    (token-or-auth), so the dependency-override viewer_client doesn't apply.
    """
    from app.auth.security import hash_password

    viewer = User(
        id=uuid4(),
        username="reko_viewer",
        password_hash=hash_password("testpassword1234"),
        role="viewer",
    )
    db_session.add(viewer)
    await db_session.commit()

    login = await client.post("/api/auth/login", data={"username": "reko_viewer", "password": "testpassword1234"})
    assert login.status_code == 200

    response = await client.post(f"/api/reko/generate-link?incident_id={test_incident.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_reko_link_is_editor_only(client: AsyncClient, test_incident: Incident):
    """No second door here any more (plan 26, decision 24).

    This route used to accept an event-scoped `/reko-dashboard` token so field
    phones without a login could mint a form link. That page is gone, and the
    field surface mints its own through `POST /api/feld/incidents/{id}/reko-link`
    — which runs the `/feld` two-step first, so neither token type had to learn
    about the other. What is left is the board's own route, and it wants a
    session.
    """
    response = await client.post(f"/api/reko/generate-link?incident_id={test_incident.id}")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
@pytest.mark.api
async def test_upload_photo_success(client: AsyncClient, test_incident: Incident, valid_token: str):
    """Test uploading photo to reko report."""
    # Create test file content
    file_content = b"fake image content"

    # Mock photo storage
    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.save_photo = AsyncMock(return_value="test-photo-123.jpg")

        response = await client.post(
            f"/api/reko/{test_incident.id}/photos",
            files={"file": ("test.jpg", file_content, "image/jpeg")},
            headers={"X-Reko-Token": valid_token},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "test-photo-123.jpg"


@pytest.mark.asyncio
@pytest.mark.api
async def test_upload_photo_invalid_token(client: AsyncClient, test_incident: Incident):
    """Test that photo upload requires valid token."""
    file_content = b"fake image content"

    response = await client.post(
        f"/api/reko/{test_incident.id}/photos",
        files={"file": ("test.jpg", file_content, "image/jpeg")},
        headers={"X-Reko-Token": "invalid_token"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_upload_photo_without_token_or_session(client: AsyncClient, test_incident: Incident):
    """Neither a token nor a session is still refused.

    The header stopped being *required* when the board got its own door (§6.1),
    so the refusal moved from a 422 to the 401 every other Reko route gives.
    """
    file_content = b"fake image content"

    response = await client.post(
        f"/api/reko/{test_incident.id}/photos",
        files={"file": ("test.jpg", file_content, "image/jpeg")},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_editor_uploads_photo_without_token(editor_client: AsyncClient, test_incident: Incident):
    """The WhatsApp case: the operator attaches a picture the crew sent them.

    No token — the session is the credential — and the photo lands on the
    operator's own draft, which is the row the subsequent save submits.
    """
    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.save_photo = AsyncMock(return_value="kp-photo.jpg")

        response = await editor_client.post(
            f"/api/reko/{test_incident.id}/photos",
            files={"file": ("whatsapp.jpg", b"fake image content", "image/jpeg")},
        )

    assert response.status_code == 200
    assert response.json()["filename"] == "kp-photo.jpg"

    listed = await editor_client.get(f"/api/reko/incident/{test_incident.id}/reports")
    assert listed.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_editor_uploads_photo_onto_an_existing_report(
    editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident, valid_token: str
):
    """Amending a crew report: the photo hangs on that report, not on a side draft."""
    report = RekoReport(
        id=uuid4(),
        incident_id=test_incident.id,
        token=valid_token,
        photos_json=["crew.jpg"],
        is_draft=False,
    )
    db_session.add(report)
    await db_session.commit()

    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.save_photo = AsyncMock(return_value="kp-photo.jpg")

        response = await editor_client.post(
            f"/api/reko/{test_incident.id}/photos?report_id={report.id}",
            files={"file": ("whatsapp.jpg", b"fake image content", "image/jpeg")},
        )

    assert response.status_code == 200
    await db_session.refresh(report)
    assert report.photos_json == ["crew.jpg", "kp-photo.jpg"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_editor_cannot_upload_onto_another_incidents_report(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
    test_editor: User,
    valid_token: str,
):
    """A report id from elsewhere must not become a way to write into it."""
    other_incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Other Incident",
        type="brandbekaempfung",
        priority="medium",
        status="reko",
        created_by=test_editor.id,
    )
    db_session.add(other_incident)
    await db_session.commit()

    other = RekoReport(
        id=uuid4(),
        incident_id=other_incident.id,
        token=valid_token,
        is_draft=False,
    )
    db_session.add(other)
    await db_session.commit()

    response = await editor_client.post(
        f"/api/reko/{test_incident.id}/photos?report_id={other.id}",
        files={"file": ("whatsapp.jpg", b"fake image content", "image/jpeg")},
    )
    assert response.status_code == 404


# ============================================
# Photo Delete Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_photo_success(
    client: AsyncClient, db_session: AsyncSession, test_incident: Incident, valid_token: str
):
    """Test deleting photo from reko report."""
    # Create report with photo
    report = RekoReport(
        id=uuid4(),
        incident_id=test_incident.id,
        token=valid_token,
        photos_json=["photo1.jpg", "photo2.jpg"],
        is_draft=True,
    )
    db_session.add(report)
    await db_session.commit()

    # Mock photo storage
    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.delete_photo = MagicMock(return_value=True)

        response = await client.delete(
            f"/api/reko/{test_incident.id}/photos/photo1.jpg",
            headers={"X-Reko-Token": valid_token},
        )
        assert response.status_code == 200
        assert response.json()["success"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_photo_not_found(
    client: AsyncClient, db_session: AsyncSession, test_incident: Incident, valid_token: str
):
    """Test deleting non-existent photo."""
    # Create report without the photo
    report = RekoReport(
        id=uuid4(),
        incident_id=test_incident.id,
        token=valid_token,
        photos_json=["other_photo.jpg"],
        is_draft=True,
    )
    db_session.add(report)
    await db_session.commit()

    response = await client.delete(
        f"/api/reko/{test_incident.id}/photos/nonexistent.jpg",
        headers={"X-Reko-Token": valid_token},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_photo_invalid_token(client: AsyncClient, test_incident: Incident):
    """Test that photo delete requires valid token."""
    response = await client.delete(
        f"/api/reko/{test_incident.id}/photos/photo.jpg",
        headers={"X-Reko-Token": "invalid_token"},
    )
    assert response.status_code == 400


# ============================================
# Photo Serving Tests (Authenticated)
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_serve_photo_requires_auth(client: AsyncClient, test_incident: Incident):
    """Test that serving photos requires authentication."""
    response = await client.get(f"/api/photos/{test_incident.id}/photo.jpg")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_serve_photo_incident_not_found(editor_client: AsyncClient):
    """Test serving photo for non-existent incident."""
    response = await editor_client.get(f"/api/photos/{uuid4()}/photo.jpg")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_serve_photo_file_not_found(editor_client: AsyncClient, test_incident: Incident):
    """Test serving non-existent photo file."""
    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.get_photo_path = MagicMock(return_value=None)

        response = await editor_client.get(f"/api/photos/{test_incident.id}/nonexistent.jpg")
        assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_serve_photo_viewer_can_access(client: AsyncClient, db_session: AsyncSession, test_incident: Incident):
    """A viewer-role session reads photos too — read-only is still logged in.

    Uses a real login: serve_photo resolves the user manually (share-token-or-
    session), so the dependency-override viewer_client doesn't apply.
    """
    from app.auth.security import hash_password

    viewer = User(
        id=uuid4(),
        username="photo_viewer",
        password_hash=hash_password("testpassword1234"),
        role="viewer",
    )
    db_session.add(viewer)
    await db_session.commit()

    login = await client.post("/api/auth/login", data={"username": "photo_viewer", "password": "testpassword1234"})
    assert login.status_code == 200

    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.get_photo_path = MagicMock(return_value=None)

        response = await client.get(f"/api/photos/{test_incident.id}/photo.jpg")
        # Should get 404 (file not found) not 403 (forbidden)
        assert response.status_code == 404


# ============================================
# Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_reko_report_response_structure(client: AsyncClient, test_reko_report: RekoReport):
    """Test that report response contains all expected fields."""
    response = await client.get(f"/api/reko/{test_reko_report.id}?token={test_reko_report.token}")
    assert response.status_code == 200
    data = response.json()

    expected_fields = [
        "id",
        "incident_id",
        "is_relevant",
        "summary_text",
        "additional_notes",
        "power_supply",
        "photos_json",
        "is_draft",
        "submitted_at",
        "updated_at",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


# ============================================
# Workflow Integration Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_complete_reko_workflow(client: AsyncClient, editor_client: AsyncClient, test_incident: Incident):
    """Test complete reko workflow: generate link → get form → save draft → submit final."""
    # Step 1: Generate link (an editor does this from the board)
    link_response = await editor_client.post(f"/api/reko/generate-link?incident_id={test_incident.id}")
    assert link_response.status_code == 200
    token = link_response.json()["token"]

    # Step 2: Get form (creates draft)
    form_response = await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={token}")
    assert form_response.status_code == 200
    assert form_response.json()["is_draft"] is True

    # Step 3: Save draft with initial observations
    # Note: The API updates the report but is_draft is set to False by default in schema
    # The submit=false param prevents notification and keeps submitted_at timing
    draft_data = {
        "incident_id": str(test_incident.id),
        "token": token,
        "is_relevant": True,
        "summary_text": "Initial observation - smoke visible",
        "is_draft": True,  # Explicitly set is_draft
    }
    draft_response = await client.post("/api/reko/?submit=false", json=draft_data)
    assert draft_response.status_code == 200
    # Verify the data was saved
    assert draft_response.json()["summary_text"] == "Initial observation - smoke visible"

    # Step 4: Update and submit final report
    final_data = {
        "incident_id": str(test_incident.id),
        "token": token,
        "is_relevant": True,
        "summary_text": "Full assessment complete - fire contained to kitchen",
        "additional_notes": "Gas line may be affected. Access via side entrance.",
        "power_supply": "available",
    }

    with patch("app.services.notification_service.create_reko_notification", new_callable=AsyncMock):
        submit_response = await client.post("/api/reko/?submit=true", json=final_data)
        assert submit_response.status_code == 200
        data = submit_response.json()
        assert data["is_draft"] is False
        assert data["submitted_at"] is not None
        assert data["summary_text"] == "Full assessment complete - fire contained to kitchen"

    # Step 5: Verify report is accessible with the form token
    report_id = data["id"]
    get_response = await client.get(f"/api/reko/{report_id}?token={token}")
    assert get_response.status_code == 200
    assert get_response.json()["is_draft"] is False


# ============================================
# Additional Coverage Tests
# ============================================


@pytest_asyncio.fixture
async def reko_report_with_personnel(
    db_session: AsyncSession, test_incident: Incident, test_personnel: Personnel
) -> RekoReport:
    """Create a reko report with personnel assigned."""
    token = generate_form_token(str(test_incident.id), "reko")
    report = RekoReport(
        id=uuid4(),
        incident_id=test_incident.id,
        token=token,
        submitted_by_personnel_id=test_personnel.id,
        is_relevant=True,
        summary_text="Report with personnel",
        is_draft=True,
    )
    db_session.add(report)
    await db_session.commit()
    await db_session.refresh(report)
    return report


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_reko_form_with_existing_personnel_assignment(
    client: AsyncClient,
    test_incident: Incident,
    test_personnel: Personnel,
    reko_report_with_personnel: RekoReport,
):
    """Test getting form returns personnel name when report has submitted_by_personnel."""
    response = await client.get(
        f"/api/reko/form?incident_id={test_incident.id}&token={reko_report_with_personnel.token}"
    )
    assert response.status_code == 200
    data = response.json()

    # Should include personnel name
    assert data["submitted_by_personnel_id"] == str(test_personnel.id)
    assert data["submitted_by_personnel_name"] == test_personnel.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_submit_reko_report_with_personnel(
    client: AsyncClient, test_incident: Incident, test_personnel: Personnel
):
    """Test submitting report with personnel ID."""
    token = generate_form_token(str(test_incident.id), "reko")

    # First get the form with personnel
    form_response = await client.get(
        f"/api/reko/form?incident_id={test_incident.id}&token={token}&personnel_id={test_personnel.id}"
    )
    assert form_response.status_code == 200

    # Submit with personnel
    report_data = {
        "incident_id": str(test_incident.id),
        "token": token,
        "is_relevant": True,
        "summary_text": "Submitted by specific personnel",
        "submitted_by_personnel_id": str(test_personnel.id),
    }

    with patch("app.services.notification_service.create_reko_notification", new_callable=AsyncMock) as mock_notify:
        response = await client.post("/api/reko/?submit=true", json=report_data)
        assert response.status_code == 200

        # Verify notification was called with personnel name
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args.kwargs
        assert call_kwargs["submitted_by_name"] == test_personnel.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_submit_reko_report_with_is_relevant_false(client: AsyncClient, test_incident: Incident):
    """Test submitting report with is_relevant=False."""
    token = generate_form_token(str(test_incident.id), "reko")

    report_data = {
        "incident_id": str(test_incident.id),
        "token": token,
        "is_relevant": False,  # Not relevant
        "summary_text": "False alarm - no incident",
    }

    with patch("app.services.notification_service.create_reko_notification", new_callable=AsyncMock) as mock_notify:
        response = await client.post("/api/reko/?submit=true", json=report_data)
        assert response.status_code == 200
        data = response.json()
        assert data["is_relevant"] is False

        # Notification should be called with is_relevant=False
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args.kwargs
        assert call_kwargs["is_relevant"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_incident_reports_with_personnel_names(
    editor_client: AsyncClient,
    test_incident: Incident,
    test_personnel: Personnel,
    reko_report_with_personnel: RekoReport,
):
    """Test getting incident reports includes personnel names."""
    response = await editor_client.get(f"/api/reko/incident/{test_incident.id}/reports")
    assert response.status_code == 200
    reports = response.json()

    assert len(reports) == 1
    report = reports[0]
    assert report["submitted_by_personnel_name"] == test_personnel.name
    assert report["incident_title"] == test_incident.title
    assert report["incident_location"] == test_incident.location_address


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_report_includes_incident_details(
    client: AsyncClient, test_reko_report: RekoReport, test_incident: Incident
):
    """Test that getting single report includes full incident details."""
    response = await client.get(f"/api/reko/{test_reko_report.id}?token={test_reko_report.token}")
    assert response.status_code == 200
    data = response.json()

    # Verify incident details are included
    assert data["incident_title"] == test_incident.title
    assert data["incident_location"] == test_incident.location_address
    assert data["incident_type"] == test_incident.type
    assert data["incident_description"] == test_incident.description


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_report_includes_incident_details(
    client: AsyncClient, test_reko_report: RekoReport, test_incident: Incident
):
    """Test that PATCH response includes incident details."""
    update_data = {"summary_text": "Updated for testing"}
    response = await client.patch(
        f"/api/reko/{test_reko_report.id}",
        json=update_data,
        headers={"X-Reko-Token": test_reko_report.token},
    )
    assert response.status_code == 200
    data = response.json()

    # Verify incident details are included in PATCH response
    assert data["incident_title"] == test_incident.title
    assert data["incident_location"] == test_incident.location_address


@pytest.mark.asyncio
@pytest.mark.api
async def test_upload_photo_updates_report(
    client: AsyncClient, db_session: AsyncSession, test_incident: Incident, valid_token: str
):
    """Test that photo upload updates the report's photos_json list."""
    # First create a report
    await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={valid_token}")

    # Upload photo
    file_content = b"fake image content"
    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.save_photo = AsyncMock(return_value="uploaded-photo.jpg")

        response = await client.post(
            f"/api/reko/{test_incident.id}/photos",
            files={"file": ("test.jpg", file_content, "image/jpeg")},
            headers={"X-Reko-Token": valid_token},
        )
        assert response.status_code == 200

    # Verify the report was updated with the photo
    get_response = await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={valid_token}")
    assert response.status_code == 200
    report_data = get_response.json()
    assert "uploaded-photo.jpg" in report_data["photos_json"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_photo_updates_report(
    client: AsyncClient, db_session: AsyncSession, test_incident: Incident, valid_token: str
):
    """Test that photo deletion removes it from report's photos_json list."""
    # Create report with photos
    report = RekoReport(
        id=uuid4(),
        incident_id=test_incident.id,
        token=valid_token,
        photos_json=["photo1.jpg", "photo2.jpg", "photo3.jpg"],
        is_draft=True,
    )
    db_session.add(report)
    await db_session.commit()

    with patch("app.api.reko.photo_storage") as mock_storage:
        mock_storage.delete_photo = MagicMock(return_value=True)

        response = await client.delete(
            f"/api/reko/{test_incident.id}/photos/photo2.jpg",
            headers={"X-Reko-Token": valid_token},
        )
        assert response.status_code == 200

    # Verify the photo was removed from the list
    get_response = await client.get(f"/api/reko/form?incident_id={test_incident.id}&token={valid_token}")
    report_data = get_response.json()
    assert "photo2.jpg" not in report_data["photos_json"]
    assert "photo1.jpg" in report_data["photos_json"]
    assert "photo3.jpg" in report_data["photos_json"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_serve_photo_success(editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession):
    """Test successfully serving a photo file."""
    import tempfile
    from pathlib import Path

    # Create a temporary test image file
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_file:
        tmp_file.write(b"fake jpeg content")
        tmp_path = Path(tmp_file.name)

    try:
        with patch("app.api.reko.photo_storage") as mock_storage:
            mock_storage.get_photo_path = MagicMock(return_value=tmp_path)

            response = await editor_client.get(f"/api/photos/{test_incident.id}/test-photo.jpg")
            assert response.status_code == 200
            assert response.headers["content-type"] == "image/jpeg"
            assert "private" in response.headers.get("cache-control", "")
    finally:
        tmp_path.unlink()


@pytest.mark.asyncio
@pytest.mark.api
async def test_serve_photo_logs_access(editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession):
    """Test that serving a photo creates an audit log entry."""
    import tempfile
    from pathlib import Path

    from sqlalchemy import select

    from app.models import AuditLog

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_file:
        tmp_file.write(b"fake jpeg content")
        tmp_path = Path(tmp_file.name)

    try:
        with patch("app.api.reko.photo_storage") as mock_storage:
            mock_storage.get_photo_path = MagicMock(return_value=tmp_path)

            await editor_client.get(f"/api/photos/{test_incident.id}/audit-test-photo.jpg")

        # Check audit log was created
        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action_type == "view_photo",
                AuditLog.resource_type == "reko_photo",
            )
        )
        audit_entry = result.scalar_one_or_none()
        assert audit_entry is not None
        # AuditLog uses changes_json column
        assert audit_entry.changes_json["filename"] == "audit-test-photo.jpg"
    finally:
        tmp_path.unlink()


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_link_custom_form_type(editor_client: AsyncClient, test_incident: Incident):
    """Test generating link with custom form type."""
    response = await editor_client.post(f"/api/reko/generate-link?incident_id={test_incident.id}&form_type=custom")
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["incident_id"] == str(test_incident.id)


@pytest.mark.parametrize("action", ["create", "patch", "upload", "delete"])
async def test_real_viewer_session_cannot_mutate_reko(
    client,
    db_session,
    test_editor,
    test_incident,
    test_reko_report,
    action,
):
    """Exercise the actual cookie/JWT dependency chain, not a mocked viewer dependency."""
    test_editor.role = "viewer"
    await db_session.commit()
    login = await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
    assert login.status_code == 200
    if action == "create":
        response = await client.post(
            "/api/reko/", json={"incident_id": str(test_incident.id), "summary_text": "forged"}
        )
    elif action == "patch":
        response = await client.patch(f"/api/reko/{test_reko_report.id}", json={"summary_text": "forged"})
    elif action == "upload":
        response = await client.post(
            f"/api/reko/{test_incident.id}/photos", files={"file": ("photo.jpg", b"photo", "image/jpeg")}
        )
    else:
        response = await client.delete(f"/api/reko/{test_incident.id}/photos/{uuid4()}.jpg")
    assert response.status_code == 403, response.text
    await db_session.refresh(test_reko_report)
    assert test_reko_report.summary_text == "Test report summary"


@pytest.mark.parametrize("revoke", ["device", "all"])
async def test_field_derived_reko_token_closes_with_its_device(
    client,
    db_session,
    test_event,
    test_incident,
    test_personnel,
    test_editor,
    tmp_path,
    monkeypatch,
    revoke,
):
    """Full HTTP chain: code, claim, child token, report/photo, logout, rejected replay."""
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    db_session.add(
        IncidentAssignment(
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            purpose="reko",
        )
    )
    await db_session.commit()
    unlocked = await client.post(
        f"/api/feld/unlock?token={generate_feld_token(test_event.id)}",
        json={"code": test_event.feld_code},
    )
    assert unlocked.status_code == 200, unlocked.text
    claimed = await client.post(
        f"/api/feld/claim?token={unlocked.json()['token']}",
        json={"personnel_id": str(test_personnel.id)},
    )
    assert claimed.status_code == 200, claimed.text
    device_token = claimed.json()["token"]
    minted = await client.post(
        f"/api/feld/incidents/{test_incident.id}/reko-link?token={device_token}&personnel_id={test_personnel.id}",
    )
    assert minted.status_code == 200, minted.text
    form_token = minted.json()["token"]
    form_params = {"incident_id": str(test_incident.id), "token": form_token}
    form = await client.get("/api/reko/form", params=form_params)
    assert form.status_code == 200, form.text
    assert form.json()["submitted_by_personnel_id"] == str(test_personnel.id)
    report_id = form.json()["id"]
    forged = await client.get("/api/reko/form", params={**form_params, "personnel_id": str(uuid4())})
    assert forged.status_code == 403
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(image, format="JPEG")
    photo_url = f"/api/reko/{test_incident.id}/photos"
    headers = {"X-Reko-Token": form_token}
    photo = await client.post(photo_url, headers=headers, files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")})
    assert photo.status_code == 200, photo.text
    filename = photo.json()["filename"]
    photo_path = tmp_path / str(test_incident.id) / filename
    assert photo_path.exists()

    if revoke == "device":
        logged_out = await client.post(f"/api/feld/logout?token={device_token}")
        assert logged_out.status_code == 204
    else:
        login = await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
        assert login.status_code == 200
        logged_out = await client.post("/api/feld/access/revoke-devices", params={"event_id": str(test_event.id)})
        assert logged_out.status_code == 200, logged_out.text
        client.cookies.clear()

    responses = [
        await client.get("/api/reko/form", params=form_params),
        await client.get(f"/api/reko/{report_id}", params={"token": form_token}),
        await client.post(
            "/api/reko/", json={"incident_id": str(test_incident.id), "token": form_token, "summary_text": "forged"}
        ),
        await client.patch(f"/api/reko/{report_id}", headers=headers, json={"summary_text": "forged"}),
        await client.post(f"/api/reko/{test_incident.id}/arrived", params={"token": form_token}),
        await client.post(photo_url, headers=headers, files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")}),
        await client.delete(f"{photo_url}/{filename}", headers=headers),
    ]
    assert [response.status_code for response in responses] == [401] * len(responses), [r.text for r in responses]
    assert photo_path.exists()
    # A separate board-issued form credential remains a supported workflow.
    standalone = generate_form_token(str(test_incident.id))
    response = await client.get("/api/reko/form", params={"incident_id": str(test_incident.id), "token": standalone})
    assert response.status_code == 200


@pytest.mark.parametrize("bound", [False, True])
async def test_form_writes_stay_with_own_report_and_shared_photos_survive(
    client, db_session, test_event, test_incident, test_personnel, test_editor, tmp_path, monkeypatch, bound
):
    """Real form/photo requests cannot overwrite another link's report or photo."""
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    other_person = Personnel(id=uuid4(), name="Second crew", role="Feuerwehr", status="available")
    db_session.add(other_person)
    await db_session.commit()

    async def token_for(person):
        if not bound:
            return generate_form_token(str(test_incident.id))
        db_session.add(
            IncidentAssignment(
                incident_id=test_incident.id, resource_type="personnel", resource_id=person.id, purpose="reko"
            )
        )
        await db_session.commit()
        unlocked = await client.post(
            "/api/feld/unlock",
            params={"token": generate_feld_token(test_event.id)},
            json={"code": test_event.feld_code},
        )
        assert unlocked.status_code == 200, unlocked.text
        claimed = await client.post(
            "/api/feld/claim", params={"token": unlocked.json()["token"]}, json={"personnel_id": str(person.id)}
        )
        assert claimed.status_code == 200, claimed.text
        minted = await client.post(
            f"/api/feld/incidents/{test_incident.id}/reko-link",
            params={"token": claimed.json()["token"], "personnel_id": str(person.id)},
        )
        assert minted.status_code == 200, minted.text
        return minted.json()["token"]

    first_token = await token_for(test_personnel)
    second_token = await token_for(other_person)
    photo_url = f"/api/reko/{test_incident.id}/photos"
    first_headers = {"X-Reko-Token": first_token}
    second_headers = {"X-Reko-Token": second_token}
    first = await client.get("/api/reko/form", params={"incident_id": str(test_incident.id), "token": first_token})
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(image, format="JPEG")
    uploaded = await client.post(
        photo_url, headers=first_headers, files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")}
    )
    assert uploaded.status_code == 200, uploaded.text
    filename = uploaded.json()["filename"]
    assert (
        await client.patch(
            f"/api/reko/{first_id}",
            headers=first_headers,
            params={"submit": True},
            json={"summary_text": "Original crew"},
        )
    ).status_code == 200

    second = await client.get("/api/reko/form", params={"incident_id": str(test_incident.id), "token": second_token})
    assert second.status_code == 200, second.text
    second_id = second.json()["id"]
    assert second_id != first_id
    assert second.json()["photos_json"] == [filename]  # Deliberate shared prefill.
    denied = await client.patch(f"/api/reko/{first_id}", headers=second_headers, json={"summary_text": "Forged"})
    assert denied.status_code == 403, denied.text
    own = await client.patch(f"/api/reko/{second_id}", headers=second_headers, json={"summary_text": "Follow-up crew"})
    assert own.status_code == 200, own.text

    # A token-door report_id cannot redirect an upload or unlink into another row.
    uploaded_second = await client.post(
        photo_url,
        params={"report_id": first_id},
        headers=second_headers,
        files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")},
    )
    assert uploaded_second.status_code == 200, uploaded_second.text
    deleted = await client.delete(f"{photo_url}/{filename}", params={"report_id": first_id}, headers=second_headers)
    assert deleted.status_code == 200, deleted.text
    original = await db_session.get(RekoReport, first_id)
    follow_up = await db_session.get(RekoReport, second_id)
    await db_session.refresh(original)
    await db_session.refresh(follow_up)
    assert original.summary_text == "Original crew"
    assert original.photos_json == [filename]
    assert follow_up.photos_json == [uploaded_second.json()["filename"]]
    assert photo_storage.get_photo_path(test_incident.id, filename) is not None
    assert (await client.delete(f"{photo_url}/{filename}", headers=second_headers)).status_code == 404

    # Operators retain their deliberate ability to amend any crew's report.
    assert (
        await client.post("/api/auth/login", data={"username": test_editor.username, "password": TEST_PASSWORD})
    ).status_code == 200
    amended = await client.patch(f"/api/reko/{first_id}", json={"summary_text": "Operator amendment"})
    assert amended.status_code == 200, amended.text
    assert (await client.delete(f"{photo_url}/{filename}", params={"report_id": first_id})).status_code == 200
    assert photo_storage.get_photo_path(test_incident.id, filename) is None
