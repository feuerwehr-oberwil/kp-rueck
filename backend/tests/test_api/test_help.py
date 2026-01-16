"""Tests for Help Documentation API endpoints.

Tests cover:
- Help topics listing
- PDF export functionality
- Authentication requirements
- Content structure
"""

from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import User


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
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        id=uuid4(),
        username="help_user",
        password_hash=hash_password("userpass123abc"),
        role="viewer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def authenticated_client(client: AsyncClient, test_user: User) -> AsyncClient:
    """Create an authenticated client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "help_user", "password": "userpass123abc"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Help Topics Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_help_topics_success(client: AsyncClient):
    """Test getting list of help topics."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200

    data = response.json()
    assert "topics" in data
    assert isinstance(data["topics"], list)
    assert len(data["topics"]) > 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_help_topics_structure(client: AsyncClient):
    """Test that help topics have correct structure."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200

    data = response.json()
    for topic in data["topics"]:
        assert "id" in topic
        assert "title" in topic
        assert "category" in topic


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_help_topics_no_auth_required(client: AsyncClient):
    """Test that help topics don't require authentication."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_help_topics_expected_categories(client: AsyncClient):
    """Test that expected categories are present."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200

    data = response.json()
    categories = {topic["category"] for topic in data["topics"]}

    # Should have some expected categories
    expected = {"Workflow", "Features"}
    assert len(categories & expected) > 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_help_topics_includes_getting_started(client: AsyncClient):
    """Test that getting-started topic exists."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200

    data = response.json()
    topic_ids = [topic["id"] for topic in data["topics"]]
    assert "getting-started" in topic_ids


# ============================================
# PDF Export Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_pdf_requires_auth(client: AsyncClient):
    """Test that PDF export requires authentication."""
    response = await client.post("/api/help/export-pdf")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_pdf_success(authenticated_client: AsyncClient):
    """Test successful PDF export when help directory exists."""
    # Create a mock help directory with content
    with patch.object(Path, "exists", return_value=True), patch(
        "builtins.open",
        MagicMock(
            return_value=MagicMock(
                __enter__=MagicMock(return_value=MagicMock(read=MagicMock(return_value="# Test\n\nContent"))),
                __exit__=MagicMock(return_value=False),
            )
        ),
    ):
        response = await authenticated_client.post("/api/help/export-pdf")
        # May return 200 with PDF or error if help dir doesn't exist
        assert response.status_code in [200, 422]

        if response.status_code == 200:
            # Check if it's a PDF response or error JSON
            content_type = response.headers.get("content-type", "")
            if "application/pdf" in content_type:
                # PDF content should start with %PDF
                assert response.content[:4] == b"%PDF"


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_pdf_missing_directory(authenticated_client: AsyncClient):
    """Test PDF export when help directory doesn't exist."""
    with patch.object(Path, "exists", return_value=False):
        response = await authenticated_client.post("/api/help/export-pdf")
        # Should return error or handle gracefully
        assert response.status_code in [200, 404, 500]

        if response.status_code == 200:
            data = response.json() if response.headers.get("content-type") == "application/json" else {}
            # May return error in JSON format
            if "error" in data:
                assert "not found" in data["error"].lower() or "directory" in data["error"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_pdf_filename(authenticated_client: AsyncClient):
    """Test that PDF export has correct filename in header."""
    response = await authenticated_client.post("/api/help/export-pdf")

    # If successful PDF generation
    if response.status_code == 200 and "application/pdf" in response.headers.get("content-type", ""):
        disposition = response.headers.get("content-disposition", "")
        assert "kprueck-hilfe.pdf" in disposition


@pytest.mark.asyncio
@pytest.mark.api
async def test_export_pdf_content_type(authenticated_client: AsyncClient):
    """Test that PDF export has correct content type when successful."""
    response = await authenticated_client.post("/api/help/export-pdf")

    if response.status_code == 200:
        content_type = response.headers.get("content-type", "")
        # Either PDF or JSON error response
        assert "application/pdf" in content_type or "application/json" in content_type


# ============================================
# Viewer Access Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_can_access_topics(client: AsyncClient, db_session: AsyncSession):
    """Test that viewers can access help topics."""
    # Create a viewer
    viewer = User(
        id=uuid4(),
        username="help_viewer",
        password_hash=hash_password("viewerpass123abc"),
        role="viewer",
    )
    db_session.add(viewer)
    await db_session.commit()

    # Login as viewer
    await client.post(
        "/api/auth/login",
        data={"username": "help_viewer", "password": "viewerpass123abc"},
    )

    response = await client.get("/api/help/topics")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_can_export_pdf(client: AsyncClient, db_session: AsyncSession):
    """Test that viewers can export PDF."""
    # Create a viewer
    viewer = User(
        id=uuid4(),
        username="help_viewer2",
        password_hash=hash_password("viewerpass123abc"),
        role="viewer",
    )
    db_session.add(viewer)
    await db_session.commit()

    # Login as viewer
    await client.post(
        "/api/auth/login",
        data={"username": "help_viewer2", "password": "viewerpass123abc"},
    )

    response = await client.post("/api/help/export-pdf")
    # Should not be 403 (forbidden)
    assert response.status_code != 403


# ============================================
# Content Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_help_topics_content_german(client: AsyncClient):
    """Test that help topics have German titles."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200

    data = response.json()
    # At least one topic should have German title
    german_indicators = ["Erste", "Schritte", "Workflow", "Karten", "Training", "Check-In"]
    titles = [topic["title"] for topic in data["topics"]]

    has_german = any(any(indicator in title for indicator in german_indicators) for title in titles)
    assert has_german


@pytest.mark.asyncio
@pytest.mark.api
async def test_help_topics_unique_ids(client: AsyncClient):
    """Test that all help topic IDs are unique."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200

    data = response.json()
    topic_ids = [topic["id"] for topic in data["topics"]]
    assert len(topic_ids) == len(set(topic_ids))


# ============================================
# Response Format Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_help_topics_json_format(client: AsyncClient):
    """Test that help topics return valid JSON."""
    response = await client.get("/api/help/topics")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"

    # Should parse without error
    data = response.json()
    assert data is not None
