"""GPS-driven incident status automation (plan 10).

Runs once per Traccar poll tick (invoked from ``traccar_poller``) and implements
two rules, both opt-in behind ``gps.automation_enabled`` (default OFF):

- **Rule A — Arrival:** when an assigned vehicle's GPS device is confirmed at the
  incident location, advance the incident ``enroute → active``. By DEFAULT this only
  PROMPTS the operator to confirm (``gps_arrival_prompt``); silent auto-advance is an
  explicit opt-in via ``gps.rule_arrival_silent``. The anti-jitter guards are hard either
  way: ``N`` consecutive FRESH fixes spanning ``>= gps.min_dwell_seconds``, speed gate,
  stale/404 fixes are ignored and RESET the debounce counter, only from status exactly
  ``enroute``, one-shot per incident, fully reversible (an operator can drag it back).

- **Rule B — Return to magazin (CONFIRM-release):** when an assigned vehicle's device
  enters the magazin geofence (confirmed with the same guards), PROMPT the operator
  to release that vehicle's assignment. Never silent-release, never auto-close.

- **Rule C — Unassigned vehicle back home (INFO):** when a vehicle WITHOUT an active
  assignment (released while still in the field) is confirmed back inside the magazin
  geofence after having been observed away, create an info bell notification so the
  dispatchers know it is home. No modal, no mutation beyond the notification. Shares
  the ``gps.rule_return_enabled`` opt-in with Rule B.

Vehicles on a SIMULATED drive (Übungssteuerung, ``services/gps_simulation``) run the
prompt rules regardless of the ``gps.*`` opt-ins — the trainer explicitly started the
drive, and its arrival/release prompt is the product. Silent advance stays opt-in-only.

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
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings as app_settings
from ..crud import incidents as incidents_crud
from ..models import (
    Event,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    User,
    Vehicle,
)
from ..traccar import VehiclePosition
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
    # Rule C keyed by vehicle_id. ``unassigned_away`` records vehicles OBSERVED away
    # from the station — only those may notify on coming home, so a vehicle parked at
    # the magazin across a backend restart never produces a phantom "back" note.
    unassigned_returns: dict[uuid.UUID, _Debounce] = field(default_factory=dict)
    unassigned_away: set[uuid.UUID] = field(default_factory=set)

    def prune(
        self,
        arrival_keys: set[tuple[uuid.UUID, uuid.UUID]],
        return_keys: set[uuid.UUID],
    ) -> None:
        """Drop debounce entries whose target is no longer relevant.

        Clearing the entry also clears the one-shot ``fired`` latch, which is correct:
        once an incident leaves ``enroute`` (Rule A) or an assignment is released
        (Rule B), the target is gone and a brand-new one may legitimately fire later.
        """
        for arrival_key in list(self.arrival.keys()):
            if arrival_key not in arrival_keys:
                del self.arrival[arrival_key]
        for return_key in list(self.returns.keys()):
            if return_key not in return_keys:
                del self.returns[return_key]


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


def _advance_debounce[K](store: dict[K, _Debounce], key: K, fix_at: datetime, cfg: _AutomationConfig) -> bool:
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


def _reset_debounce[K](store: dict[K, _Debounce], key: K) -> None:
    db = store.get(key)
    if db is not None:
        db.reset()


def _rule_active(rule_enabled: bool, cfg: _AutomationConfig, vehicle_name: str, sim_names: set[str]) -> bool:
    """Whether a rule applies to this vehicle on this tick.

    Real vehicles follow the station's opt-ins (``gps.automation_enabled`` plus
    the per-rule flag). A vehicle on a SIMULATED drive (Übungssteuerung) always
    gets the prompt rules: the trainer explicitly sent it, and the whole point
    of the simulated drive is the arrival/release prompt at the end — without
    this, a station that never enabled real GPS automation had "Fahrt zu
    Einsatz" and "Rückfahrt Magazin" buttons that visibly did nothing.
    """
    return (cfg.enabled and rule_enabled) or vehicle_name.lower() in sim_names


def _suppressed_arrival_keys(
    targets: list[dict[str, Any]],
    position_by_name: dict[str, VehiclePosition],
    cfg: _AutomationConfig,
    now: datetime,
    sim_names: set[str],
) -> set[tuple[uuid.UUID, uuid.UUID]]:
    """Nearest-single-match guard for Rule A (arrival).

    One vehicle can now be assigned to MULTIPLE incidents forming a route ("Auftrag").
    When that vehicle's stops are clustered in a dense area, more than one can satisfy
    the arrival predicate on the SAME tick — which would advance / prompt every
    in-radius stop at once. Route order is only a SUGGESTION (there is no sequence
    gating), so we disambiguate purely by proximity: for a vehicle confirming arrival
    at more than one of ITS stops this tick, only the single NEAREST stop may proceed;
    the rest are returned here to be treated as not-confirming this tick (they neither
    advance nor latch, and can still fire on a later tick once they are the nearest).

    Reuses ``_arrival_fix_confirms`` and ``_haversine_distance_meters`` so no thresholds
    are duplicated. The overwhelmingly common single-in-radius case produces an empty
    set and leaves behavior identical to before.
    """
    # vehicle_id -> [(arrival_key, distance_m), ...] for stops confirming arrival this tick.
    confirming: dict[uuid.UUID, list[tuple[tuple[uuid.UUID, uuid.UUID], float]]] = {}
    for t in targets:
        if (
            not _rule_active(cfg.rule_arrival_enabled, cfg, t["vehicle_name"], sim_names)
            or t["incident_status"] != "enroute"
            or t["incident_lat"] is None
            or t["incident_lng"] is None
        ):
            continue
        vp = position_by_name.get(t["vehicle_name"].lower())
        if vp is None or not _arrival_fix_confirms(vp, t["incident_lat"], t["incident_lng"], cfg, now):
            continue
        distance = _haversine_distance_meters(
            float(vp.latitude),
            float(vp.longitude),
            float(t["incident_lat"]),
            float(t["incident_lng"]),
        )
        confirming.setdefault(t["vehicle_id"], []).append(((t["incident_id"], t["vehicle_id"]), distance))

    suppressed: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for stops in confirming.values():
        if len(stops) < 2:
            continue  # single in-radius stop — the common case, untouched
        nearest_key = min(stops, key=lambda s: s[1])[0]
        suppressed.update(key for key, _distance in stops if key != nearest_key)
    return suppressed


async def _group_vehicle_targets(db: AsyncSession) -> list[dict[str, Any]]:
    """Expand active route-level (Auftrag) vehicle assignments into arrival targets.

    A vehicle assigned to an Auftrag covers every stop of that Auftrag. Each such
    assignment expands into one target per active, located, ``enroute`` stop of
    the group, so the route vehicle advances each stop it physically reaches. The
    target dict matches the per-incident shape but is flagged ``is_group=True`` so
    return prompts point at the Auftrag unassign endpoint. Training events are
    included for the same reason as per-incident assignments.
    """
    result = await db.execute(
        select(
            IncidentGroupAssignment.id,
            Vehicle.id,
            Vehicle.name,
            IncidentGroup.id,
            IncidentGroup.name,
            IncidentGroup.event_id,
        )
        .join(IncidentGroup, IncidentGroupAssignment.incident_group_id == IncidentGroup.id)
        .join(Vehicle, IncidentGroupAssignment.resource_id == Vehicle.id)
        .join(Event, IncidentGroup.event_id == Event.id)
        .where(IncidentGroupAssignment.resource_type == "vehicle")
        .where(IncidentGroupAssignment.unassigned_at.is_(None))
        .where(IncidentGroup.deleted_at.is_(None))
        .where(Event.archived_at.is_(None))
    )
    group_rows = result.all()
    if not group_rows:
        return []

    group_ids = {row[3] for row in group_rows}

    # All active stops are needed: enroute stops feed arrival; one representative
    # stop per assignment supplies context for the route-level return prompt.
    stops_result = await db.execute(
        select(
            Incident.id,
            Incident.group_id,
            Incident.status,
            Incident.location_lat,
            Incident.location_lng,
            Incident.location_address,
            Incident.title,
        )
        .where(Incident.group_id.in_(group_ids))
        .where(Incident.deleted_at.is_(None))
        .order_by(Incident.group_position.asc())
    )
    stops_by_group: dict[uuid.UUID, list[Any]] = {}
    for stop in stops_result.all():
        stops_by_group.setdefault(stop.group_id, []).append(stop)

    targets: list[dict[str, Any]] = []
    for ga_id, vehicle_id, vehicle_name, group_id, group_name, event_id in group_rows:
        stops = stops_by_group.get(group_id, [])
        if not stops:
            targets.append(
                {
                    "assignment_id": ga_id,
                    "incident_id": None,
                    "incident_status": None,
                    "incident_lat": None,
                    "incident_lng": None,
                    "incident_label": group_name,
                    "vehicle_id": vehicle_id,
                    "vehicle_name": vehicle_name,
                    "is_group": True,
                    "group_id": group_id,
                    "event_id": event_id,
                    "return_eligible": True,
                }
            )
        for index, stop in enumerate(stops):
            targets.append(
                {
                    "assignment_id": ga_id,
                    "incident_id": stop.id,
                    "incident_status": stop.status,
                    "incident_lat": stop.location_lat,
                    "incident_lng": stop.location_lng,
                    "incident_label": stop.location_address or stop.title or "Einsatz",
                    "vehicle_id": vehicle_id,
                    "vehicle_name": vehicle_name,
                    "is_group": True,
                    "group_id": group_id,
                    "event_id": event_id,
                    "return_eligible": index == 0,
                }
            )
    return targets


async def run_automation_tick(db: AsyncSession, vehicle_positions: list[VehiclePosition]) -> None:
    """Entry point invoked once per Traccar poll tick.

    ``vehicle_positions`` is the same ``list[VehiclePosition]`` the poller already
    fetched, so this adds no extra Traccar calls. All failures are swallowed (logged at
    debug) so automation can never break the position broadcast.
    """
    try:
        if app_settings.demo_mode:
            return
        cfg = await _load_config(db)
        # Vehicles on a simulated drive (Übungssteuerung) run the prompt rules
        # regardless of the station's gps.* opt-ins — see _rule_active.
        from .gps_simulation import gps_simulation

        sim_names = {d.vehicle_name.lower() for d in gps_simulation.list_drives()}
        if not sim_names and (not cfg.enabled or not (cfg.rule_arrival_enabled or cfg.rule_return_enabled)):
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
                # Per-incident assignment: eligible for arrival (A), return (B) and
                # counts toward the "assigned" set for Rule C.
                "is_group": False,
            }
            for assignment, incident, vehicle, _event in result.all()
        ]

        # Route-level (Auftrag) vehicle assignments: a vehicle assigned to the
        # Auftrag covers EVERY one of its stops. Expansion supports arrival at each
        # stop and one route-level return prompt per group assignment.
        targets.extend(await _group_vehicle_targets(db))

        arrival_keys: set[tuple[uuid.UUID, uuid.UUID]] = set()
        return_keys: set[uuid.UUID] = set()
        actor = None  # lazily created only when an action actually fires

        # Nearest-single-match guard: if a vehicle confirms arrival at several of its
        # clustered route stops on this tick, only its nearest stop may fire (the rest
        # are suppressed and behave as not-confirming). See _suppressed_arrival_keys.
        suppressed_arrival = _suppressed_arrival_keys(targets, position_by_name, cfg, now, sim_names)

        for t in targets:
            vp = position_by_name.get(t["vehicle_name"].lower())

            # ---- Rule A: arrival -> enroute -> active (silent) ----
            if (
                _rule_active(cfg.rule_arrival_enabled, cfg, t["vehicle_name"], sim_names)
                and t["incident_status"] == "enroute"
                and t["incident_lat"] is not None
                and t["incident_lng"] is not None
            ):
                a_key = (t["incident_id"], t["vehicle_id"])
                arrival_keys.add(a_key)
                if (
                    vp is not None
                    and _arrival_fix_confirms(vp, t["incident_lat"], t["incident_lng"], cfg, now)
                    and a_key not in suppressed_arrival
                ):
                    if _advance_debounce(_state.arrival, a_key, vp.last_update, cfg):
                        # Silent advance only when the station genuinely opted in —
                        # a sim-enabled rule never silently moves a card.
                        if cfg.rule_arrival_silent and cfg.enabled and cfg.rule_arrival_enabled:
                            # Dangerous opt-in: silently advance without operator confirm.
                            actor = actor or await _get_system_actor(db)
                            await _fire_arrival(db, t["incident_id"], t["vehicle_name"], actor)
                        else:
                            # Default: prompt the operator to confirm; do NOT change status.
                            await _fire_arrival_prompt(
                                t["incident_id"],
                                t["vehicle_name"],
                                t["incident_label"],
                            )
                else:
                    # Any missing/stale/too-far/too-fast fix resets the counter so a
                    # single bad reading can never mis-advance a live incident.
                    _reset_debounce(_state.arrival, a_key)

            # ---- Rule B: return to station -> prompt operator to release ----
            # Skip incidents the operator already closed out — the release prompt
            # would only be noise there (the bell notification still covers it).
            if (
                _rule_active(cfg.rule_return_enabled, cfg, t["vehicle_name"], sim_names)
                and t.get("return_eligible", True)
                and cfg.station_lat is not None
                and cfg.station_lng is not None
                and t["incident_status"] != "complete"
            ):
                r_key = t["assignment_id"]
                return_keys.add(r_key)
                if vp is not None and _return_fix_confirms(vp, cfg, now):
                    if _advance_debounce(_state.returns, r_key, vp.last_update, cfg):
                        if t["is_group"]:
                            await _fire_group_return_prompt(
                                db,
                                t["assignment_id"],
                                t["group_id"],
                                t["event_id"],
                                t["incident_id"],
                                t["vehicle_id"],
                                t["vehicle_name"],
                                t["incident_label"],
                            )
                        else:
                            await _fire_return_prompt(
                                t["assignment_id"],
                                t["incident_id"],
                                t["vehicle_id"],
                                t["vehicle_name"],
                                t["incident_label"],
                            )
                else:
                    _reset_debounce(_state.returns, r_key)

        _state.prune(arrival_keys, return_keys)

        # ---- Rule C: unassigned vehicle back home -> info notification ----
        rule_c_configured = cfg.enabled and cfg.rule_return_enabled
        if (rule_c_configured or sim_names) and cfg.station_lat is not None and cfg.station_lng is not None:
            assigned_vehicle_ids = {t["vehicle_id"] for t in targets}
            await _watch_unassigned_returns(
                db, cfg, position_by_name, assigned_vehicle_ids, now, sim_names, rule_c_configured
            )

    except Exception as e:  # never break the poll
        logger.debug("GPS automation tick failed: %s", e)


def _arrival_fix_confirms(
    vp: VehiclePosition | None, inc_lat: float, inc_lng: float, cfg: _AutomationConfig, now: datetime
) -> bool:
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


def _return_fix_confirms(vp: VehiclePosition | None, cfg: _AutomationConfig, now: datetime) -> bool:
    """True only for a fresh, slow fix inside the station geofence."""
    if vp is None or cfg.station_lat is None or cfg.station_lng is None:
        # Without a configured station there is no geofence to be inside of. Every
        # caller already gates on this; stating it here makes the guard local.
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


async def _watch_unassigned_returns(
    db: AsyncSession,
    cfg: _AutomationConfig,
    position_by_name: dict[str, VehiclePosition],
    assigned_vehicle_ids: set[uuid.UUID],
    now: datetime,
    sim_names: set[str],
    rule_configured: bool,
) -> None:
    """Rule C: notify (info bell) when an unassigned vehicle comes home.

    State machine per vehicle: a fresh fix clearly OUTSIDE the station geofence
    (1.5x radius hysteresis) marks it "away" and re-arms; a debounce-confirmed
    fix INSIDE fires the notification once — but only if it was seen away while
    unassigned. Assigned vehicles are Rule B's business: their Rule C state is
    dropped, so a vehicle released at the magazin (via the release prompt)
    starts fresh and never double-notifies.
    """
    if cfg.station_lat is None or cfg.station_lng is None:
        return  # no station geofence configured — same gate the caller applies
    vehicles = (await db.execute(select(Vehicle))).scalars().all()
    for vehicle in vehicles:
        # Same split as the per-target rules: real vehicles need the station's
        # opt-in; a vehicle on a simulated drive is watched regardless.
        if not rule_configured and vehicle.name.lower() not in sim_names:
            continue
        if vehicle.id in assigned_vehicle_ids:
            _state.unassigned_returns.pop(vehicle.id, None)
            _state.unassigned_away.discard(vehicle.id)
            continue
        vp = position_by_name.get(vehicle.name.lower())
        if vp is None or not _is_fresh(vp.last_update, now, cfg.freshness_seconds):
            # Invisible/stale: keep state; a coverage gap must not fake a transition.
            continue
        distance = _haversine_distance_meters(
            float(vp.latitude), float(vp.longitude), float(cfg.station_lat), float(cfg.station_lng)
        )
        if distance > cfg.station_radius_m * 1.5:
            # Clearly out: arm the return watch and clear the one-shot latch by
            # dropping the debounce entirely (reset() would keep the latch).
            _state.unassigned_away.add(vehicle.id)
            _state.unassigned_returns.pop(vehicle.id, None)
        elif _return_fix_confirms(vp, cfg, now):
            # Kept nested: the `else` comment below belongs to the INNER test, and flattening
            # would attach it to the combined condition and change what it documents.
            if _advance_debounce(_state.unassigned_returns, vehicle.id, vp.last_update, cfg):  # noqa: SIM102
                if vehicle.id in _state.unassigned_away:
                    _state.unassigned_away.discard(vehicle.id)
                    await _fire_unassigned_return_notification(db, vehicle)
                # else: first sighting is already at home (e.g. after a restart) —
                # latch silently so a parked vehicle never notifies.
        else:
            # In the fuzzy zone or too fast — hold the counter, keep the latch.
            _reset_debounce(_state.unassigned_returns, vehicle.id)


async def _fire_unassigned_return_notification(db: AsyncSession, vehicle: Vehicle) -> None:
    """Create the "vehicle back home" info notification, attributed to the event
    of its most recent released assignment (that's whose dispatchers care)."""
    row = (
        await db.execute(
            select(Incident.id, Incident.event_id)
            .join(IncidentAssignment, IncidentAssignment.incident_id == Incident.id)
            .join(Event, Incident.event_id == Event.id)
            .where(IncidentAssignment.resource_type == "vehicle")
            .where(IncidentAssignment.resource_id == vehicle.id)
            .where(IncidentAssignment.unassigned_at.isnot(None))
            .where(Event.archived_at.is_(None))
            .order_by(IncidentAssignment.unassigned_at.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        # Never assigned in any open event — nobody is waiting for this vehicle.
        return
    from .notification_service import create_vehicle_returned_notification

    logger.info("GPS automation: unassigned vehicle %s back at station — notifying", vehicle.name)
    await create_vehicle_returned_notification(db, event_id=row[1], incident_id=row[0], vehicle_name=vehicle.name)


async def _fire_arrival(db: AsyncSession, incident_id: uuid.UUID, vehicle_name: str, actor: User) -> None:
    """Silently advance the incident enroute -> active via the normal CRUD path.

    …and stamp the arrival on the Schadenplatz-Rapport (§18.24). The board has
    just concluded that the crew is at the address; `/feld` must not then ask
    them to tap "Angekommen" about a fact the system already acted on.

    **Only on this path, and that is the whole point.** Rule A prompts by
    default; silent advance is an explicit opt-in (``gps.rule_arrival_silent``).
    Where the automation only *asks*, nothing is stamped — the GPS rules ask
    rather than act by design, and an operator confirming a prompt is a status
    decision, not an arrival report. Here the automation genuinely acted,
    because a station switched that on.

    Attributed to the ``gps-automation`` user — the same actor as the status
    change above — and never to a person. ``FieldActor.automation`` is what
    keeps the bell entry from reading "im KP erfasst", and readers tell the
    third provenance apart by that user id (``crud.feld.is_automation_user``).

    ``only_if_unset=True``: a crew that already tapped keeps its own name on the
    arrival. The automation never overwrites a human's report.
    """
    logger.info(
        "GPS automation: auto-advancing incident %s to einsatz (vehicle %s at location)",
        incident_id,
        vehicle_name,
    )
    # request=None — log_action handles a missing request (no IP/user-agent captured).
    incident = await incidents_crud.update_incident_status(
        db=db,
        incident_id=incident_id,
        new_status="active",
        current_user=actor,
        request=None,
        notes=ARRIVAL_NOTE,
    )
    if incident is not None:
        # Imported here rather than at module level: `crud.feld` reaches back
        # into this module for GPS_SYSTEM_USER_ID, and a pair of module-level
        # imports would close that cycle.
        from ..crud import feld as feld_crud

        await feld_crud.record_arrival(
            db,
            incident,
            actor=feld_crud.FieldActor(user=actor, automation=True),
            at=_now(),
            only_if_unset=True,
        )
    await broadcast_incident_update({"id": str(incident_id), "status": "active"}, "update")


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


async def _fire_group_return_prompt(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    group_id: uuid.UUID,
    event_id: uuid.UUID,
    incident_id: uuid.UUID | None,
    vehicle_id: uuid.UUID,
    vehicle_name: str,
    group_label: str,
) -> None:
    """Prompt release through the Auftrag unassign endpoint, not an incident one."""
    logger.info(
        "GPS automation: route vehicle %s back at station — prompting release of group assignment %s",
        vehicle_name,
        assignment_id,
    )
    await broadcast_message(
        {
            "type": "gps_group_release_prompt",
            "assignment_id": str(assignment_id),
            "group_id": str(group_id),
            "vehicle_id": str(vehicle_id),
            "vehicle_name": vehicle_name,
            "incident_label": group_label,
        }
    )
    # Existing clients always display this notification type, even before they
    # understand the Auftrag-specific release prompt above.
    from .notification_service import create_vehicle_returned_notification

    await create_vehicle_returned_notification(
        db,
        event_id=event_id,
        incident_id=incident_id,
        vehicle_name=vehicle_name,
    )
