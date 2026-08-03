"""Settings management service."""

import secrets
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
    # Training auto-generation (Übungssteuerung → "Automatik"). The background
    # monitor (services/training_autogen_task.py) idles until enabled and then
    # feeds the newest active training event.
    "training_autogen_enabled": "false",  # Master toggle for auto-generation
    "training_autogen_interval_min": "5",  # Minutes between generated alarms
    "training_autogen_mode": "board",  # "board" (incidents) or "divera" (pool alarms)
    "training_boost_multiplicator": "2.0",  # Interval divisor during the boost phase
    "training_boost_duration_min": "30",  # Boost phase length after event creation
    "training_autogen_max_emergencies": "50",
    "sync_interval_minutes": "2",
    "auto_sync_on_create": "true",
    "railway_database_url": "",  # Railway PostgreSQL connection string (empty = local mode, no sync)
    "sync_conflict_buffer_seconds": "5",  # Timestamp buffer for conflict resolution (Local wins if within buffer)
    # Paper fallback: periodic automatic board snapshots to the thermal printer
    # (background/fallback_print.py idles until enabled; needs printer.enabled too)
    "fallback.auto_print_enabled": "false",
    "fallback.auto_print_interval_min": "15",
    # Thermal printer settings (local installations only)
    "printer.enabled": "false",  # Master toggle for printer functionality
    "printer.ip": "",  # Printer IP address (e.g., "192.168.1.100")
    "printer.port": "9100",  # Printer port (default ESC/POS port)
    "printer.auto_anfahrt": "true",  # Auto-print assignment slip when status changes to "active"
    "funkrufname": "Omega",  # Radio callsign for Funkdurchsage (e.g., "Omega", "Gamma")
    # Station identity + map preferences.
    #
    # These are WRITTEN by the seed and READ all over the frontend, but were missing from
    # this dict — and api/settings.py rejects any key that is not in here. So the Einstellungen
    # page rendered editors for home_city, map_mode and map_style whose every save 404'd behind
    # a generic "Speichern fehlgeschlagen" toast, and firestation_latitude/longitude (read by
    # the map, the location picker and route planning) were writable by nothing at all.
    #
    # map_mode is the offline-map switch — the one control that exists specifically for an
    # internet outage, and it was the one that could not be set.
    "home_city": "",
    "map_mode": "online",  # online=OSM only, auto=fallback to local tiles, offline=local only
    "map_style": "osm",  # osm | topo | carto-light | carto-dark
    "firestation_name": "",
    "firestation_latitude": "",
    "firestation_longitude": "",
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
    # Outbound alarm (Ausalarmierung) — optional, OFF by default. Only takes
    # effect when an alerting provider is configured (currently: DIVERA_ACCESS_KEY).
    # Installations without a provider leave this off and see no send UI.
    # The alarm title/text are rendered from these templates (same engine as the
    # WhatsApp template). The dialog renders client-side and sends the result; the
    # backend only renders these as a fallback (see _render_alarm_template).
    # Renamed from divera.alarm_* in migration e5b2c9d4a8f1.
    "alerting.enabled": "false",  # Master toggle for outbound alarms
    "alerting.title_template": "KP: {type}",  # Push title (Stichwort)
    "alerting.text_template": (
        "📝 {notes}\n☎️ {contact}\n📋 {internal_notes}\n\n🚒 {vehicles}\n👤 {crew}\n🧰 {materials}"
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
    # Defaults tuned against real Traccar tracks (2026-07-06 field test): parked clients
    # throttle to one fix every ~30-100 s, so freshness must be generous while the
    # actual "standing there" requirement lives in min_dwell_seconds.
    "geofence_radius_meters": "200",  # Rule A: arrival radius (m) around the incident (edited in Settings → GPS)
    "gps.debounce_count": "2",  # N consecutive confirming fixes required
    "gps.freshness_seconds": "180",  # Ignore fixes older than this (staleness tolerance only)
    "gps.min_dwell_seconds": "10",  # Confirming fixes must span at least this long — kept
    # short so the prompt lands while the vehicle is still rolling to a stop; the
    # speed gate + confirm-modal carry the false-positive protection.
    "gps.speed_gate_kmh": "10",  # Treat as stationary only below this speed
}


async def get_setting(db: AsyncSession, key: str) -> str | None:
    """Get setting value by key."""
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def get_setting_value(db: AsyncSession, key: str, default: str | None = None) -> str:
    """Get setting value with fallback to default."""
    value = await get_setting(db, key)
    if value is None:
        return default if default is not None else DEFAULT_SETTINGS.get(key, "")
    return value


# Marks a database as disposable — written only by the demo seeder, checked by the demo
# reset before it truncates anything (background/demo_reset.assert_disposable_database).
#
# Deliberately NOT a member of DEFAULT_SETTINGS: that dict is created on every deployment,
# which would hand the marker to real stations and make it worthless. Staying out of it also
# keeps the key off the PATCH /api/settings/{key} allowlist, so no editor can forge one.
DISPOSABLE_MARKER_KEY = "deployment_role"
DISPOSABLE_MARKER_VALUE = "demo"


async def get_alarm_webhook_secret(db: AsyncSession) -> str:
    """The shared secret for POST /api/alarms and the Divera webhook.

    ``ALARM_WEBHOOK_SECRET`` in the environment WINS over the settings-table value. That is
    what lets a station provision the whole deployment from ``.env`` — the DB value is
    auto-generated on first boot, and reading it back out with SQL was the one setup step
    that could not be scripted (and the one KP Front never had, since it is env-only there).

    Empty env = the DB value, i.e. the existing behaviour for every deployment that does not
    set it. Returns "" when neither is configured; both call sites go through
    ``divera_intake.check_webhook_secret``, which treats that as fail-closed. (Until 2026-07
    only one of them did — the Divera adapter skipped the check on an empty secret.)
    """
    from ..config import settings as app_settings

    if app_settings.alarm_webhook_secret:
        return app_settings.alarm_webhook_secret
    return await get_setting(db, "alarm_webhook_secret") or ""


# Settings whose VALUE is a credential. They live in the same table as the polling
# interval and the radio callsign, and `GET /api/settings/` used to hand the whole table
# to any authenticated user — including read-only viewers. Both of these have a dedicated,
# careful path (`/api/sync/config` redacts the DSN before returning it; the webhook secret
# is configured via ALARM_WEBHOOK_SECRET or rotated with a targeted PATCH), so nothing
# legitimate needs to read them out of the generic endpoint. The frontend never does.
SECRET_SETTING_KEYS = frozenset({"alarm_webhook_secret", "railway_database_url"})

SECRET_PLACEHOLDER = "***"  # noqa: S105 — the mask itself, not a credential

# Keys the generic PATCH /api/settings/{key} must refuse, because a dedicated endpoint
# owns them and does something the generic one cannot (validate the DSN, redact it on the
# way back out, restart the sync scheduler). `railway_database_url` decides where this
# backend opens an outbound database connection, so "any editor can PATCH it" was a way to
# make the station push its whole board somewhere else.
GENERIC_WRITE_DENYLIST = frozenset({"railway_database_url"})


async def get_all_settings(db: AsyncSession, *, include_secrets: bool = False) -> dict[str, str]:
    """Get all settings as dict, with credential values masked by default.

    Defaulting to masked is the fail-safe direction: a new caller has to ask for the
    secrets on purpose, rather than leak them by not knowing they were in there.
    """
    result = await db.execute(select(Setting))
    settings = result.scalars().all()
    if include_secrets:
        return {s.key: s.value for s in settings}
    return {s.key: (SECRET_PLACEHOLDER if s.key in SECRET_SETTING_KEYS and s.value else s.value) for s in settings}


async def update_setting(db: AsyncSession, key: str, value: str, user_id: UUID | None) -> Setting:
    """Update or create setting."""
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()

    if setting:
        setting.value = value
        setting.updated_by = user_id
        # `updated_at` is deliberately NOT set here. The column carries
        # `server_default=func.now(), onupdate=func.now()`, so the database stamps it — and
        # the database is also what stamps it on INSERT. Setting it from Python instead mixed
        # two clocks on one column: with Postgres in a container or on a managed host, the
        # application clock can be behind the database's, and a row's `updated_at` could land
        # *before* its own creation time. It also made
        # `test_update_setting_existing` fail whenever the two clocks drifted apart.
    else:
        setting = Setting(key=key, value=value, updated_by=user_id)
        db.add(setting)

    await db.commit()
    await db.refresh(setting)
    return setting


async def initialize_default_settings(db: AsyncSession) -> None:
    """Create default settings if they don't exist."""
    import logging

    logger = logging.getLogger(__name__)

    for key, value in DEFAULT_SETTINGS.items():
        existing = await get_setting(db, key)
        if existing is None:
            # Auto-generate webhook secret on first init.
            #
            # The generated value is deliberately NOT logged. It used to be, because reading
            # it back out of the database was the one setup step a station could not script —
            # but stdout goes to the platform log (and to whatever ships it onward), which is
            # the wrong home for a credential that authorises writes to the board. Since
            # ALARM_WEBHOOK_SECRET in the environment wins over this value, provisioning no
            # longer needs the log line: set it in .env, or read it from Settings → Alarmierung.
            if key == "alarm_webhook_secret" and not value:
                value = _generate_webhook_secret()
                logger.info(
                    "Generated alarm_webhook_secret (not logged — see Settings → Alarmierung, "
                    "or set ALARM_WEBHOOK_SECRET in the environment to pin it)"
                )
            db.add(Setting(key=key, value=value))
    await db.commit()
