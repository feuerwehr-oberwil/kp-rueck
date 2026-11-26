"""Tests for settings management service."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting, User
from app.services.gps_automation import _load_config
from app.services.settings import (
    PRINTER_PORT,
    BoolSetting,
    get_all_settings,
    get_setting,
    initialize_default_settings,
    read,
    update_setting,
)


class TestRegistry:
    """Every reader goes through `read` with a declared setting (see the module docstring)."""

    @pytest.mark.asyncio
    async def test_an_undeclared_key_fails_instead_of_reading_its_default(self, db_session: AsyncSession):
        with pytest.raises(KeyError, match="undeclared station setting"):
            await read(db_session, BoolSetting("printer.enabeld", False))

    @pytest.mark.asyncio
    @pytest.mark.parametrize("stored", ["", "abc", "0", "70000", "nan"])
    async def test_a_number_that_cannot_be_used_reads_as_the_default(self, db_session: AsyncSession, stored: str):
        db_session.add(Setting(key=PRINTER_PORT.key, value=stored))
        await db_session.commit()
        assert await read(db_session, PRINTER_PORT) == 9100

    @pytest.mark.asyncio
    async def test_the_return_rule_is_on_without_a_row(self, db_session: AsyncSession):
        """One default per key: the reader used to fall back to «off», the registry says «on»."""
        assert (await _load_config(db_session)).rule_return_enabled is True


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
        setting = Setting(key="printer.port", value="9100")
        db_session.add(setting)
        await db_session.commit()

        original_updated_at = setting.updated_at

        # Update it
        updated = await update_setting(db_session, "printer.port", "9101", test_user.id)

        assert updated.value == "9101"
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
        assert all_settings["map_mode"] == "auto"
        assert all_settings["printer.auto_anfahrt"] == "true"
        assert all_settings["fallback.auto_print_enabled"] == "false"
        assert all_settings["incident_time_display"] == "column"
        # alarm_webhook_secret is auto-generated, just verify it exists and is non-empty
        assert len(all_settings["alarm_webhook_secret"]) > 0

    @pytest.mark.asyncio
    async def test_initialize_default_settings_skips_existing(self, db_session: AsyncSession, test_user: User):
        """Existing settings are not overwritten, missing ones added."""
        # Create one custom setting
        custom_setting = Setting(key="funkrufname", value="Gamma", updated_by=test_user.id)
        db_session.add(custom_setting)
        await db_session.commit()

        # Initialize defaults
        await initialize_default_settings(db_session)

        # Verify custom setting was NOT overwritten
        value = await get_setting(db_session, "funkrufname")
        assert value == "Gamma"

        # Verify other defaults were created
        all_settings = await get_all_settings(db_session)
        assert all_settings["map_mode"] == "auto"
        assert all_settings["fallback.auto_print_enabled"] == "false"


class TestWebhookSecretIsNotLogged:
    """The auto-generated webhook secret must not reach the log."""

    @pytest.mark.asyncio
    async def test_generated_secret_is_not_written_to_the_log(
        self, db_session: AsyncSession, caplog: pytest.LogCaptureFixture
    ):
        """Regression: first boot logged `Generated alarm_webhook_secret: <value>` at INFO.

        The secret authorises writes to the operations board, and stdout goes to the platform
        log and to whatever ships it onward. ALARM_WEBHOOK_SECRET in the environment covers
        the provisioning case the log line was there to solve.
        """
        with caplog.at_level("DEBUG"):
            await initialize_default_settings(db_session)

        secret = await get_setting(db_session, "alarm_webhook_secret")
        assert secret  # it was generated
        assert secret not in caplog.text
