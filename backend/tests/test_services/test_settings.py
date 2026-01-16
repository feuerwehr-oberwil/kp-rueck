"""Tests for settings management service."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting, User
from app.services.settings import (
    get_all_settings,
    get_setting,
    initialize_default_settings,
    update_setting,
)


class TestGetSetting:
    """Test get_setting function."""

    @pytest.mark.asyncio
    async def test_get_setting_exists(self, db_session: AsyncSession):
        """Create setting, then query it."""
        # Create setting
        setting = Setting(key="test_key", value="test_value")
        db_session.add(setting)
        await db_session.commit()

        # Query it
        value = await get_setting(db_session, "test_key")
        assert value == "test_value"

    @pytest.mark.asyncio
    async def test_get_setting_not_found(self, db_session: AsyncSession):
        """Query non-existent key."""
        value = await get_setting(db_session, "nonexistent_key")
        assert value is None


class TestGetAllSettings:
    """Test get_all_settings function."""

    @pytest.mark.asyncio
    async def test_get_all_settings(self, db_session: AsyncSession):
        """Create multiple settings and verify dict returned."""
        settings = [
            Setting(key="key1", value="value1"),
            Setting(key="key2", value="value2"),
            Setting(key="key3", value="value3"),
        ]
        for setting in settings:
            db_session.add(setting)
        await db_session.commit()

        result = await get_all_settings(db_session)

        assert isinstance(result, dict)
        assert result["key1"] == "value1"
        assert result["key2"] == "value2"
        assert result["key3"] == "value3"
        assert len(result) == 3


class TestUpdateSetting:
    """Test update_setting function."""

    @pytest.mark.asyncio
    async def test_update_setting_existing(self, db_session: AsyncSession, test_user: User):
        """Create setting, then update it."""
        # Create setting
        setting = Setting(key="polling_interval_ms", value="5000")
        db_session.add(setting)
        await db_session.commit()

        original_updated_at = setting.updated_at

        # Update it
        updated = await update_setting(db_session, "polling_interval_ms", "3000", test_user.id)

        assert updated.value == "3000"
        assert updated.updated_by == test_user.id
        assert updated.updated_at >= original_updated_at

    @pytest.mark.asyncio
    async def test_update_setting_creates_if_not_exists(self, db_session: AsyncSession, test_user: User):
        """Update non-existent setting creates it."""
        updated = await update_setting(db_session, "new_key", "new_value", test_user.id)

        assert updated.key == "new_key"
        assert updated.value == "new_value"
        assert updated.updated_by == test_user.id
        assert updated.updated_at is not None


class TestInitializeDefaultSettings:
    """Test initialize_default_settings function."""

    @pytest.mark.asyncio
    async def test_initialize_default_settings(self, db_session: AsyncSession):
        """Call on empty database."""
        await initialize_default_settings(db_session)

        # Verify all default settings were created
        all_settings = await get_all_settings(db_session)

        assert len(all_settings) >= 5
        assert all_settings["polling_interval_ms"] == "5000"
        assert all_settings["training_mode"] == "false"
        assert all_settings["auto_archive_timeout_hours"] == "24"
        assert all_settings["notification_enabled"] == "false"
        assert all_settings["alarm_webhook_secret"] == "CHANGE_ME_IN_PRODUCTION"

    @pytest.mark.asyncio
    async def test_initialize_default_settings_skips_existing(self, db_session: AsyncSession, test_user: User):
        """Existing settings are not overwritten, missing ones added."""
        # Create one custom setting
        custom_setting = Setting(key="polling_interval_ms", value="9999", updated_by=test_user.id)
        db_session.add(custom_setting)
        await db_session.commit()

        # Initialize defaults
        await initialize_default_settings(db_session)

        # Verify custom setting was NOT overwritten
        value = await get_setting(db_session, "polling_interval_ms")
        assert value == "9999"

        # Verify other defaults were created
        all_settings = await get_all_settings(db_session)
        assert all_settings["training_mode"] == "false"
        assert all_settings["auto_archive_timeout_hours"] == "24"
