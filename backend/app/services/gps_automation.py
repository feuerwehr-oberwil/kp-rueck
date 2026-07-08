"""GPS-driven incident status automation (plan 10).

Runs once per Traccar poll tick (invoked from ``traccar_poller``) and implements
two rules, both opt-in behind ``gps.automation_enabled`` (default OFF):

- **Rule A — Arrival:** when an assigned vehicle's GPS device is confirmed at the
  incident location, advance the incident ``disponiert → einsatz``. By DEFAULT this only
  PROMPTS the operator to confirm (``gps_arrival_prompt``); silent auto-advance is an
  explicit opt-in via ``gps.rule_arrival_silent``. The anti-jitter guards are hard either
  way: ``N`` consecutive FRESH fixes spanning ``>= gps.min_dwell_seconds``, speed gate,
  stale/404 fixes are ignored and RESET the debounce counter, only from status exactly
  ``disponiert``, one-shot per incident, fully reversible (an operator can drag it back).

- **Rule B — Return to magazin (CONFIRM-release):** when an assigned vehicle's device
  enters the magazin geofence (confirmed with the same guards), PROMPT the operator
  to release that vehicle's assignment. Never silent-release, never auto-close.

All automated actions go through ``crud.update_incident_status`` so status-transition
side effects fire, and are attributed to a clearly-named system actor user
(``gps-automation``) so the audit / Excel export shows "automatic (GPS)" vs operator
actions. Also active in training events (so the rules can be exercised in Übungen);
disabled only in demo mode.

Debounce counters are kept in module-level memory and reset on any gap (missing/stale
fix) so spotty GPS coverage can never accumulate a false positive.
"""

import logging
import math
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings as app_settings
from ..crud import incidents as incidents_crud
from ..models import Event, Incident, IncidentAssignment, User, Vehicle
from ..websocket_manager import broadcast_incident_update, broadcast_message
from .settings import get_setting_value

logger = logging.getLogger(__name__)

# Fixed UUID for the system actor so audit rows are consistently attributable and the
# StatusTransition.user_id foreign key is always satisfied. Distinct from the dev/master
# mock ids so log_action does NOT skip it.
GPS_SYSTEM_USER_ID = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
GPS_SYSTEM_USERNAME = "gps-automation"
GPS_SYSTEM_DISPLAY_NAME = "GPS-Automatik"

ARRIVAL_NOTE = "Automatisch: Fahrzeug am Einsatzort (GPS)"


def _haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points on Earth in meters."""
    earth_radius = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return earth_radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@dataclass
class _AutomationConfig:
    """Resolved, validated tuning constants for one tick."""

    enabled: bool
    rule_arrival_enabled: bool
    rule_arrival_silent: bool
    rule_return_enabled: bool
    arrival_radius_m: float
    station_lat: float | None
    station_lng: float | None
    station_radius_m: float
    debounce_count: int
    freshness_seconds: float
    min_dwell_seconds: float
    speed_gate_kmh: float


@dataclass
class _Debounce:
    """Per-target debounce state.

    The duration window is anchored on the GPS FIX timestamps (``first_fix_at`` ..
    ``last_fix_at``), not wall-clock, so "stationary for >= 60 s" reflects what the
    tracker actually observed and stays correct regardless of poll cadence.
    """

    count: int = 0
    first_fix_at: datetime | None = None
    last_fix_at: datetime | None = None
    fired: bool = False  # one-shot latch (per incident for Rule A, per assignment for Rule B)

    def reset(self) -> None:
        self.count = 0
        self.first_fix_at = None
        self.last_fix_at = None
        # Note: ``fired`` is intentionally NOT reset here — the one-shot latch must
        # survive a debounce gap so a vehicle parking, leaving and returning does not
        # re-fire the same rule. It clears only when the target disappears (see prune).


@dataclass
class _AutomationState:
    """Module-level in-memory debounce stores (survive across ticks)."""

    # Rule A keyed by (incident_id, vehicle_id); Rule B keyed by assignment_id.
    arrival: dict[tuple[uuid.UUID, uuid.UUID], _Debounce] = field(default_factory=dict)
    returns: dict[uuid.UUID, _Debounce] = field(default_factory=dict)

    def prune(self, arrival_keys: set, return_keys: set) -> None:
        """Drop debounce entries whose target is no longer relevant.

        Clearing the entry also clears the one-shot ``fired`` latch, which is correct:
        once an incident leaves ``disponiert`` (Rule A) or an assignment is released
        (Rule B), the target is gone and a brand-new one may legitimately fire later.
        """
        for key in list(self.arrival.keys()):
            if key not in arrival_keys:
                del self.arrival[key]
        for key in list(self.returns.keys()):
            if key not in return_keys:
                del self.returns[key]


_state = _AutomationState()


def _now() -> datetime:
    """Wall-clock now (UTC). Indirected so tests can simulate the passage of time."""
    return datetime.now(UTC)


def _parse_float(value: str | None) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


async def _load_config(db: AsyncSession) -> _AutomationConfig:
    """Read and validate the gps.* settings for this tick."""
    enabled = (await get_setting_value(db, "gps.automation_enabled", "false")).lower() == "true"
    rule_arrival = (await get_setting_value(db, "gps.rule_arrival_enabled", "false")).lower() == "true"
    rule_arrival_silent = (await get_setting_value(db, "gps.rule_arrival_silent", "false")).lower() == "true"
    rule_return = (await get_setting_value(db, "gps.rule_return_enabled", "false")).lower() == "true"

    arrival_radius = _parse_float(await get_setting_value(db, "geofence_radius_meters", "200")) or 200.0
    station_lat = _parse_float(await get_setting_value(db, "gps.station_lat", ""))
    station_lng = _parse_float(await get_setting_value(db, "gps.station_lng", ""))
    station_radius = _parse_float(await get_setting_value(db, "gps.station_radius_meters", "100")) or 100.0

    debounce_count = int(_parse_float(await get_setting_value(db, "gps.debounce_count", "2")) or 2)
    freshness = _parse_float(await get_setting_value(db, "gps.freshness_seconds", "180")) or 180.0
    min_dwell = _parse_float(await get_setting_value(db, "gps.min_dwell_seconds", "10")) or 10.0
    speed_gate = _parse_float(await get_setting_value(db, "gps.speed_gate_kmh", "10")) or 10.0

    return _AutomationConfig(
        enabled=enabled,
        rule_arrival_enabled=rule_arrival,
        rule_arrival_silent=rule_arrival_silent,
        rule_return_enabled=rule_return,
        arrival_radius_m=arrival_radius,
        station_lat=station_lat,
        station_lng=station_lng,
        station_radius_m=station_radius,
        debounce_count=max(1, debounce_count),
        freshness_seconds=max(1.0, freshness),
        min_dwell_seconds=max(0.0, min_dwell),
        speed_gate_kmh=max(0.0, speed_gate),
    )


async def _get_system_actor(db: AsyncSession) -> User:
    """Get-or-create the dedicated system actor user used for attribution.

    Persisted so ``StatusTransition.user_id`` / ``audit_log.user_id`` foreign keys are
    satisfied and the Excel audit export shows a clearly-named actor.
    """
    result = await db.execute(select(User).where(User.id == GPS_SYSTEM_USER_ID))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            id=GPS_SYSTEM_USER_ID,
            username=GPS_SYSTEM_USERNAME,
            password_hash=None,
            role="editor",
            display_name=GPS_SYSTEM_DISPLAY_NAME,
            is_active=False,  # cannot log in — used only for attribution
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return user


def _is_fresh(last_update: datetime, now: datetime, freshness_seconds: float) -> bool:
    """A fix is fresh if its device time is within the freshness window of now."""
    lu = last_update
    if lu.tzinfo is None:
        lu = lu.replace(tzinfo=UTC)
    age = (now - lu).total_seconds()
    # Reject stale fixes AND future-dated fixes (clock skew) — both are untrustworthy.
    return -freshness_seconds <= age <= freshness_seconds


def _advance_debounce(store: dict, key, fix_at: datetime, cfg: _AutomationConfig) -> bool:
    """Register a confirming fix (at GPS time ``fix_at``) and report whether to fire.

    Returns True exactly once when N consecutive confirming fixes have accumulated over a
    GPS-observed span of >= min_dwell_seconds AND the one-shot latch is still open. The
    caller resets the debounce on any non-confirming/missing/stale fix. A fix that is not
    strictly newer than the last counted one is ignored (no double-count of a repeated
    position from two ticks before the tracker reported a new fix).

    Dwell (how long the vehicle must demonstrably stand there) is deliberately a separate
    knob from freshness (how stale a fix may be before it resets the counter): parked
    Traccar clients throttle to one fix every ~30-100 s, so a tight freshness window
    would keep resetting the counter on a vehicle that IS standing at the target.
    """
    db = store.get(key)
    if db is None:
        db = _Debounce()
        store[key] = db

    if db.fired:
        return False

    if fix_at.tzinfo is None:
        fix_at = fix_at.replace(tzinfo=UTC)

    if db.last_fix_at is not None and fix_at <= db.last_fix_at:
        # Same/older fix replayed across ticks — don't advance the counter.
        return False

    if db.first_fix_at is None:
        db.first_fix_at = fix_at
    db.last_fix_at = fix_at
    db.count += 1

    span = (db.last_fix_at - db.first_fix_at).total_seconds()
    if db.count >= cfg.debounce_count and span >= cfg.min_dwell_seconds:
        db.fired = True
        return True
    return False


def _reset_debounce(store: dict, key) -> None:
    db = store.get(key)
    if db is not None:
        db.reset()


async def run_automation_tick(db: AsyncSession, vehicle_positions: list) -> None:
    """Entry point invoked once per Traccar poll tick.

    ``vehicle_positions`` is the same ``list[VehiclePosition]`` the poller already
    fetched, so this adds no extra Traccar calls. All failures are swallowed (logged at
    debug) so automation can never break the position broadcast.
    """
    try:
        cfg = await _load_config(db)
        if not cfg.enabled or not (cfg.rule_arrival_enabled or cfg.rule_return_enabled):
            return
        if app_settings.demo_mode:
            return

        # Map vehicle name (lowercase) -> position, same scheme as the geofence alert.
        # A VEHICLE maps to a Traccar device by matching device_name to vehicle.name;
        # the driver's tracker is named after the vehicle in this deployment.
        position_by_name = {p.device_name.lower(): p for p in vehicle_positions if p is not None}

        now = _now()

        # Active vehicle assignments for non-archived events. Training events are
        # deliberately included — they're the natural place to exercise the rules.
        result = await db.execute(
            select(IncidentAssignment, Incident, Vehicle, Event)
            .join(Incident, IncidentAssignment.incident_id == Incident.id)
            .join(Vehicle, IncidentAssignment.resource_id == Vehicle.id)
            .join(Event, Incident.event_id == Event.id)
            .where(IncidentAssignment.resource_type == "vehicle")
            .where(IncidentAssignment.unassigned_at.is_(None))
            .where(Incident.deleted_at.is_(None))
            .where(Event.archived_at.is_(None))
        )
        # Snapshot the values we need as plain primitives BEFORE any mutation, because
        # update_incident_status() commits and would expire these ORM instances.
        targets = [
            {
                "assignment_id": assignment.id,
                "incident_id": incident.id,
                "incident_status": incident.status,
                "incident_lat": incident.location_lat,
                "incident_lng": incident.location_lng,
                # Operators think in places, not titles — the board cards lead with the
                # address too, so the prompts and toasts use it as the incident label.
                "incident_label": incident.location_address or incident.title or "Einsatz",
                "vehicle_id": vehicle.id,
                "vehicle_name": vehicle.name,
            }
            for assignment, incident, vehicle, _event in result.all()
        ]

        arrival_keys: set = set()
        return_keys: set = set()
        actor = None  # lazily created only when an action actually fires

        for t in targets:
            vp = position_by_name.get(t["vehicle_name"].lower())

            # ---- Rule A: arrival -> disponiert -> einsatz (silent) ----
            if (
                cfg.rule_arrival_enabled
                and t["incident_status"] == "disponiert"
                and t["incident_lat"] is not None
                and t["incident_lng"] is not None
            ):
                a_key = (t["incident_id"], t["vehicle_id"])
                arrival_keys.add(a_key)
                if _arrival_fix_confirms(vp, t["incident_lat"], t["incident_lng"], cfg, now):
                    if _advance_debounce(_state.arrival, a_key, vp.last_update, cfg):
                        if cfg.rule_arrival_silent:
                            # Dangerous opt-in: silently advance without operator confirm.
                            actor = actor or await _get_system_actor(db)
                            await _fire_arrival(db, t["incident_id"], t["vehicle_name"], actor)
                        else:
                            # Default: prompt the operator to confirm; do NOT change status.
                            await _fire_arrival_prompt(
                                t["incident_id"], t["vehicle_name"], t["incident_label"],
                            )
                else:
                    # Any missing/stale/too-far/too-fast fix resets the counter so a
                    # single bad reading can never mis-advance a live incident.
                    _reset_debounce(_state.arrival, a_key)

            # ---- Rule B: return to station -> prompt operator to release ----
            # Skip incidents the operator already closed out — the release prompt
            # would only be noise there (the bell notification still covers it).
            if (
                cfg.rule_return_enabled
                and cfg.station_lat is not None
                and cfg.station_lng is not None
                and t["incident_status"] != "abschluss"
            ):
                r_key = t["assignment_id"]
                return_keys.add(r_key)
                if _return_fix_confirms(vp, cfg, now):
                    if _advance_debounce(_state.returns, r_key, vp.last_update, cfg):
                        await _fire_return_prompt(
                            t["assignment_id"], t["incident_id"], t["vehicle_id"],
                            t["vehicle_name"], t["incident_label"],
                        )
                else:
                    _reset_debounce(_state.returns, r_key)

        _state.prune(arrival_keys, return_keys)

    except Exception as e:  # never break the poll
        logger.debug("GPS automation tick failed: %s", e)


def _arrival_fix_confirms(vp, inc_lat: float, inc_lng: float, cfg: _AutomationConfig, now: datetime) -> bool:
    """True only for a fresh, slow, in-radius fix at the incident location."""
    if vp is None:
        return False
    if not _is_fresh(vp.last_update, now, cfg.freshness_seconds):
        return False
    if vp.speed is not None and vp.speed > cfg.speed_gate_kmh:
        return False
    distance = _haversine_distance_meters(
        float(vp.latitude),
        float(vp.longitude),
        float(inc_lat),
        float(inc_lng),
    )
    return distance <= cfg.arrival_radius_m


def _return_fix_confirms(vp, cfg: _AutomationConfig, now: datetime) -> bool:
    """True only for a fresh, slow fix inside the station geofence."""
    if vp is None:
        return False
    if not _is_fresh(vp.last_update, now, cfg.freshness_seconds):
        return False
    if vp.speed is not None and vp.speed > cfg.speed_gate_kmh:
        return False
    distance = _haversine_distance_meters(
        float(vp.latitude),
        float(vp.longitude),
        float(cfg.station_lat),
        float(cfg.station_lng),
    )
    return distance <= cfg.station_radius_m


async def _fire_arrival(db: AsyncSession, incident_id: uuid.UUID, vehicle_name: str, actor: User) -> None:
    """Silently advance the incident disponiert -> einsatz via the normal CRUD path."""
    logger.info(
        "GPS automation: auto-advancing incident %s to einsatz (vehicle %s at location)",
        incident_id,
        vehicle_name,
    )
    # request=None — log_action handles a missing request (no IP/user-agent captured).
    await incidents_crud.update_incident_status(
        db=db,
        incident_id=incident_id,
        new_status="einsatz",
        current_user=actor,
        request=None,
        notes=ARRIVAL_NOTE,
    )
    await broadcast_incident_update({"id": str(incident_id), "status": "einsatz"}, "update")


async def _fire_arrival_prompt(
    incident_id: uuid.UUID,
    vehicle_name: str,
    incident_label: str,
) -> None:
    """Emit an operator prompt (WebSocket) to confirm advancing the incident to einsatz.

    No DB mutation — the status change happens only if the operator confirms, via the
    existing status-transition endpoint the frontend board already uses. This is the
    DEFAULT for Rule A; silent auto-advance is an explicit opt-in (``rule_arrival_silent``).
    """
    logger.info(
        "GPS automation: vehicle %s at incident location — prompting advance of incident %s",
        vehicle_name,
        incident_id,
    )
    await broadcast_message(
        {
            "type": "gps_arrival_prompt",
            "incident_id": str(incident_id),
            "vehicle_name": vehicle_name,
            "incident_label": incident_label,
        }
    )


async def _fire_return_prompt(
    assignment_id: uuid.UUID,
    incident_id: uuid.UUID,
    vehicle_id: uuid.UUID,
    vehicle_name: str,
    incident_label: str,
) -> None:
    """Emit an operator prompt (WebSocket) to confirm releasing the returned vehicle.

    No DB mutation — the release happens only if the operator confirms, via the existing
    unassign endpoint the frontend already uses.
    """
    logger.info(
        "GPS automation: vehicle %s back at station — prompting release of assignment %s",
        vehicle_name,
        assignment_id,
    )
    await broadcast_message(
        {
            "type": "gps_release_prompt",
            "assignment_id": str(assignment_id),
            "incident_id": str(incident_id),
            "vehicle_id": str(vehicle_id),
            "vehicle_name": vehicle_name,
            "incident_label": incident_label,
        }
    )
