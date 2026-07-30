"""Tests for settings API endpoints."""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Setting, User


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
    async def test_get_all_settings_viewer_allowed(self, viewer_client: AsyncClient, test_settings_data: list[Setting]):
        """Viewer role can read settings."""
        response = await viewer_client.get("/api/settings/")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict)
        assert data["polling_interval_ms"] == "5000"
        assert data["training_mode"] == "false"
        assert data["notification_enabled"] == "true"

    @pytest.mark.asyncio
    async def test_get_all_settings_editor_allowed(self, editor_client: AsyncClient, test_settings_data: list[Setting]):
        """Editor role can read settings."""
        response = await editor_client.get("/api/settings/")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict)
        assert len(data) >= 3


class TestGetSingleSetting:
    """Test GET /api/settings/{key} endpoint."""

    @pytest.mark.asyncio
    async def test_get_single_setting_success(self, editor_client: AsyncClient, test_settings_data: list[Setting]):
        """Get single setting returns correct schema."""
        response = await editor_client.get("/api/settings/polling_interval_ms")
        assert response.status_code == 200

        data = response.json()
        assert data["key"] == "polling_interval_ms"
        assert data["value"] == "5000"
        assert "updated_at" in data

    @pytest.mark.asyncio
    async def test_get_single_setting_not_found(self, editor_client: AsyncClient):
        """Get non-existent setting returns 404."""
        response = await editor_client.get("/api/settings/nonexistent_key")
        assert response.status_code == 404
        assert response.json()["detail"] == "Setting not found"


class TestUpdateSetting:
    """Test PATCH /api/settings/{key} endpoint."""

    @pytest.mark.asyncio
    async def test_update_setting_requires_editor(self, viewer_client: AsyncClient, test_settings_data: list[Setting]):
        """Viewer role cannot update settings."""
        response = await viewer_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_setting_editor_success(
        self,
        editor_client: AsyncClient,
        test_settings_data: list[Setting],
        db_session: AsyncSession,
    ):
        """Editor can update settings."""
        response = await editor_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["key"] == "training_mode"
        assert data["value"] == "true"

        # Verify in database
        result = await db_session.execute(select(Setting).where(Setting.key == "training_mode"))
        setting = result.scalar_one()
        assert setting.value == "true"

    @pytest.mark.asyncio
    async def test_update_setting_creates_audit_log(
        self,
        editor_client: AsyncClient,
        test_settings_data: list[Setting],
        db_session: AsyncSession,
        test_editor: User,
    ):
        """Setting update creates audit log entry."""
        response = await editor_client.patch(
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
        assert audit_entry.user_id == test_editor.id
        assert audit_entry.changes_json["key"] == "training_mode"
        assert audit_entry.changes_json["before"] == "false"
        assert audit_entry.changes_json["after"] == "true"

    @pytest.mark.asyncio
    async def test_update_setting_validation(self, editor_client: AsyncClient):
        """Invalid payload returns 422."""
        response = await editor_client.patch(
            "/api/settings/training_mode",
            json={},  # Missing "value" field
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_unknown_key_rejected(self, editor_client: AsyncClient):
        """Unknown setting keys are rejected, preventing arbitrary key injection."""
        response = await editor_client.patch(
            "/api/settings/railway_database_url_evil",
            json={"value": "postgresql://attacker"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_setting_updates_timestamp(
        self,
        editor_client: AsyncClient,
        test_settings_data: list[Setting],
        db_session: AsyncSession,
    ):
        """Update changes updated_at timestamp."""
        # Get original timestamp
        result = await db_session.execute(select(Setting).where(Setting.key == "training_mode"))
        original_setting = result.scalar_one()
        original_timestamp = original_setting.updated_at

        # Update setting
        response = await editor_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 200

        # Verify timestamp updated
        result = await db_session.execute(select(Setting).where(Setting.key == "training_mode"))
        updated_setting = result.scalar_one()
        assert updated_setting.updated_at > original_timestamp

    @pytest.mark.asyncio
    async def test_update_setting_records_user(
        self,
        editor_client: AsyncClient,
        test_settings_data: list[Setting],
        test_editor: User,
        db_session: AsyncSession,
    ):
        """Update records which user made the change."""
        response = await editor_client.patch(
            "/api/settings/training_mode",
            json={"value": "true"},
        )
        assert response.status_code == 200

        # Verify updated_by is set
        result = await db_session.execute(select(Setting).where(Setting.key == "training_mode"))
        setting = result.scalar_one()
        assert setting.updated_by == test_editor.id


# ============================================
# Credential exposure through the generic settings endpoints
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_settings_masks_credentials_from_viewers(viewer_client: AsyncClient, db_session: AsyncSession):
    """`GET /api/settings/` handed the whole table to any authenticated user.

    Two rows in it are credentials: the shared alarm webhook secret, and a Postgres DSN
    *with password* that decides where the sync service opens an outbound connection.
    One route over, `api/sync.py` deliberately redacts that same DSN.
    """
    db_session.add(Setting(key="alarm_webhook_secret", value="s3cr3t-webhook"))
    db_session.add(Setting(key="railway_database_url", value="postgresql://user:hunter2@db.example.com:5432/railway"))
    db_session.add(Setting(key="funkrufname", value="Omega"))
    await db_session.commit()

    response = await viewer_client.get("/api/settings/")
    assert response.status_code == 200
    body = response.json()

    assert "s3cr3t-webhook" not in response.text
    assert "hunter2" not in response.text
    assert body["alarm_webhook_secret"] == "***"
    assert body["railway_database_url"] == "***"
    # Non-secret settings still come through untouched.
    assert body["funkrufname"] == "Omega"


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("key", ["alarm_webhook_secret", "railway_database_url"])
async def test_single_setting_endpoint_refuses_credentials(editor_client: AsyncClient, key: str):
    """Masking the list would be pointless if this route served the value by name."""
    response = await editor_client.get(f"/api/settings/{key}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_target_cannot_be_repointed_through_generic_settings(editor_client: AsyncClient):
    """`railway_database_url` was in DEFAULT_SETTINGS, so the allowlist admitted the exact
    key its own comment claimed it protected — and the value is fed to create_async_engine.

    Any editor could therefore make the backend push events, incidents, personnel,
    vehicles, materials and settings to a host of their choosing. It has a dedicated
    endpoint (PUT /api/sync/config) that validates and redacts it; that is now the only way.
    """
    response = await editor_client.patch(
        "/api/settings/railway_database_url",
        json={"value": "postgresql://attacker:pw@evil.example.com:5432/exfil"},
    )
    assert response.status_code == 403
