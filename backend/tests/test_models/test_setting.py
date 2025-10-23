"""Tests for Setting model."""
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting, User


class TestSettingModel:
    """Test Setting model operations."""

    async def test_create_setting(self, db_session: AsyncSession, test_user: User):
        """Test creating a setting."""
        setting = Setting(
            key="polling_interval_ms",
            value="5000",
            updated_by=test_user.id,
        )
        db_session.add(setting)
        await db_session.commit()

        # Refresh to get the updated_at timestamp
        await db_session.refresh(setting)

        assert setting.key == "polling_interval_ms"
        assert setting.value == "5000"
        assert setting.updated_by == test_user.id
        assert setting.updated_at is not None

    async def test_setting_without_user(self, db_session: AsyncSession):
        """Test creating a setting without user (system setting)."""
        setting = Setting(
            key="system_version",
            value="1.0.0",
            updated_by=None,
        )
        db_session.add(setting)
        await db_session.commit()

        assert setting.updated_by is None

    async def test_setting_update(self, db_session: AsyncSession, test_user: User):
        """Test updating a setting value."""
        # Create setting
        setting = Setting(
            key="training_mode",
            value="false",
            updated_by=test_user.id,
        )
        db_session.add(setting)
        await db_session.commit()

        original_updated_at = setting.updated_at

        # Update value
        setting.value = "true"
        await db_session.commit()
        await db_session.refresh(setting)

        assert setting.value == "true"
        # updated_at should be automatically updated
        assert setting.updated_at >= original_updated_at

    async def test_setting_primary_key(self, db_session: AsyncSession):
        """Test that key is the primary key."""
        setting1 = Setting(key="test_key", value="value1")
        db_session.add(setting1)
        await db_session.commit()

        # Try to create another setting with same key (should fail)
        from sqlalchemy.exc import IntegrityError

        setting2 = Setting(key="test_key", value="value2")
        db_session.add(setting2)

        import pytest

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_setting_query_by_key(self, db_session: AsyncSession):
        """Test querying settings by key."""
        # Create multiple settings
        settings = [
            Setting(key="setting1", value="value1"),
            Setting(key="setting2", value="value2"),
            Setting(key="setting3", value="value3"),
        ]
        for setting in settings:
            db_session.add(setting)
        await db_session.commit()

        # Query by key
        result = await db_session.execute(
            select(Setting).where(Setting.key == "setting2")
        )
        setting = result.scalar_one()

        assert setting.key == "setting2"
        assert setting.value == "value2"

    async def test_all_default_settings(self, db_session: AsyncSession, test_user: User):
        """Test creating all default settings from seed data."""
        default_settings = [
            ("polling_interval_ms", "5000"),
            ("training_mode", "false"),
            ("auto_archive_timeout_hours", "24"),
            ("notification_enabled", "false"),
            ("alarm_webhook_secret", "CHANGE_ME_IN_PRODUCTION"),
        ]

        for key, value in default_settings:
            setting = Setting(
                key=key,
                value=value,
                updated_by=test_user.id,
            )
            db_session.add(setting)
        await db_session.commit()

        # Verify all settings exist
        result = await db_session.execute(select(Setting))
        all_settings = result.scalars().all()
        assert len(all_settings) >= 5

        # Verify specific settings
        for key, expected_value in default_settings:
            result = await db_session.execute(select(Setting).where(Setting.key == key))
            setting = result.scalar_one()
            assert setting.value == expected_value
