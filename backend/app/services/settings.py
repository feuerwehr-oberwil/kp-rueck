"""Settings management service."""
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Setting

DEFAULT_SETTINGS = {
    'polling_interval_ms': '5000',
    'training_mode': 'false',
    'auto_archive_timeout_hours': '24',
    'notification_enabled': 'false',
    'alarm_webhook_secret': 'CHANGE_ME_IN_PRODUCTION',
    'training_autogen_max_emergencies': '50',
    'sync_interval_minutes': '2',
    'auto_sync_on_create': 'true',
    'railway_url': '',  # Railway production URL (empty = local mode, no sync)
    'sync_timeout_seconds': '30',  # HTTP timeout for sync requests
    'sync_conflict_buffer_seconds': '5',  # Timestamp buffer for conflict resolution (Local wins if within buffer)
}


async def get_setting(db: AsyncSession, key: str) -> str | None:
    """Get setting value by key."""
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def get_setting_value(db: AsyncSession, key: str, default: str = None) -> str:
    """Get setting value with fallback to default."""
    value = await get_setting(db, key)
    if value is None:
        return default if default is not None else DEFAULT_SETTINGS.get(key, '')
    return value


async def get_all_settings(db: AsyncSession) -> dict[str, str]:
    """Get all settings as dict."""
    result = await db.execute(select(Setting))
    settings = result.scalars().all()
    return {s.key: s.value for s in settings}


async def update_setting(
    db: AsyncSession,
    key: str,
    value: str,
    user_id: UUID
) -> Setting:
    """Update or create setting."""
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()

    if setting:
        setting.value = value
        setting.updated_by = user_id
        setting.updated_at = datetime.now(timezone.utc)
    else:
        setting = Setting(key=key, value=value, updated_by=user_id)
        db.add(setting)

    await db.commit()
    await db.refresh(setting)
    return setting


async def initialize_default_settings(db: AsyncSession):
    """Create default settings if they don't exist."""
    for key, value in DEFAULT_SETTINGS.items():
        existing = await get_setting(db, key)
        if existing is None:
            db.add(Setting(key=key, value=value))
    await db.commit()
