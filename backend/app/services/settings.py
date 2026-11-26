"""Station settings: the registry of every key, its one default, and its typed reader.

Each row of the ``settings`` table is declared once below, with its type and default:

    PRINTER_ENABLED = BoolSetting("printer.enabled", False)
    if await read(db, PRINTER_ENABLED): ...

``read`` returns the declared type (``bool`` here), and a value that does not parse – or lies
outside the declared range – reads as the default, the same way the frontend reads it.
``DEFAULT_SETTINGS`` – the rows ``initialize_default_settings`` creates on every boot and the
keys the generic ``PATCH /api/settings/{key}`` admits – is built from these declarations, so
a key has exactly one default. A misspelt constant fails mypy; a key built by hand that is not
declared here fails in ``read``.

Rows outside the registry (job state, the telemetry consent, notification settings) are read
raw with ``get_setting``.
"""

import math
import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Setting


def _generate_webhook_secret() -> str:
    """Generate a secure random webhook secret."""
    return secrets.token_urlsafe(32)


@dataclass(frozen=True)
class StationSetting[T]:
    """One key of the settings table with its default; subclasses say how the string reads."""

    key: str
    default: T

    def parse(self, raw: str) -> T:
        raise NotImplementedError

    def default_text(self) -> str:
        """The default as the settings table stores it (``DEFAULT_SETTINGS``)."""
        return str(self.default)


@dataclass(frozen=True)
class TextSetting(StationSetting[str]):
    """A string, read as stored."""

    default: str = ""

    def parse(self, raw: str) -> str:
        return raw


@dataclass(frozen=True)
class BoolSetting(StationSetting[bool]):
    """``"true"`` (any case) is on, everything else off – what the settings switches write."""

    def parse(self, raw: str) -> bool:
        return raw.strip().lower() == "true"

    def default_text(self) -> str:
        return "true" if self.default else "false"


@dataclass(frozen=True)
class FloatSetting(StationSetting[float]):
    """A number. Unparseable, not finite or outside the range reads as the default.

    ``positive`` admits only values above 0 – a 0 there has always meant «not set».
    """

    minimum: float | None = None
    maximum: float | None = None
    positive: bool = False

    def parse(self, raw: str) -> float:
        try:
            value = float(raw)
        except ValueError:
            return self.default
        if not math.isfinite(value) or not _in_range(value, self.minimum, self.maximum):
            return self.default
        return self.default if self.positive and value <= 0 else value

    def default_text(self) -> str:
        return format(self.default, "g")  # 100.0 → "100", as the Einstellungen page writes it


@dataclass(frozen=True)
class IntSetting(StationSetting[int]):
    """A whole number (``"2.0"`` reads as 2). A fraction, out of range or unparseable reads as the default."""

    minimum: int | None = None
    maximum: int | None = None

    def parse(self, raw: str) -> int:
        try:
            number = float(raw)
        except ValueError:
            return self.default
        if not number.is_integer() or not _in_range(number, self.minimum, self.maximum):
            return self.default
        return int(number)


@dataclass(frozen=True)
class CoordinateSetting(StationSetting[float | None]):
    """A latitude or longitude; empty or unparseable is None (not configured)."""

    default: float | None = None

    def parse(self, raw: str) -> float | None:
        try:
            value = float(raw)
        except ValueError:
            return None
        return value if math.isfinite(value) else None

    def default_text(self) -> str:
        return "" if self.default is None else str(self.default)


@dataclass(frozen=True)
class LinesSetting(StationSetting[tuple[str, ...]]):
    """One entry per line, edited in a Textarea. Blank lines and stray spaces are dropped.

    Tolerant on purpose: an operator editing a Textarea leaves blank lines and trailing
    spaces, and a chip row is not worth a validation error on a page that saves on blur.
    """

    default: tuple[str, ...] = ()

    def parse(self, raw: str) -> tuple[str, ...]:
        return tuple(line.strip() for line in raw.splitlines() if line.strip())

    def default_text(self) -> str:
        return "\n".join(self.default)


def _in_range(value: float, minimum: float | None, maximum: float | None) -> bool:
    return (minimum is None or value >= minimum) and (maximum is None or value <= maximum)


# ---------------------------------------------------------------------------
# The registry. Every key the app reads or the Einstellungen page writes.
# ---------------------------------------------------------------------------

ALARM_WEBHOOK_SECRET = TextSetting("alarm_webhook_secret")  # generated on first init

# Training auto-generation (Übungssteuerung → "Automatik"). The background monitor
# (services/training_autogen_task.py) idles until enabled and then feeds the Übung it was
# switched on for (state row `training_autogen.run`). The switch itself has its own
# endpoint – see GENERIC_WRITE_DENY_REASONS.
TRAINING_AUTOGEN_ENABLED = BoolSetting("training_autogen_enabled", False)
# Bounded so the next alarm time stays representable (a 1e12-minute interval overflows).
TRAINING_AUTOGEN_INTERVAL_MIN = FloatSetting("training_autogen_interval_min", 5.0, maximum=1440, positive=True)
TRAINING_AUTOGEN_MODE = TextSetting("training_autogen_mode", "board")  # "board" (incidents) or "divera" (pool alarms)
TRAINING_BOOST_MULTIPLICATOR = FloatSetting(
    "training_boost_multiplicator", 2.0, minimum=0.1, maximum=100
)  # interval divisor
TRAINING_BOOST_DURATION_MIN = IntSetting("training_boost_duration_min", 30, minimum=0)  # boost after switch-on
TRAINING_AUTOGEN_MAX_EMERGENCIES = IntSetting("training_autogen_max_emergencies", 50, minimum=0)

# Paper fallback: periodic automatic board snapshots to the thermal printer
# (background/fallback_print.py idles until enabled; needs printer.enabled too)
FALLBACK_AUTO_PRINT_ENABLED = BoolSetting("fallback.auto_print_enabled", False)
FALLBACK_AUTO_PRINT_INTERVAL_MIN = IntSetting("fallback.auto_print_interval_min", 15, minimum=5, maximum=120)

# Thermal printer settings (local installations only)
PRINTER_ENABLED = BoolSetting("printer.enabled", False)  # master toggle for printing
PRINTER_IP = TextSetting("printer.ip")  # e.g. "192.168.1.100"
PRINTER_PORT = IntSetting("printer.port", 9100, minimum=1, maximum=65535)  # ESC/POS port
# Auto-print the assignment slip ONCE, on the first dispatch (Disponiert / Anfahrt). Keeps its
# historic key name so installations that switched it on stay switched on – see
# crud/incidents.py `_dispatch_print_due`.
PRINTER_AUTO_ANFAHRT = BoolSetting("printer.auto_anfahrt", True)

FUNKRUFNAME = TextSetting("funkrufname", "Omega")  # radio callsign for Funkdurchsage («Omega», «Gamma»)
# Kommandant's name, pre-printed next to the «Kommandant» signature line on the
# Einsatzrapport (same idea as KP-Front's setting). Empty = just the label.
KOMMANDANT_NAME = TextSetting("kommandant_name")

# Station identity + map preferences, read all over the frontend.
HOME_CITY = TextSetting("home_city")
# Station overrides for the Grad abbreviations the board sidebar shows («Wachtmeister» →
# «Wm»), as a JSON object {role: abbreviation}. Empty = the frontend's built-in table
# (lib/roster-order.ts).
PERSONNEL_ROLE_ABBREVIATIONS = TextSetting("personnel.role_abbreviations")
# The offline-map switch: online = OSM only, auto = fall back to local tiles, offline = local
# only. "auto" behaves like "online" until the tiles fail, and the in-app help describes it as
# the default. Only NEW installations get it: an existing station keeps its row.
MAP_MODE = TextSetting("map_mode", "auto")
MAP_STYLE = TextSetting("map_style", "osm")  # osm | topo | carto-light | carto-dark
# Which time an incident chip shows everywhere (board, detail, map, wall display): start =
# when it came in (HH:MM), column = time in the current status, total = since the alarm. The
# station default; each device may override it locally.
INCIDENT_TIME_DISPLAY = TextSetting("incident_time_display", "column")  # start | column | total
FIRESTATION_NAME = TextSetting("firestation_name")
FIRESTATION_LATITUDE = CoordinateSetting("firestation_latitude")
FIRESTATION_LONGITUDE = CoordinateSetting("firestation_longitude")
# Station logo for printed exports (base64 PNG). Written and read through
# /api/settings/branding/logo only – see BLOB_SETTING_KEYS below for why it is a known key
# that the generic settings endpoints refuse to touch.
BRANDING_REPORT_LOGO = TextSetting("branding.report_logo")

# Incident message templates. Section-based: {token} placeholders are filled from the
# incident, a line whose tokens are all empty is dropped, blank runs collapse. Rendered
# CLIENT-SIDE (see frontend/lib/message-template.ts) – the defaults here must match the
# DEFAULT_* constants there. Stored in the DB so they sync across devices and are editable
# from Settings → Alarmierung.
WHATSAPP_INCIDENT_TEMPLATE = TextSetting(
    "whatsapp.incident_template",
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
    "_Erstellt: {timestamp}_",
)
# Setup-Checkliste. The two WhatsApp templates the checklist copies (Standby / Einrücken):
# their defaults live in frontend/lib/checklist-tasks.ts (the checklist falls back to them
# when the value is blank), so they are stored EMPTY here – a copy would drift. And the
# checklist's shape: which steps this station runs, and its own «für wen · wie viele
# Ausdrucke» note per step, as JSON. Both frontend readers tolerate a broken value (see
# applyChecklistSettings) – the checklist must not be takeable down by a hand-edited setting.
WHATSAPP_MESSAGE_1 = TextSetting("whatsapp_message_1")
WHATSAPP_MESSAGE_2 = TextSetting("whatsapp_message_2")
CHECKLIST_HIDDEN_TASKS = TextSetting("checklist.hidden_tasks", "[]")
CHECKLIST_NOTES = TextSetting("checklist.notes", "{}")

# Outbound alarm (Ausalarmierung) – optional, OFF by default. Only takes effect when an
# alerting provider is configured (currently: DIVERA_ACCESS_KEY). The alarm title/text are
# rendered from these templates (same engine as the WhatsApp template). The dialog renders
# client-side and sends the result; the backend renders these only as a fallback (see
# api/divera.py `_render_alarm_template`). Renamed from divera.alarm_* in migration e5b2c9d4a8f1.
ALERTING_ENABLED = BoolSetting("alerting.enabled", False)
ALERTING_TITLE_TEMPLATE = TextSetting("alerting.title_template", "KP: {type}")  # push title (Stichwort)
ALERTING_TEXT_TEMPLATE = TextSetting(
    "alerting.text_template",
    "📝 {notes}\n☎️ {contact}\n📋 {internal_notes}\n\n🚒 {vehicles}\n👤 {crew}\n🧰 {materials}",
)

# GPS-driven status automation (plan 10) – opt-in, OFF by default. GPS is noisy here (the
# Traccar feed returns frequent 404/no-fix), so all rules are gated on the master switch and
# survive jitter via the debounce/freshness/speed guards below. Also active in training
# events; never acts in demo mode. See services/gps_automation.py.
GPS_AUTOMATION_ENABLED = BoolSetting("gps.automation_enabled", False)  # master switch
GPS_RULE_ARRIVAL_ENABLED = BoolSetting("gps.rule_arrival_enabled", False)  # A: arrival → einsatz
GPS_RULE_ARRIVAL_SILENT = BoolSetting("gps.rule_arrival_silent", False)  # A, without the operator's confirm
# Rule B: prompt to release a vehicle back at the Magazin. Confirm-only, so ON by default
# (migration c7d8e9f0a1b2 rolled the default out to existing rows).
GPS_RULE_RETURN_ENABLED = BoolSetting("gps.rule_return_enabled", True)
# Legacy Magazin position (Rule B geofence centre); see get_station_coordinates.
GPS_STATION_LAT = CoordinateSetting("gps.station_lat")
GPS_STATION_LNG = CoordinateSetting("gps.station_lng")
GPS_STATION_RADIUS_METERS = FloatSetting("gps.station_radius_meters", 100.0, positive=True)  # tight: passers-by
# Tuning constants (shared by both rules). Each is positive: a 0 reads as the default, as it
# always has. Tuned against real Traccar tracks (2026-07-06 field test): parked clients
# throttle to one fix every ~30-100 s, so freshness is generous while the «standing there»
# requirement lives in min_dwell_seconds.
GEOFENCE_RADIUS_METERS = FloatSetting("geofence_radius_meters", 200.0, positive=True)  # Rule A arrival radius
GPS_DEBOUNCE_COUNT = IntSetting("gps.debounce_count", 2, minimum=1)  # consecutive confirming fixes
GPS_FRESHNESS_SECONDS = FloatSetting("gps.freshness_seconds", 180.0, positive=True)  # ignore older fixes
# Confirming fixes must span at least this long – short, so the prompt lands while the vehicle
# is still rolling to a stop; the speed gate + confirm modal carry the false-positive protection.
GPS_MIN_DWELL_SECONDS = FloatSetting("gps.min_dwell_seconds", 10.0, positive=True)
GPS_SPEED_GATE_KMH = FloatSetting("gps.speed_gate_kmh", 10.0, positive=True)  # stationary below this
# Lagekarte, not automation: from how many minutes on a vehicle pill shows the time of its last
# GPS report (frontend lib/map-vehicles.ts `parseStaleMinutes` reads it the same way). Also
# handed to the wall display with the viewer payload (api/viewer.py).
GPS_STALE_AFTER_MINUTES = FloatSetting("gps.stale_after_minutes", 10.0, positive=True)

# `/feld` Freitext-Meldung: the one-tap chips a crew sends instead of typing (plan 25,
# decision 20). Station-configurable and deliberately NOT i18n, like the message templates
# above: a station rewords them without a translation round. «Verstärkung nötig» and
# «Material nötig» are structured buttons on /feld since R13; `without_structured_chips`
# drops them from a station's own list.
FELD_MESSAGE_CHIPS = LinesSetting("feld.message_chips", ("fertig in ~30 Min", "Einsatzstelle übergeben"))
# The same, for a FAHRER. A driver may not report «Angekommen» or «Einsatz beendet» (the server
# refuses them, `WORK_SOURCES`), so these are the things a driver actually radios in.
# «Warte auf Einsatz», not «… Auftrag»: an Auftrag is the multi-stop object (migration
# c4f1a8d2e6b3 renamed that line in stored lists too).
FELD_DRIVER_MESSAGE_CHIPS = LinesSetting(
    "feld.driver_message_chips",
    ("Bin vor Ort", "Fahrzeug parkiert", "Fahre zurück ins Magazin", "Warte auf Einsatz"),
)

# Two ways to tidy the text an alarm provider puts into every alarm, both applied to the
# INCIDENT's description only and both EMPTY BY DEFAULT: what a dispatch system prepends is
# that station's arrangement with its Leitstelle. Applied by `services/divera_intake`.
# (1) Whole lines to DROP – boilerplate such as «Ausrückeordnung: 1. TLF → 2. PIO».
ALARM_DESCRIPTION_FILTER_PREFIXES = LinesSetting("alarm.description_filter_prefixes")
# (2) Labels to STRIP off the front of a kept line («Meldung: Wasser dringt ein»); a line left
#     with nothing behind its label is dropped.
ALARM_DESCRIPTION_LABEL_PREFIXES = LinesSetting("alarm.description_label_prefixes")

# Divera Rückmeldungen («Anrückend» in the Appell and the Personen-Leiste): which of the
# Einheit's own response statuses mean «kommt» / «kommt nicht». A JSON object keyed by Divera
# status id or name, value "coming" | "not_coming" | "other". EMPTY = the built-in name
# heuristic. See services/divera_responses.py and docs/ALARM-INTEGRATIONS.md.
DIVERA_RESPONSE_CLASSIFICATION = TextSetting("divera.response_classification")


# Every declaration above, collected from the module so a new one cannot be left out:
# the declared objects by key (for `read`), and their defaults as stored text.
_DECLARED: dict[str, object] = {}
DEFAULT_SETTINGS: dict[str, str] = {}
for _value in list(globals().values()):
    if isinstance(_value, StationSetting):
        if _value.key in _DECLARED:
            raise RuntimeError(f"settings key declared twice: {_value.key}")
        _DECLARED[_value.key] = _value
        DEFAULT_SETTINGS[_value.key] = _value.default_text()
del _value

# The chips that became structured /feld requests (R13). Compared case- and
# space-insensitively, because a station typed them into a Textarea.
STRUCTURED_REQUEST_CHIPS: frozenset[str] = frozenset({"verstärkung nötig", "material nötig"})


def without_structured_chips(chips: Sequence[str]) -> list[str]:
    """The chips minus the two that are fixed request buttons on /feld now."""
    return [chip for chip in chips if " ".join(chip.casefold().split()) not in STRUCTURED_REQUEST_CHIPS]


async def get_setting(db: AsyncSession, key: str) -> str | None:
    """The raw stored value, or None without a row. For rows outside the registry."""
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def read[T](db: AsyncSession, setting: StationSetting[T]) -> T:
    """The setting's value as its declared type; its default without a row.

    Raises ``KeyError`` for a setting that is not declared in this module – a key typed by
    hand elsewhere would otherwise read as its default forever.
    """
    if _DECLARED.get(setting.key) is not setting:
        raise KeyError(f"undeclared station setting: {setting.key!r}")
    raw = await get_setting(db, setting.key)
    return setting.default if raw is None else setting.parse(raw)


async def get_station_coordinates(db: AsyncSession) -> tuple[float, float] | None:
    """The Magazin/home-base coordinates — one answer for a question that was
    asked twice.

    `firestation_latitude/longitude` (Allgemein) is the pair the settings UI
    writes; `gps.station_lat/lng` survives as a legacy override for stations
    that configured only the GPS section before the merge — their geofence must
    not silently move. Everything that needs the station's position (Rule B
    return geofence, the Magazin map marker, simulated drives) reads THIS, so
    filling in either pair makes all of them work.
    """
    for lat_setting, lng_setting in (
        (GPS_STATION_LAT, GPS_STATION_LNG),
        (FIRESTATION_LATITUDE, FIRESTATION_LONGITUDE),
    ):
        lat = await read(db, lat_setting)
        lng = await read(db, lng_setting)
        if lat is not None and lng is not None:
            return (lat, lng)
    return None


# Marks a database as disposable – written only by the demo seeder, checked by the demo
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
    what lets a station provision the whole deployment from ``.env`` – the DB value is
    auto-generated on first boot, and reading it back out with SQL was the one setup step
    that could not be scripted (and the one KP Front never had, since it is env-only there).

    Empty env = the DB value, i.e. the existing behaviour for every deployment that does not
    set it. Returns "" when neither is configured; both call sites go through
    ``divera_intake.check_webhook_secret``, which treats that as fail-closed. (Until 2026-07
    only one of them did – the Divera adapter skipped the check on an empty secret.)
    """
    from ..config import settings as app_settings

    if app_settings.alarm_webhook_secret:
        return app_settings.alarm_webhook_secret
    return await get_setting(db, ALARM_WEBHOOK_SECRET.key) or ""


async def alarm_webhook_secret_is_pinned() -> bool:
    """True when ``ALARM_WEBHOOK_SECRET`` is set in the environment and therefore wins.

    The UI has to know this, because rotating the database value while the environment
    pins one changes nothing that any caller will ever see. Saying "rotated" there would
    be the worst kind of lie: the operator hands the new secret to their dispatch provider
    and every alarm from then on is rejected.
    """
    from ..config import settings as app_settings

    return bool(app_settings.alarm_webhook_secret)


async def rotate_alarm_webhook_secret(db: AsyncSession, user_id: UUID | None = None) -> str:
    """Generate a new webhook secret, store it, and return it once.

    Returned in the clear on purpose: the caller is an admin who has just asked for it, and
    a secret nobody can read is a secret nobody can give to their dispatch provider – which
    is exactly the corner that made `SELECT value FROM settings` a documented setup step.
    """
    new_secret = _generate_webhook_secret()
    await update_setting(db, ALARM_WEBHOOK_SECRET.key, new_secret, user_id)
    return new_secret


# Settings whose VALUE is a credential. They live in the same table as the polling
# interval and the radio callsign, and `GET /api/settings/` used to hand the whole table
# to any authenticated user – including read-only viewers. The webhook secret has a
# dedicated, careful path (ALARM_WEBHOOK_SECRET, or the admin reveal-and-rotate endpoints),
# so nothing legitimate needs to read it out of the generic endpoint. The frontend never does.
SECRET_SETTING_KEYS = frozenset({ALARM_WEBHOOK_SECRET.key})

SECRET_PLACEHOLDER = "***"  # noqa: S105 – the mask itself, not a credential

# Settings whose value is a BINARY BLOB rather than a piece of configuration text – today
# just the base64 station logo. They are omitted from `GET /api/settings/` entirely, not
# masked: nothing on the settings page can render a ~100 KB base64 string, and shipping it
# with every settings fetch would put it on the wire on every visit to Einstellungen. Their
# own endpoint serves the bytes with an image content type instead.
BLOB_SETTING_KEYS = frozenset({BRANDING_REPORT_LOGO.key})

# Rows a background job writes ABOUT itself, not configuration anyone sets: the last
# roster-snapshot run (services/roster_snapshot_sync.py) and the training Automatik's run
# (services/training_autogen_task.py, read at `GET /api/training/autogen`). Left out of `GET /api/settings/` so the
# settings page does not render a JSON report as an editable value; it has its own read at
# `GET /api/integrations/roster-snapshot`, and the generic PATCH refuses it because it is not in
# DEFAULT_SETTINGS.
STATE_SETTING_KEYS = frozenset({"roster_snapshot.status", "training_autogen.run", "training_regie.state"})

# Keys the generic PATCH /api/settings/{key} must refuse, because a dedicated endpoint
# owns them and does something the generic one cannot (decode, bound and re-encode an
# image; reveal and rotate a secret for admins only). The logo is on the list for a dull
# reason: a PATCH could store any string at all under it, and every export would then try
# to draw it.
GENERIC_WRITE_DENY_REASONS: dict[str, str] = {
    BRANDING_REPORT_LOGO.key: "Das Logo wird über /api/settings/branding/logo gesetzt, nicht hier.",
    # Masked on read and 403'd by name, but it was still writable through the generic PATCH
    # by any EDITOR – write-without-read on the credential that authorises writing incidents
    # onto the board. An editor could pin it to a value they knew, or simply break the
    # station's dispatch integration, and the generic handler wrote the old and new value
    # into the audit log in clear text on the way past. Admin-only now, with its own
    # reveal-and-rotate endpoints, which is also what finally retires the documented
    # `SELECT value FROM settings …`.
    # The switch alone would leave the run row (which Übung, since when) behind – the
    # Automatik would feed the wrong Übung and boost from the wrong start.
    TRAINING_AUTOGEN_ENABLED.key: (
        "Die Automatik wird in der Übungs-Steuerung geschaltet (/api/training/events/{id}/autogen), nicht hier."
    ),
    ALARM_WEBHOOK_SECRET.key: (
        "Dieser Wert wird über /api/settings/alarm-webhook-secret gesetzt oder rotiert, nicht hier."
    ),
}

GENERIC_WRITE_DENYLIST = frozenset(GENERIC_WRITE_DENY_REASONS)


async def get_all_settings(db: AsyncSession, *, include_secrets: bool = False) -> dict[str, str]:
    """Get all settings as dict, with credential values masked by default.

    Defaulting to masked is the fail-safe direction: a new caller has to ask for the
    secrets on purpose, rather than leak them by not knowing they were in there.

    Blob-valued keys (:data:`BLOB_SETTING_KEYS`) are left out of the result either way –
    they are files, not configuration, and have their own endpoint.
    """
    result = await db.execute(select(Setting))
    settings = [s for s in result.scalars().all() if s.key not in BLOB_SETTING_KEYS | STATE_SETTING_KEYS]
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
        # `server_default=func.now(), onupdate=func.now()`, so the database stamps it – and
        # the database is also what stamps it on INSERT. Setting it from Python instead mixed
        # two clocks on one column: with Postgres in a container or on a managed host, the
        # application clock can be behind the database's, and a row's `updated_at` could land
        # *before* its own creation time. It also made
        # `test_update_setting_existing` fail whenever the two clocks drifted apart.
    else:
        setting = Setting(key=key, value=value, updated_by=user_id)
        db.add(setting)

    await db.flush()
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
            # it back out of the database was the one setup step a station could not script –
            # but stdout goes to the platform log (and to whatever ships it onward), which is
            # the wrong home for a credential that authorises writes to the board. Since
            # ALARM_WEBHOOK_SECRET in the environment wins over this value, so provisioning no
            # longer needs the log line: set it in .env and this generated value is never used.
            # Reading it back no longer needs SQL either – an admin can reveal or rotate it in
            # the app (GET/POST /api/settings/alarm-webhook-secret, Einstellungen → Alarmierung),
            # which is what this message used to send people to psql for.
            if key == ALARM_WEBHOOK_SECRET.key and not value:
                value = _generate_webhook_secret()
                logger.info(
                    "Generated alarm_webhook_secret (not logged – it authorises writes to the "
                    "board). To choose it yourself, set ALARM_WEBHOOK_SECRET in .env "
                    "(openssl rand -hex 24); it wins over this value. To read or replace this "
                    "one, sign in as an admin: Einstellungen → Alarmierung."
                )
            db.add(Setting(key=key, value=value))
    await db.flush()
