"""Notification evaluation and management service."""

import json
import logging
import math
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

# Helper subquery for assigned material IDs
from sqlalchemy import and_, func, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Event, Incident, IncidentAssignment, Material, Notification, Personnel, Vehicle
from ..schemas import NotificationSettings

# Same German status labels the printed Lageblatt and the PDF report use, so a warning in the
# Warnungen panel names a status the way the rest of the app names it. Importing rather than
# re-typing them: three copies of this map is how «Reko abgeschlossen» and «reko_done» ended up
# on screen at the same time.
# Same reuse for the address: `location_display` is the label the board card
# wears (street + number, home town stripped), and a notification must name a
# Schadenplatz the way the card does — never «…strasse 8, 4104 Oberwil» about a
# card that reads «…strasse 8».
from . import notification_params as texts
from .incident_display import get_home_city, location_display
from .pdf_report_service import STATUS_LABELS

logger = logging.getLogger(__name__)

NOTIFICATION_SETTINGS_KEY = "notification_settings"


async def get_notification_settings(db: AsyncSession) -> NotificationSettings:
    """Get notification settings from database."""
    from .settings import get_setting

    settings_json = await get_setting(db, NOTIFICATION_SETTINGS_KEY)
    if settings_json:
        try:
            data = json.loads(settings_json)
            return NotificationSettings(**data)
        except (json.JSONDecodeError, ValueError):
            pass

    # Return defaults if not found or invalid
    return NotificationSettings()


async def save_notification_settings(
    db: AsyncSession, settings: NotificationSettings, user_id: UUID
) -> NotificationSettings:
    """Save notification settings to database."""
    from .settings import update_setting

    settings_json = settings.model_dump_json()
    await update_setting(db, NOTIFICATION_SETTINGS_KEY, settings_json, user_id)
    return settings


async def evaluate_notifications(db: AsyncSession, event_id: UUID) -> list[Notification]:
    """
    Evaluate all notification rules for the current event.

    Returns a list of active (non-dismissed) notifications.
    """
    notifications = []
    settings = await get_notification_settings(db)

    # Get event to check training mode
    event_result = await db.execute(select(Event).where(Event.id == event_id))
    event = event_result.scalar_one_or_none()
    if not event:
        return []

    is_training = event.training_flag

    # Time-based alerts
    if settings.enabled_time_alerts:
        time_notifications = await _check_time_based_alerts(db, event_id, is_training, settings)
        notifications.extend(time_notifications)

    # Resource alerts
    if settings.enabled_resource_alerts:
        resource_notifications = await _check_resource_alerts(db, event_id, settings)
        notifications.extend(resource_notifications)

    # Time on duty: ONE notification for the whole crew, kept up to date in place rather
    # than created per person (see `_sync_fatigue_notification`). It is a resource alert,
    # so switching those off resolves it like the others.
    await _sync_fatigue_notification(db, event_id, settings, enabled=settings.enabled_resource_alerts)

    # Data quality alerts
    if settings.enabled_data_quality_alerts:
        data_quality_notifications = await _check_data_quality_alerts(db, event_id)
        notifications.extend(data_quality_notifications)

    # Event size alerts
    if settings.enabled_event_alerts:
        event_notifications = await _check_event_size_alerts(db, event_id, settings)
        notifications.extend(event_notifications)

    # Geofence alerts (vehicle arrived at incident)
    if settings.enabled_geofence_alerts:
        geofence_notifications = await _check_geofence_alerts(db, event_id, settings)
        notifications.extend(geofence_notifications)

    # Deduplicate and save new notifications
    await _deduplicate_and_save(db, notifications, event_id)

    # Auto-resolve notifications whose conditions are no longer true
    await _auto_resolve_stale_notifications(db, event_id, notifications, settings)

    # Return all active notifications AND recently dismissed ones (last 20 from last 24 hours)
    # This ensures the frontend can show history while preventing stale dismissed notifications
    twenty_four_hours_ago = datetime.now(UTC) - timedelta(hours=24)

    # Get active notifications
    active_result = await db.execute(
        select(Notification)
        .where(Notification.event_id == event_id)
        .where(Notification.dismissed == False)  # noqa: E712
        .order_by(Notification.created_at.desc())
    )
    active_notifications = list(active_result.scalars().all())

    # Get recently dismissed notifications (last 20)
    dismissed_result = await db.execute(
        select(Notification)
        .where(Notification.event_id == event_id)
        .where(Notification.dismissed)
        .where(Notification.dismissed_at >= twenty_four_hours_ago)
        .order_by(Notification.dismissed_at.desc())
        .limit(20)
    )
    dismissed_notifications = list(dismissed_result.scalars().all())

    # Combine and return
    return active_notifications + dismissed_notifications


async def _check_time_based_alerts(
    db: AsyncSession, event_id: UUID, is_training: bool, settings: NotificationSettings
) -> list[Notification]:
    """Check for time-based alerts on incidents."""
    notifications: list[Notification] = []
    now = datetime.now(UTC)

    # Get all active incidents (not in final status)
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.status.in_(["incoming", "reko", "reko_done", "enroute", "active", "returning"]))
        .where(Incident.deleted_at.is_(None))
    )
    incidents = list(result.scalars().all())

    if not incidents:
        return notifications

    # One home-city read for the whole sweep; every message below names its
    # incident by the short address, the way the board card does.
    home_city = await get_home_city(db)

    # OPTIMIZATION: Batch query all status transitions at once instead of N queries
    # Get the most recent transition to current status for all incidents in one query

    from ..models import StatusTransition

    incident_ids = [i.id for i in incidents]

    # Get latest transitions for each incident matching their current status
    # Uses a correlated subquery to find the max timestamp per incident
    subquery = (
        select(
            StatusTransition.incident_id,
            func.max(StatusTransition.timestamp).label("max_timestamp"),
        )
        .where(StatusTransition.incident_id.in_(incident_ids))
        .group_by(StatusTransition.incident_id)
        .subquery()
    )

    transitions_result = await db.execute(
        select(StatusTransition).join(
            subquery,
            and_(
                StatusTransition.incident_id == subquery.c.incident_id,
                StatusTransition.timestamp == subquery.c.max_timestamp,
            ),
        )
    )
    transitions = {str(t.incident_id): t for t in transitions_result.scalars().all()}

    for incident in incidents:
        # Use transition time if available and matches current status, else use creation time
        transition = transitions.get(str(incident.id))
        if transition and transition.to_status == incident.status:
            status_start = transition.timestamp
        else:
            status_start = incident.created_at

        duration_minutes = (now - status_start).total_seconds() / 60

        # Get threshold for this status
        threshold_minutes = settings.get_threshold_minutes(incident.status, is_training)

        if duration_minutes > threshold_minutes:
            message, params = texts.time_in_status(
                location_display(incident.location_address, home_city) or incident.title,
                int(duration_minutes),
                incident.status,
                STATUS_LABELS.get(incident.status, incident.status),
            )
            notifications.append(
                Notification(
                    type="time_overdue",
                    severity="warning",
                    message=message,
                    params=params,
                    incident_id=incident.id,
                    event_id=event_id,
                )
            )

    # Check for completed incidents not archived
    archive_threshold_minutes = settings.get_threshold_minutes("complete", is_training)
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.status == "returning")
        .where(Incident.completed_at.isnot(None))
        .where(Incident.deleted_at.is_(None))
    )
    completed_incidents = result.scalars().all()

    for incident in completed_incidents:
        if incident.completed_at:
            time_since_completion = (now - incident.completed_at).total_seconds() / 60
            if time_since_completion > archive_threshold_minutes:
                message, params = texts.time_not_archived(
                    location_display(incident.location_address, home_city) or incident.title,
                    int(time_since_completion),
                )
                notifications.append(
                    Notification(
                        type="time_overdue",
                        severity="warning",
                        message=message,
                        params=params,
                        incident_id=incident.id,
                        event_id=event_id,
                    )
                )

    return notifications


async def _check_resource_alerts(
    db: AsyncSession, event_id: UUID, settings: NotificationSettings
) -> list[Notification]:
    """Check for resource constraint alerts."""
    notifications: list[Notification] = []

    # Check available personnel
    # Get personnel checked in for this event
    from ..models import EventAttendance

    attendance_result = await db.execute(
        select(EventAttendance).where(EventAttendance.event_id == event_id).where(EventAttendance.checked_in)
    )
    checked_in_personnel_ids = [att.personnel_id for att in attendance_result.scalars().all()]

    if checked_in_personnel_ids:
        # Check how many are available (not assigned)
        assigned_result = await db.execute(
            select(IncidentAssignment.resource_id)
            .join(Incident)
            .where(Incident.event_id == event_id)
            .where(IncidentAssignment.resource_type == "personnel")
            .where(IncidentAssignment.unassigned_at.is_(None))
            .where(IncidentAssignment.resource_id.in_(checked_in_personnel_ids))
            .distinct()
        )
        assigned_personnel_ids = {r[0] for r in assigned_result.all()}
        available_count = len(checked_in_personnel_ids) - len(assigned_personnel_ids)

        if available_count == 0:
            message, params = texts.no_personnel()
            notifications.append(
                Notification(
                    type="no_personnel",
                    severity="critical",
                    message=message,
                    params=params,
                    event_id=event_id,
                )
            )

    # Check material depletion by location (e.g., 'Depot', 'TLF', 'MoWa')
    # Skip material locations with threshold -1 (disabled)
    # Note: Material.status tracks if the item is broken/unavailable, NOT if it's assigned.
    # Assignments are tracked in the incident_assignments table, so we need to exclude
    # materials that have active assignments to get the truly available count.

    # OPTIMIZATION: Query assigned material IDs once, before the loop
    # instead of querying for each location (was N+1 query pattern)
    assigned_material_ids_result = await db.execute(
        select(IncidentAssignment.resource_id).where(
            and_(
                IncidentAssignment.resource_type == "material",
                IncidentAssignment.unassigned_at.is_(None),  # Active assignment
            )
        )
    )
    assigned_material_ids = {row[0] for row in assigned_material_ids_result.all()}

    for material_location, threshold in settings.material_depletion_threshold.items():
        # Skip if notifications disabled for this location (threshold = -1)
        if threshold < 0:
            continue

        # Count materials that are:
        # 1. In this location
        # 2. Have status 'available' (not broken/unavailable)
        # 3. NOT currently assigned to any incident
        query = (
            select(func.count(Material.id))
            .where(Material.location == material_location)
            .where(Material.status == "available")
        )
        if assigned_material_ids:
            query = query.where(Material.id.notin_(assigned_material_ids))

        count_result = await db.execute(query)
        available_count = count_result.scalar_one()

        if available_count <= threshold:  # threshold >= 0 here, so 0 always lands here (critical)
            message, params = texts.materials(material_location, available_count)
            notifications.append(
                Notification(
                    type="no_materials",
                    severity="critical" if available_count == 0 else "warning",
                    message=message,
                    params=params,
                    event_id=event_id,
                )
            )

    return notifications


def fatigue_message(over: list[tuple[str, int]], fatigue_hours: int) -> str:
    """The German sentence of the grouped time-on-duty notification (`notification_params.fatigue`)."""
    return texts.fatigue(over, fatigue_hours)[0]


def fatigue_subject_key(personnel_id: UUID, checked_in_at: datetime) -> str:
    """One person's shift, as the grouped fatigue row records it (`Notification.subject_keys`).

    The check-in stamp is part of the key on purpose: somebody who went home and came back
    starts a new shift, and reaching the threshold again is news even if their previous
    warning was dismissed.
    """
    return f"{personnel_id}@{checked_in_at.astimezone(UTC).isoformat()}"


async def _sync_fatigue_notification(
    db: AsyncSession, event_id: UUID, settings: NotificationSettings, *, enabled: bool = True
) -> Notification | None:
    """Keep the ONE time-on-duty notification of this Ereignis in step with the crew.

    Time on duty is measured from ``EventAttendance.checked_in_at`` — when the person
    arrived, not when their current assignment began. It used to be the latter, so moving
    somebody to another Schadenplatz reset their clock to zero, and the person who had
    worked three incidents back to back never reached the threshold. It also emitted one
    warning per person, whose text changed with every hour, so a long night rang the bell
    for each name every hour.

    Now:
    - Everybody checked in for at least ``fatigue_hours`` is named in one notification,
      whose ``subject_keys`` record exactly who (one key per person and shift).
    - While it is open, it is rewritten in place (same id: no new toast, no new bell row).
    - Dismissing it acknowledges the people it named at that moment — nobody else. A NEW
      one is raised as soon as anybody past the threshold is not among the acknowledged
      keys (crossed later, a lowered threshold, a new shift) — or, with re-alarming
      switched on, once that interval has passed since the last dismissal. Rows from
      before the grouping carry no keys and acknowledge nobody.
    - When nobody is past the threshold any more (checked out), it resolves itself.

    Every board evaluates this on its own poll, so the whole read-decide-write runs under a
    transaction-scoped advisory lock per Ereignis: two concurrent evaluations would
    otherwise both find no open row and both insert one (two rows, two toasts).

    ``fatigue_hours`` <= 0 switches the check off. Returns the open notification, if any.
    """
    await db.execute(sa_text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"personnel_fatigue:{event_id}"})
    try:
        notification = await _sync_fatigue_locked(db, event_id, settings, enabled=enabled)
        await db.commit()  # also releases the lock
    except Exception:
        await db.rollback()
        raise
    return notification


async def _sync_fatigue_locked(
    db: AsyncSession, event_id: UUID, settings: NotificationSettings, *, enabled: bool
) -> Notification | None:
    from ..models import EventAttendance

    now = datetime.now(UTC)
    threshold_minutes = settings.fatigue_hours * 60

    over: list[tuple[str, int]] = []
    keys: list[str] = []
    if enabled and threshold_minutes > 0:
        rows = await db.execute(
            select(Personnel.id, Personnel.name, EventAttendance.checked_in_at)
            .join(Personnel, EventAttendance.personnel_id == Personnel.id)
            .where(EventAttendance.event_id == event_id)
            .where(EventAttendance.checked_in)
            .where(EventAttendance.checked_in_at.isnot(None))
        )
        people = []
        for personnel_id, name, checked_in_at in rows.all():
            minutes = int((now - checked_in_at).total_seconds() // 60)
            if minutes >= threshold_minutes:
                people.append((name, minutes, fatigue_subject_key(personnel_id, checked_in_at)))
        # Longest on duty first, then by name, so the sentence does not reshuffle.
        people.sort(key=lambda item: (-item[1], item[0]))
        over = [(name, minutes) for name, minutes, _ in people]
        keys = [key for _, _, key in people]

    active_result = await db.execute(
        select(Notification)
        .where(Notification.event_id == event_id)
        .where(Notification.type == "personnel_fatigue")
        .where(Notification.dismissed == False)  # noqa: E712
        .order_by(Notification.created_at.desc())
    )
    active = list(active_result.scalars().all())

    if not over:
        # Condition gone: auto-resolve (dismissed_by stays NULL, like every auto-resolve).
        for stale in active:
            stale.dismissed = True
            stale.dismissed_at = now
        return None

    message, params = texts.fatigue(over, settings.fatigue_hours)

    if active:
        current, *extra = active
        # Rows from before the grouping (one per person) fold into the newest one.
        for stale in extra:
            stale.dismissed = True
            stale.dismissed_at = now
        # Text, params and keys together: a dismissal acknowledges what the row said, and a
        # row written before `params` existed gets them on its next rewrite.
        if current.message != message or current.params != params or current.subject_keys != keys:
            current.message = message
            current.params = params
            current.subject_keys = keys
        return current

    # Who has been acknowledged: the people named by every row an operator dismissed.
    # Auto-resolved rows (dismissed_by NULL) acknowledge nobody; pre-grouping rows have no keys.
    dismissed_rows = (
        await db.execute(
            select(Notification.subject_keys, Notification.dismissed_at)
            .where(Notification.event_id == event_id)
            .where(Notification.type == "personnel_fatigue")
            .where(Notification.dismissed)
            .where(Notification.dismissed_by.isnot(None))
            .where(Notification.subject_keys.isnot(None))
        )
    ).all()
    acknowledged = {key for row_keys, _ in dismissed_rows for key in (row_keys or [])}
    if all(key in acknowledged for key in keys):
        last_dismissed_at = max((at for _, at in dismissed_rows if at is not None), default=None)
        re_alarm_due = (
            settings.re_alarm_interval_min > 0
            and last_dismissed_at is not None
            and now - last_dismissed_at >= timedelta(minutes=settings.re_alarm_interval_min)
        )
        if not re_alarm_due:
            return None

    notification = Notification(
        type="personnel_fatigue",
        severity="warning",
        message=message,
        params=params,
        subject_keys=keys,
        event_id=event_id,
    )
    db.add(notification)
    await db.flush()
    return notification


async def _check_data_quality_alerts(db: AsyncSession, event_id: UUID) -> list[Notification]:
    """Check for data quality issues."""
    notifications = []

    # Missing geocoded location - only check for incidents in enroute or later status
    # (location not needed for incoming or reko)
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.deleted_at.is_(None))
        .where(Incident.location_lat.is_(None))
        .where(Incident.status.in_(["enroute", "active", "returning"]))
    )
    incidents_no_location = result.scalars().all()

    for incident in incidents_no_location:
        message, params = texts.missing_location(incident.title)
        notifications.append(
            Notification(
                type="missing_location",
                severity="info",
                message=message,
                params=params,
                incident_id=incident.id,
                event_id=event_id,
            )
        )

    return notifications


async def _check_event_size_alerts(
    db: AsyncSession, event_id: UUID, settings: NotificationSettings
) -> list[Notification]:
    """Warn when measured storage exceeds the limits configured in the Warnungen settings.

    Two independent measurements — the Postgres database and the photo storage tree — because
    on a station box they can sit on different filesystems (see `storage_usage`). A limit of
    0 or less means «no alarm»: the operator's way of switching one of the two off without
    switching off the whole event-alert category.

    Measurement is cached process-wide, so the ~10 s notification poll does not re-walk the
    photo directory for every connected board.
    """
    notifications: list[Notification] = []

    db_limit_gb = settings.database_size_limit_gb
    photo_limit_gb = settings.photo_size_limit_gb

    # Both off — don't pay for a measurement nobody asked for.
    if db_limit_gb <= 0 and photo_limit_gb <= 0:
        return notifications

    from .storage_usage import BYTES_PER_GB, get_storage_usage

    usage = await get_storage_usage(db)

    # An unmeasurable value stays silent. Reporting «0 GB» would be a false all-clear, and
    # inventing an alarm out of a failed stat would be worse.
    if db_limit_gb > 0 and usage.database_bytes is not None and usage.database_bytes > db_limit_gb * BYTES_PER_GB:
        message, params = texts.storage_limit("database", usage.database_bytes, db_limit_gb)
        notifications.append(
            Notification(
                type="event_size_limit",
                severity="warning",
                message=message,
                params=params,
                event_id=event_id,
            )
        )

    if photo_limit_gb > 0 and usage.photo_bytes is not None and usage.photo_bytes > photo_limit_gb * BYTES_PER_GB:
        message, params = texts.storage_limit("photos", usage.photo_bytes, photo_limit_gb)
        notifications.append(
            Notification(
                type="event_size_limit",
                severity="warning",
                message=message,
                params=params,
                event_id=event_id,
            )
        )

    return notifications


def _haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on Earth in meters."""
    earth_radius = 6_371_000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return earth_radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _check_geofence_alerts(
    db: AsyncSession, event_id: UUID, settings: NotificationSettings
) -> list[Notification]:
    """
    Check if any GPS-tracked vehicle is within the geofence radius of its assigned incident.

    Fires once per vehicle+incident assignment (deduplication handled by _deduplicate_and_save).
    """
    notifications: list[Notification] = []

    try:
        from ..traccar import VehiclePosition
        from .traccar_poller import traccar_poller

        # Read the poller's last broadcast instead of calling Traccar from here. This runs inside
        # GET /api/notifications/, which holds a pooled DB connection for its whole duration and
        # is polled every 10 s by every connected board — so an unreachable Traccar parked one
        # connection per client per round and emptied the pool in well under a minute. The poller
        # fetches on that same 10 s cadence anyway; this just reads the result.
        #
        # Worth stating, because it is a behaviour change: geofence alerts now come from exactly
        # the position stream the board is drawing. No stream — GPS unconfigured, no simulation
        # running, or the poll failing — means no geofence alerts, rather than alerts computed
        # from a second, independently-timed fetch that could disagree with the map. The poller
        # covers the simulation-only case too (`start_polling`), so no separate check here.
        positions = traccar_poller.cached_positions()
        if not positions:
            return notifications

        # Build a map of vehicle name (lowercase) → position
        position_by_name: dict[str, VehiclePosition] = {}
        for pos in positions:
            position_by_name[pos.device_name.lower()] = pos

        # Get active vehicle assignments for this event
        result = await db.execute(
            select(IncidentAssignment, Incident, Vehicle)
            .join(Incident, IncidentAssignment.incident_id == Incident.id)
            .join(Vehicle, IncidentAssignment.resource_id == Vehicle.id)
            .where(Incident.event_id == event_id)
            .where(IncidentAssignment.resource_type == "vehicle")
            .where(IncidentAssignment.unassigned_at.is_(None))
            .where(Incident.deleted_at.is_(None))
            .where(Incident.status.in_(["enroute", "active"]))
            .where(Incident.location_lat.isnot(None))
            .where(Incident.location_lng.isnot(None))
        )
        assignments = result.all()

        home_city = await get_home_city(db) if assignments else ""

        for _assignment, incident, vehicle in assignments:
            vp = position_by_name.get(vehicle.name.lower())
            if vp is None:
                continue

            distance = _haversine_distance_meters(
                float(vp.latitude),
                float(vp.longitude),
                float(incident.location_lat),
                float(incident.location_lng),
            )

            if distance <= settings.geofence_radius_meters:
                message, params = texts.vehicle_on_site(
                    vehicle.name, location_display(incident.location_address, home_city) or incident.title or "Einsatz"
                )
                notifications.append(
                    Notification(
                        type="vehicle_arrived",
                        severity="info",
                        message=message,
                        params=params,
                        incident_id=incident.id,
                        event_id=event_id,
                    )
                )

    except Exception as e:
        # Don't let Traccar failures break the entire notification evaluation
        logger.debug("Geofence check failed: %s", e)

    return notifications


async def _deduplicate_and_save(
    db: AsyncSession, new_notifications: list[Notification], event_id: UUID
) -> list[Notification]:
    """
    Deduplicate notifications and save only new ones.

    A notification is considered duplicate based on:
    - Same type, incident_id, and event_id
    - For active (non-dismissed) notifications: suppress if created within last 30 minutes
    - For dismissed notifications:
      - If re_alarm_interval_min = 0 (default): NEVER re-create (permanent suppression)
      - If re_alarm_interval_min > 0: suppress only within the configured interval

    This ensures dismissed notifications don't re-appear unless re-alarming is explicitly enabled.
    """
    if not new_notifications:
        return []

    # Get notification settings to check re-alarm configuration
    settings = await get_notification_settings(db)
    re_alarm_enabled = settings.re_alarm_interval_min > 0

    saved = []

    for notification in new_notifications:
        from sqlalchemy import and_, or_

        # Base query for matching notification type and event
        base_conditions = [
            Notification.type == notification.type,
            Notification.event_id == event_id,
        ]

        # Add incident_id matching
        if notification.incident_id:
            base_conditions.append(Notification.incident_id == notification.incident_id)
        else:
            base_conditions.append(Notification.incident_id.is_(None))

        # For event-level notifications (no incident_id), also match on message
        # This prevents e.g. a dismissed "Depot" notification from suppressing a new "TLF" notification
        if not notification.incident_id:
            if notification.type == "event_size_limit":
                # Storage warnings carry a live measurement ("4,7 GB belegt") that grows
                # between polls, so an exact message match would never find the previous one
                # and the bell would ring on every 10 s cycle. Match on the stable label
                # before the colon instead — that still keeps the database warning and the
                # photo warning apart, which is the reason the message is matched at all.
                base_conditions.append(Notification.message.startswith(notification.message.split(":", 1)[0]))
            else:
                base_conditions.append(Notification.message == notification.message)

        # Build suppression logic based on re-alarm settings
        now = datetime.now(UTC)

        # Use a longer suppression interval where the condition is slow-moving and repeating
        # it is pure noise: a full disk (6 h — nobody frees storage mid-incident, and the
        # condition persists until someone acts on it).
        # (`personnel_fatigue` no longer passes through here — `_sync_fatigue_notification`.)
        suppression_by_type = {"event_size_limit": 360}
        suppression_minutes = suppression_by_type.get(notification.type, 30)

        if re_alarm_enabled:
            # Re-alarming enabled: suppress both active and dismissed notifications within intervals
            active_suppression = now - timedelta(minutes=suppression_minutes)
            dismissed_suppression = now - timedelta(minutes=settings.re_alarm_interval_min)

            suppression_conditions = or_(
                # Active notifications created recently
                and_(Notification.dismissed == False, Notification.created_at >= active_suppression),  # noqa: E712
                # Dismissed notifications within re-alarm interval
                and_(
                    Notification.dismissed,
                    Notification.dismissed_at.isnot(None),
                    Notification.dismissed_at >= dismissed_suppression,
                ),
            )
        else:
            # Re-alarming disabled (default): suppress active notifications AND any dismissed notification
            active_suppression = now - timedelta(minutes=suppression_minutes)

            suppression_conditions = or_(
                # Active notifications created recently
                and_(Notification.dismissed == False, Notification.created_at >= active_suppression),  # noqa: E712
                # ANY dismissed notification (permanent suppression)
                Notification.dismissed,
            )

        query = select(Notification).where(and_(*base_conditions, suppression_conditions))

        result = await db.execute(query)
        existing = result.scalars().first()

        if not existing:
            # New notification - save it
            db.add(notification)
            saved.append(notification)

    if saved:
        await db.commit()
        for notification in saved:
            await db.refresh(notification)

    return saved


async def _auto_resolve_stale_notifications(
    db: AsyncSession,
    event_id: UUID,
    current_notifications: list[Notification],
    settings: NotificationSettings,
) -> None:
    """
    Auto-resolve notifications whose conditions are no longer true.

    This provides better UX by automatically clearing notifications when the underlying
    issue is fixed (e.g., materials unassigned, personnel fatigue resolved).
    """
    # Get all active (non-dismissed) notifications for this event
    result = await db.execute(
        select(Notification).where(Notification.event_id == event_id).where(Notification.dismissed == False)  # noqa: E712
    )
    active_notifications = list(result.scalars().all())

    if not active_notifications:
        return

    # Build a set of messages from current (still-valid) notifications
    current_messages = {n.message for n in current_notifications}

    # Check each active notification to see if its condition is still true
    notifications_to_resolve = []
    for notification in active_notifications:
        # For material depletion notifications, check if the message is still in the current set
        # If not, the condition has been resolved (materials back above threshold)
        # `personnel_fatigue` is resolved by `_sync_fatigue_notification`: its message is
        # rewritten in place as people cross the threshold, so «not in the current set» says
        # nothing about it.
        if notification.type in ("no_materials", "no_personnel") and notification.message not in current_messages:
            notifications_to_resolve.append(notification)

    # Auto-dismiss resolved notifications
    if notifications_to_resolve:
        now = datetime.now(UTC)
        for notification in notifications_to_resolve:
            notification.dismissed = True
            notification.dismissed_at = now
            # dismissed_by is None for auto-resolved notifications
        await db.commit()


async def dismiss_notification(db: AsyncSession, notification_id: UUID, user_id: UUID) -> Notification | None:
    """Dismiss a notification."""
    result = await db.execute(select(Notification).where(Notification.id == notification_id))
    notification = result.scalar_one_or_none()

    if notification:
        notification.dismissed = True
        notification.dismissed_at = datetime.now(UTC)
        notification.dismissed_by = user_id
        await db.commit()
        await db.refresh(notification)

    return notification


async def create_reko_notification(
    db: AsyncSession,
    incident_id: UUID,
    event_id: UUID,
    incident_title: str,
    is_relevant: bool,
    submitted_by_name: str | None = None,
    incident_address: str | None = None,
    danger_types: list[str] | None = None,
    personnel_count: int | None = None,
    estimated_duration: float | None = None,
) -> Notification:
    """
    Create a notification for a new Reko report submission.

    Args:
        db: Database session
        incident_id: ID of the incident the reko is for
        event_id: ID of the event
        incident_title: Title of the incident for the message
        is_relevant: Whether the reko found the incident relevant
        submitted_by_name: Optional name of personnel who submitted
        incident_address: Location address for identification
        danger_types: The danger flags found — ``RekoReport.dangers_json`` KEYS
            (``fire``, ``chemical``, …), not labels: the client names them per locale.
        personnel_count: Estimated personnel needed
        estimated_duration: Estimated duration in hours

    Returns:
        Created notification
    """
    # Use the short address as primary identifier — same label as the card.
    location = location_display(incident_address, await get_home_city(db)) or incident_title
    message, params = texts.reko_submitted(
        location, submitted_by_name, is_relevant, personnel_count, estimated_duration, danger_types or []
    )

    notification = Notification(
        type="reko_submitted",
        severity="info",
        message=message,
        params=params,
        incident_id=incident_id,
        event_id=event_id,
    )

    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    # Broadcast via WebSocket so frontends update immediately
    from ..websocket_manager import broadcast_notification_update

    await broadcast_notification_update(
        {"id": str(notification.id), "type": notification.type, "incident_id": str(incident_id)},
        "create",
    )

    return notification


async def create_vehicle_returned_notification(
    db: AsyncSession,
    event_id: UUID,
    incident_id: UUID | None,
    vehicle_name: str,
) -> Notification | None:
    """Info bell when a vehicle is confirmed back at the magazin.

    Used for unassigned vehicles and as a fallback for Auftrag release prompts.
    Deduped against a recent identical note so GPS automation
    restarts or geofence-edge flaps can't spam the bell. The window is short on
    purpose: a shuttle run (drop people off, return) can legitimately bring the
    same vehicle home again within minutes and must notify each time.
    """
    message, params = texts.vehicle_returned(vehicle_name)

    recent = await db.execute(
        select(Notification.id)
        .where(Notification.type == "vehicle_arrived")
        .where(Notification.message == message)
        .where(Notification.dismissed.is_(False))
        .where(Notification.created_at >= datetime.now(UTC) - timedelta(minutes=2))
        .limit(1)
    )
    if recent.first() is not None:
        return None

    notification = Notification(
        type="vehicle_arrived",
        severity="info",
        message=message,
        params=params,
        incident_id=incident_id,
        event_id=event_id,
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    from ..websocket_manager import broadcast_notification_update

    await broadcast_notification_update(
        {"id": str(notification.id), "type": notification.type, "event_id": str(event_id)},
        "create",
    )
    return notification


async def create_field_notification(
    db: AsyncSession,
    *,
    notification_type: str,
    incident_id: UUID,
    event_id: UUID,
    message: str,
    params: dict[str, Any] | None = None,
    severity: str = "info",
) -> Notification:
    """Bell entry for a `/feld` field report (plan 25).

    One helper for all five field types rather than five near-identical
    functions: the only thing that differs between them is the message and
    params the caller has already built (`notification_params`) and the severity. ``field_pickup`` is the one that
    is a `warning` — a crew waiting to be collected is the single field event
    that is time-critical for the KP; the rest are `info`.

    No dedup window. Unlike ``vehicle_arrived`` (a geofence that can flap),
    every one of these is a deliberate human tap, and swallowing a second one
    would swallow a second crew reporting from the same Schadenplatz.
    """
    notification = Notification(
        type=notification_type,
        severity=severity,
        message=message,
        params=params,
        incident_id=incident_id,
        event_id=event_id,
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    from ..websocket_manager import broadcast_notification_update

    await broadcast_notification_update(
        {"id": str(notification.id), "type": notification.type, "incident_id": str(incident_id)},
        "create",
    )

    return notification


async def create_feld_code_rotated_notification(db: AsyncSession, event: Event) -> Notification:
    """Bell entry: the Feld-Code was rotated because it was being guessed.

    A ``warning``, not ``info``: from this moment every phone that has not
    unlocked yet needs the NEW four digits, and the only people who can hand
    them out are the ones reading this. The new code itself is deliberately
    not in the message — the bell is readable by viewers too, and the code is
    one click away in «Links & QR».

    Event-level (no incident).
    """
    message, params = texts.feld_code_rotated(event.name)
    notification = Notification(
        type="feld_code_rotated",
        severity="warning",
        message=message,
        params=params,
        incident_id=None,
        event_id=event.id,
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    from ..websocket_manager import broadcast_notification_update

    await broadcast_notification_update(
        {"id": str(notification.id), "type": notification.type, "event_id": str(event.id)},
        "create",
    )
    return notification


async def create_reko_arrived_notification(
    db: AsyncSession,
    incident_id: UUID,
    event_id: UUID,
    incident_title: str,
    arrived_by_name: str | None = None,
    incident_address: str | None = None,
) -> Notification:
    """
    Create a notification when Reko personnel arrives on site.

    Args:
        db: Database session
        incident_id: ID of the incident the reko is for
        event_id: ID of the event
        incident_title: Title of the incident for the message
        arrived_by_name: Optional name of personnel who arrived
        incident_address: Location address for identification

    Returns:
        Created notification
    """
    # Use the short address as primary identifier, fall back to title
    location = location_display(incident_address, await get_home_city(db)) or incident_title
    message, params = texts.reko_arrived(location, arrived_by_name)

    notification = Notification(
        type="reko_arrived",
        severity="info",
        message=message,
        params=params,
        incident_id=incident_id,
        event_id=event_id,
    )

    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    # Broadcast via WebSocket so frontends update immediately
    from ..websocket_manager import broadcast_notification_update

    await broadcast_notification_update(
        {"id": str(notification.id), "type": notification.type, "incident_id": str(incident_id)},
        "create",
    )

    return notification
