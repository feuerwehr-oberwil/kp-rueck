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
    # Incident message templates. Section-based: {token} placeholders are filled
    # from the incident, a line whose tokens are all empty is dropped, blank runs
    # collapse. Rendered CLIENT-SIDE (see frontend/lib/message-template.ts) — the
    # defaults here must match the DEFAULT_* constants there. Stored in the DB so
    # they sync across devices and are editable from Settings → Alarmierung.
    "whatsapp.incident_template": (
        "🚨 *{type}*\n"
        "📍 {location}\n"
        "📝 {notes}\n"
        "☎️ {contact}\n"
        "📋 {internal_notes}\n"
        "\n"
        "🚒 {vehicles}\n"
        "👤 {crew}\n"
        "🧰 {materials}\n"
        "\n"
        "{reko}\n"
        "\n"
        "_Erstellt: {timestamp}_"
    ),
    # Divera outbound alarm (ausalarmierung) — optional, OFF by default. Only takes
    # effect when a DIVERA_ACCESS_KEY is also configured. Installations that don't
    # use Divera leave this off and see no Divera send UI. Channels are push-only.
    # The alarm title/text are rendered from these templates (same engine as the
    # WhatsApp template). The dialog renders client-side and sends the result; the
    # backend only renders these as a fallback (see _render_alarm_template).
    "divera.alarm_enabled": "false",  # Master toggle for sending alarms to Divera
    "divera.alarm_title_template": "KP: {type}",  # Push title (Stichwort)
    "divera.alarm_text_template": (
        "📝 {notes}\n"
        "☎️ {contact}\n"
        "📋 {internal_notes}\n"
        "\n"
        "🚒 {vehicles}\n"
        "👤 {crew}\n"
        "🧰 {materials}"
    ),
    # GPS-driven status automation (plan 10) — opt-in, OFF by default. GPS is noisy
    # here (the Traccar feed returns frequent 404/no-fix), so all rules are gated on the
    # master switch and survive jitter via the debounce/freshness/speed guards below.
    # Also active in training events; never acts in demo mode. See app/services/gps_automation.py.
    "gps.automation_enabled": "false",  # Master switch for all GPS automation
    "gps.rule_arrival_enabled": "false",  # Rule A: arrival at incident -> advance to einsatz
    "gps.rule_arrival_silent": "false",  # Rule A opt-in: advance SILENTLY (no operator confirm)
    "gps.rule_return_enabled": "true",  # Rule B: prompt to release a vehicle back at magazin (confirm-only, safe default ON)
    "gps.station_lat": "",  # Magazin/home-base latitude (Rule B geofence centre)
    "gps.station_lng": "",  # Magazin/home-base longitude (Rule B geofence centre)
    "gps.station_radius_meters": "100",  # Tight radius so passing vehicles don't trigger
    # Tuning constants (shared by both rules). Arrival radius reuses geofence_radius_meters.
    "geofence_radius_meters": "200",  # Rule A: arrival radius (m) around the incident (edited in Settings → GPS)
    "gps.debounce_count": "3",  # N consecutive confirming fixes required
    "gps.freshness_seconds": "60",  # Ignore fixes older than this; also the min enter-duration
    "gps.speed_gate_kmh": "5",  # Treat as stationary only below this speed
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
