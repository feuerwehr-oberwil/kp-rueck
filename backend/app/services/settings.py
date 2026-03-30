"""Settings management service."""

import secrets
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Setting


def _generate_webhook_secret() -> str:
    """Generate a secure random webhook secret."""
    return secrets.token_urlsafe(32)


DEFAULT_SETTINGS = {
    "polling_interval_ms": "5000",
    "training_mode": "false",
    "auto_archive_timeout_hours": "24",
    "notification_enabled": "false",
    "alarm_webhook_secret": "",  # Auto-generated on first init
    "training_autogen_max_emergencies": "50",
    "sync_interval_minutes": "2",
    "auto_sync_on_create": "true",
    "railway_database_url": "",  # Railway PostgreSQL connection string (empty = local mode, no sync)
    "sync_conflict_buffer_seconds": "5",  # Timestamp buffer for conflict resolution (Local wins if within buffer)
    # Thermal printer settings (local installations only)
    "printer.enabled": "false",  # Master toggle for printer functionality
    "printer.ip": "",  # Printer IP address (e.g., "192.168.1.100")
    "printer.port": "9100",  # Printer port (default ESC/POS port)
    "printer.auto_anfahrt": "true",  # Auto-print assignment slip when status changes to "einsatz"
    "funkrufname": "Omega",  # Radio callsign for Funkdurchsage (e.g., "Omega", "Gamma")
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
        return default if default is not None else DEFAULT_SETTINGS.get(key, "")
    return value


async def get_all_settings(db: AsyncSession) -> dict[str, str]:
    """Get all settings as dict."""
    result = await db.execute(select(Setting))
    settings = result.scalars().all()
    return {s.key: s.value for s in settings}


async def update_setting(db: AsyncSession, key: str, value: str, user_id: UUID) -> Setting:
    """Update or create setting."""
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()

    if setting:
        setting.value = value
        setting.updated_by = user_id
        setting.updated_at = datetime.now(UTC)
    else:
        setting = Setting(key=key, value=value, updated_by=user_id)
        db.add(setting)

    await db.commit()
    await db.refresh(setting)
    return setting


async def initialize_default_settings(db: AsyncSession):
    """Create default settings if they don't exist."""
    import logging

    logger = logging.getLogger(__name__)

    for key, value in DEFAULT_SETTINGS.items():
        existing = await get_setting(db, key)
        if existing is None:
            # Auto-generate webhook secret on first init
            if key == "alarm_webhook_secret" and not value:
                value = _generate_webhook_secret()
                logger.info("Generated alarm_webhook_secret: %s", value)
            db.add(Setting(key=key, value=value))
    await db.commit()
