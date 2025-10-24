"""Tests for settings API endpoints."""
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import AuditLog, Setting, User


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """Create an async test client with test database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_editor_user(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="settings_editor",
        password_hash=hash_password("editorpass"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_viewer_user(db_session: AsyncSession) -> User:
    """Create a test viewer user."""
    user = User(
        id=uuid4(),
        username="settings_viewer",
        password_hash=hash_password("viewerpass"),
        role="viewer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def authenticated_editor_client(
    client: AsyncClient, test_editor_user: User
) -> AsyncClient:
    """Create authenticated editor client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "settings_editor", "password": "editorpass"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def authenticated_viewer_client(
    client: AsyncClient, test_viewer_user: User
) -> AsyncClient:
    """Create authenticated viewer client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "settings_viewer", "password": "viewerpass"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def test_settings_data(db_session: AsyncSession) -> list[Setting]:
    """Create test settings."""
    settings = [
        Setting(key="polling_interval_ms", value="5000"),
        Setting(key="training_mode", value="false"),
        Setting(key="notification_enabled", value="true"),
    ]
    for setting in settings:
        db_session.add(setting)
    await db_session.commit()
    return settings


class TestGetAllSettings:
    """Test GET /api/settings endpoint."""

    @pytest.mark.asyncio
    async def test_get_all_settings_requires_auth(self, client: AsyncClient):
        """Unauthenticated request should fail."""
        response = await client.get("/api/settings/")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_all_settings_viewer_allowed(
        self, authenticated_viewer_client: AsyncClient, test_settings_data: list[Setting]
    ):
        """Viewer role can read settings."""
        response = await authenticated_viewer_client.get("/api/settings/")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict)
        assert data["polling_interval_ms"] == "5000"
        assert data["training_mode"] == "false"
        assert data["notification_enabled"] == "true"

    @pytest.mark.asyncio
    async def test_get_all_settings_editor_allowed(
        self, authenticated_editor_client: AsyncClient, test_settings_data: list[Setting]
    ):
        """Editor role can read settings."""
        response = await authenticated_editor_client.get("/api/settings/")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict)
        assert len(data) >= 3


class TestGetSingleSetting:
    """Test GET /api/settings/{key} endpoint."""

    @pytest.mark.asyncio
    async def test_get_single_setting_success(
        self, authenticated_editor_client: AsyncClient, test_settings_data: list[Setting]
    ):
        """Get single setting returns correct schema."""
        response = await authenticated_editor_client.get(
            "/api/settings/polling_interval_ms"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["key"] == "polling_interval_ms"
        assert data["value"] == "5000"
        assert "updated_at" in data

    @pytest.mark.asyncio
    async def test_get_single_setting_not_found(
        self, authenticated_editor_client: AsyncClient
    ):
        """Get non-existent setting returns 404."""
        response = await authenticated_editor_client.get("/api/settings/nonexistent_key")
        assert response.status_code == 404
        assert response.json()["detail"] == "Setting not found"


class TestUpdateSetting:
    """Test PATCH /api/settings/{key} endpoint."""

    @pytest.mark.asyncio
    async def test_update_setting_requires_editor(
        self, authenticated_viewer_client: AsyncClient, test_settings_data: list[Setting]
    ):
        """Viewer role cannot update settings."""
        response = await authenticated_viewer_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_setting_editor_success(
        self,
        authenticated_editor_client: AsyncClient,
        test_settings_data: list[Setting],
        db_session: AsyncSession,
    ):
        """Editor can update settings."""
        response = await authenticated_editor_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["key"] == "training_mode"
        assert data["value"] == "true"

        # Verify in database
        result = await db_session.execute(
            select(Setting).where(Setting.key == "training_mode")
        )
        setting = result.scalar_one()
        assert setting.value == "true"

    @pytest.mark.asyncio
    async def test_update_setting_creates_audit_log(
        self,
        authenticated_editor_client: AsyncClient,
        test_settings_data: list[Setting],
        db_session: AsyncSession,
        test_editor_user: User,
    ):
        """Setting update creates audit log entry."""
        response = await authenticated_editor_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 200

        # Verify audit log created
        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.resource_type == "setting",
                AuditLog.action_type == "update",
            )
        )
        audit_entry = result.scalar_one_or_none()

        assert audit_entry is not None
        assert audit_entry.user_id == test_editor_user.id
        assert audit_entry.changes_json["key"] == "training_mode"
        assert audit_entry.changes_json["before"] == "false"
        assert audit_entry.changes_json["after"] == "true"

    @pytest.mark.asyncio
    async def test_update_setting_validation(
        self, authenticated_editor_client: AsyncClient
    ):
        """Invalid payload returns 422."""
        response = await authenticated_editor_client.patch(
            "/api/settings/training_mode",
            json={},  # Missing "value" field
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_setting_updates_timestamp(
        self,
        authenticated_editor_client: AsyncClient,
        test_settings_data: list[Setting],
        db_session: AsyncSession,
    ):
        """Update changes updated_at timestamp."""
        # Get original timestamp
        result = await db_session.execute(
            select(Setting).where(Setting.key == "training_mode")
        )
        original_setting = result.scalar_one()
        original_timestamp = original_setting.updated_at

        # Update setting
        response = await authenticated_editor_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 200

        # Verify timestamp updated
        result = await db_session.execute(
            select(Setting).where(Setting.key == "training_mode")
        )
        updated_setting = result.scalar_one()
        assert updated_setting.updated_at > original_timestamp

    @pytest.mark.asyncio
    async def test_update_setting_records_user(
        self,
        authenticated_editor_client: AsyncClient,
        test_settings_data: list[Setting],
        test_editor_user: User,
        db_session: AsyncSession,
    ):
        """Update records which user made the change."""
        response = await authenticated_editor_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 200

        # Verify updated_by is set
        result = await db_session.execute(
            select(Setting).where(Setting.key == "training_mode")
        )
        setting = result.scalar_one()
        assert setting.updated_by == test_editor_user.id
