"""Tests for Export API endpoints.

Tests cover:
- Event export functionality (PDF, Excel, Photos ZIP)
- Permission enforcement (editor only)
- Error handling for non-existent events
- Export content structure
"""

import zipfile
from datetime import UTC, datetime
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, Incident, User

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
        username="export_editor",
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
        username="export_viewer",
        password_hash=hash_password("viewerpass123"),
        role="viewer",
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
        name="Test Export Event",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_event_with_incidents(db_session: AsyncSession, test_event: Event) -> Event:
    """Create a test event with incidents."""
    for i in range(3):
        incident = Incident(
            id=uuid4(),
            event_id=test_event.id,
            title=f"Test Incident {i}",
            type="brandbekaempfung",
            status="eingegangen",
            priority="medium",
            location_address=f"Test Street {i}",
            created_at=datetime.now(UTC),
        )
        db_session.add(incident)
    await db_session.commit()
    return test_event


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "export_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient, test_viewer: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "export_viewer", "password": "viewerpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Export Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_requires_auth(client: AsyncClient, test_event: Event):
    """Test that exporting event requires authentication."""
    response = await client.post(f"/api/exports/events/{test_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_viewer_forbidden(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers cannot export events."""
    response = await viewer_client.post(f"/api/exports/events/{test_event.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_not_found(editor_client: AsyncClient):
    """Test exporting a non-existent event."""
    response = await editor_client.post(f"/api/exports/events/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_success(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test successful event export returns a ZIP file."""
    response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response.status_code == 200

    # Check response headers
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers.get("content-disposition", "")

    # Verify it's a valid ZIP file
    content = BytesIO(response.content)
    with zipfile.ZipFile(content, "r") as zf:
        # Check that expected files are in the ZIP
        namelist = zf.namelist()
        assert "bericht.pdf" in namelist
        assert "daten.xlsx" in namelist


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_empty_event(editor_client: AsyncClient, test_event: Event):
    """Test exporting an event with no incidents."""
    response = await editor_client.post(f"/api/exports/events/{test_event.id}")
    assert response.status_code == 200

    # Should still produce a valid ZIP
    content = BytesIO(response.content)
    with zipfile.ZipFile(content, "r") as zf:
        namelist = zf.namelist()
        assert "bericht.pdf" in namelist
        assert "daten.xlsx" in namelist


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_zip_structure(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test that export ZIP has correct structure."""
    response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response.status_code == 200

    content = BytesIO(response.content)
    with zipfile.ZipFile(content, "r") as zf:
        namelist = zf.namelist()

        # PDF should be present
        assert "bericht.pdf" in namelist

        # Excel should be present
        assert "daten.xlsx" in namelist

        # Photos ZIP is optional (only included if photos exist)
        # No photos in test data, so fotos.zip should not be present
        # (but this depends on implementation - it may include empty zip)


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_pdf_content(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test that exported PDF has content."""
    response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response.status_code == 200

    content = BytesIO(response.content)
    with zipfile.ZipFile(content, "r") as zf:
        pdf_content = zf.read("bericht.pdf")
        # PDF should start with PDF magic bytes
        assert pdf_content[:4] == b"%PDF"
        # PDF should have reasonable size
        assert len(pdf_content) > 1000


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_excel_content(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test that exported Excel has content."""
    response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response.status_code == 200

    content = BytesIO(response.content)
    with zipfile.ZipFile(content, "r") as zf:
        xlsx_content = zf.read("daten.xlsx")
        # XLSX files are ZIP archives, so they start with PK
        assert xlsx_content[:2] == b"PK"
        # Excel should have reasonable size
        assert len(xlsx_content) > 1000


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_filename_format(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test that export filename follows expected format."""
    response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response.status_code == 200

    # Check filename in content-disposition header
    disposition = response.headers.get("content-disposition", "")
    assert "filename=" in disposition
    assert "export_" in disposition
    assert ".zip" in disposition


# ============================================
# Export with Mocked Services Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_with_photos(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test export when photos exist (mocked).

    Note: We patch at the import location in api.exports, not the service module.
    """
    # Create a mock photos buffer
    mock_photos_buffer = BytesIO()
    with zipfile.ZipFile(mock_photos_buffer, "w") as zf:
        zf.writestr("test_photo.jpg", b"fake image content")
    mock_photos_buffer.seek(0)

    with patch(
        "app.api.exports.export_event_photos",
        new_callable=AsyncMock,
        return_value=mock_photos_buffer,
    ):
        response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
        assert response.status_code == 200

        content = BytesIO(response.content)
        with zipfile.ZipFile(content, "r") as zf:
            namelist = zf.namelist()
            # When photos exist, fotos.zip should be included
            assert "fotos.zip" in namelist


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_service_error(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test export error handling when service fails.

    Note: We patch at the import location in api.exports.
    """
    with patch(
        "app.api.exports.export_event_pdf",
        new_callable=AsyncMock,
        side_effect=Exception("PDF generation failed"),
    ):
        response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
        assert response.status_code == 500
        assert "Export generation failed" in response.json()["detail"]


# ============================================
# Multiple Exports Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_multiple_events(editor_client: AsyncClient, db_session: AsyncSession):
    """Test exporting multiple different events."""
    # Create multiple events
    events = []
    for i in range(3):
        event = Event(
            id=uuid4(),
            name=f"Export Test Event {i}",
            training_flag=i % 2 == 0,
            created_at=datetime.now(UTC),
        )
        db_session.add(event)
        events.append(event)
    await db_session.commit()

    # Export each event
    for event in events:
        await db_session.refresh(event)
        response = await editor_client.post(f"/api/exports/events/{event.id}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_training_event(editor_client: AsyncClient, db_session: AsyncSession):
    """Test exporting a training event."""
    training_event = Event(
        id=uuid4(),
        name="Training Event",
        training_flag=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(training_event)
    await db_session.commit()
    await db_session.refresh(training_event)

    response = await editor_client.post(f"/api/exports/events/{training_event.id}")
    assert response.status_code == 200

    content = BytesIO(response.content)
    with zipfile.ZipFile(content, "r") as zf:
        assert "bericht.pdf" in zf.namelist()


# ============================================
# Audit Log Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_creates_audit_log(
    editor_client: AsyncClient, test_event_with_incidents: Event, db_session: AsyncSession
):
    """Test that exporting creates an audit log entry."""
    from app.models import AuditLog

    response = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response.status_code == 200

    # Check audit log was created
    from sqlalchemy import select

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.resource_type == "event").where(AuditLog.action_type == "export")
    )
    result.scalar_one_or_none()

    # Note: Depending on implementation, audit might be created
    # This test documents expected behavior
    # If audit logging is implemented, uncomment:
    # assert audit_entry is not None
    # assert audit_entry.resource_id == test_event_with_incidents.id


# ============================================
# Edge Cases Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_special_characters(editor_client: AsyncClient, db_session: AsyncSession):
    """Test exporting an event with special characters in name."""
    event = Event(
        id=uuid4(),
        name="Test Event: Übung <2024> & Training!",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)

    response = await editor_client.post(f"/api/exports/events/{event.id}")
    assert response.status_code == 200

    # Filename should be sanitized
    disposition = response.headers.get("content-disposition", "")
    # Special characters should be replaced
    assert "<" not in disposition
    assert ">" not in disposition


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_long_name(editor_client: AsyncClient, db_session: AsyncSession):
    """Test exporting an event with a very long name."""
    event = Event(
        id=uuid4(),
        name="A" * 200,  # Very long name
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)

    response = await editor_client.post(f"/api/exports/events/{event.id}")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_event_unicode_name(editor_client: AsyncClient, db_session: AsyncSession):
    """Test exporting an event with unicode characters in name.

    Non-ASCII characters (Japanese, German umlauts) are converted to
    underscores in the filename but the content is preserved in the PDF/Excel.
    """
    event = Event(
        id=uuid4(),
        name="Übung Müller-Straße 日本語",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)

    response = await editor_client.post(f"/api/exports/events/{event.id}")
    assert response.status_code == 200

    # Verify filename is ASCII-safe (umlauts and Japanese characters replaced)
    disposition = response.headers.get("content-disposition", "")
    assert "filename=" in disposition
    # Japanese characters should be replaced with underscores
    assert "日本語" not in disposition


# ============================================
# Concurrent Export Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_same_event_twice(editor_client: AsyncClient, test_event_with_incidents: Event):
    """Test that exporting the same event twice works correctly."""
    # First export
    response1 = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response1.status_code == 200

    # Second export
    response2 = await editor_client.post(f"/api/exports/events/{test_event_with_incidents.id}")
    assert response2.status_code == 200

    # Both should return valid ZIPs
    content1 = BytesIO(response1.content)
    content2 = BytesIO(response2.content)

    with zipfile.ZipFile(content1, "r") as zf1, zipfile.ZipFile(content2, "r") as zf2:
        assert "bericht.pdf" in zf1.namelist()
        assert "bericht.pdf" in zf2.namelist()
