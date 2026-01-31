"""Notification evaluation and management service."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

# Helper subquery for assigned material IDs
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Event, Incident, IncidentAssignment, Material, Notification, Personnel
from ..schemas import NotificationSettings

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

    # Data quality alerts
    if settings.enabled_data_quality_alerts:
        data_quality_notifications = await _check_data_quality_alerts(db, event_id)
        notifications.extend(data_quality_notifications)

    # Event size alerts
    if settings.enabled_event_alerts:
        event_notifications = await _check_event_size_alerts(db, event_id, settings)
        notifications.extend(event_notifications)

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
    notifications = []
    now = datetime.now(UTC)

    # Get all active incidents (not in final status)
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.status.in_(["eingegangen", "reko", "disponiert", "einsatz", "einsatz_beendet"]))
        .where(Incident.deleted_at.is_(None))
    )
    incidents = list(result.scalars().all())

    if not incidents:
        return notifications

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
        select(StatusTransition)
        .join(subquery, and_(
            StatusTransition.incident_id == subquery.c.incident_id,
            StatusTransition.timestamp == subquery.c.max_timestamp,
        ))
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
            hours = int(duration_minutes // 60)
            minutes = int(duration_minutes % 60)
            duration_str = f"{hours}h {minutes}m" if hours > 0 else f"{minutes}m"

            notifications.append(
                Notification(
                    type="time_overdue",
                    severity="warning",
                    message=f"Einsatz '{incident.title}' ist {duration_str} im Status '{incident.status}'",
                    incident_id=incident.id,
                    event_id=event_id,
                )
            )

    # Check for completed incidents not archived
    archive_threshold_minutes = settings.get_threshold_minutes("abschluss", is_training)
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.status == "einsatz_beendet")
        .where(Incident.completed_at.isnot(None))
        .where(Incident.deleted_at.is_(None))
    )
    completed_incidents = result.scalars().all()

    for incident in completed_incidents:
        if incident.completed_at:
            time_since_completion = (now - incident.completed_at).total_seconds() / 60
            if time_since_completion > archive_threshold_minutes:
                hours = int(time_since_completion // 60)
                minutes = int(time_since_completion % 60)
                duration_str = f"{hours}h {minutes}m" if hours > 0 else f"{minutes}m"

                notifications.append(
                    Notification(
                        type="time_overdue",
                        severity="warning",
                        message=f"Einsatz '{incident.title}' ist seit {duration_str} abgeschlossen, aber nicht archiviert",
                        incident_id=incident.id,
                        event_id=event_id,
                    )
                )

    return notifications


async def _check_resource_alerts(
    db: AsyncSession, event_id: UUID, settings: NotificationSettings
) -> list[Notification]:
    """Check for resource constraint alerts."""
    notifications = []

    # Check available personnel
    # Get personnel checked in for this event
    from ..models import EventAttendance

    result = await db.execute(
        select(EventAttendance).where(EventAttendance.event_id == event_id).where(EventAttendance.checked_in)
    )
    checked_in_personnel_ids = [att.personnel_id for att in result.scalars().all()]

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
        assigned_personnel_ids = set(r[0] for r in assigned_result.all())
        available_count = len(checked_in_personnel_ids) - len(assigned_personnel_ids)

        if available_count == 0:
            notifications.append(
                Notification(
                    type="no_personnel",
                    severity="critical",
                    message="Kein Personal mehr verfügbar - alle eingecheckten Personen sind zugewiesen",
                    event_id=event_id,
                )
            )

    # Check personnel fatigue (assigned > threshold hours)
    now = datetime.now(UTC)
    fatigue_threshold_minutes = settings.fatigue_hours * 60

    result = await db.execute(
        select(IncidentAssignment, Personnel.name)
        .join(Personnel, IncidentAssignment.resource_id == Personnel.id)
        .join(Incident)
        .where(Incident.event_id == event_id)
        .where(IncidentAssignment.resource_type == "personnel")
        .where(IncidentAssignment.unassigned_at.is_(None))
    )
    active_assignments = result.all()

    for assignment, personnel_name in active_assignments:
        duration_minutes = (now - assignment.assigned_at).total_seconds() / 60
        if duration_minutes > fatigue_threshold_minutes:
            hours = int(duration_minutes // 60)
            notifications.append(
                Notification(
                    type="personnel_fatigue",
                    severity="warning",
                    message=f"{personnel_name} ist seit {hours} Stunden im Einsatz",
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

        result = await db.execute(query)
        available_count = result.scalar_one()

        if available_count == 0:
            notifications.append(
                Notification(
                    type="no_materials",
                    severity="critical",
                    message=f"Keine Einheiten von '{material_location}' mehr verfügbar",
                    event_id=event_id,
                )
            )
        elif available_count <= threshold:
            notifications.append(
                Notification(
                    type="no_materials",
                    severity="warning",
                    message=f"Nur noch {available_count} Einheiten von '{material_location}' verfügbar",
                    event_id=event_id,
                )
            )

    return notifications


async def _check_data_quality_alerts(db: AsyncSession, event_id: UUID) -> list[Notification]:
    """Check for data quality issues."""
    notifications = []

    # Missing geocoded location - only check for incidents in disponiert or later status
    # (location not needed for eingegangen or reko)
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.deleted_at.is_(None))
        .where(Incident.location_lat.is_(None))
        .where(Incident.status.in_(["disponiert", "einsatz", "einsatz_beendet"]))
    )
    incidents_no_location = result.scalars().all()

    for incident in incidents_no_location:
        notifications.append(
            Notification(
                type="missing_location",
                severity="info",
                message=f"Einsatz '{incident.title}' hat keine geokodierte Position",
                incident_id=incident.id,
                event_id=event_id,
            )
        )

    return notifications


async def _check_event_size_alerts(
    db: AsyncSession, event_id: UUID, settings: NotificationSettings
) -> list[Notification]:
    """Check for event size limit warnings."""
    notifications = []

    # Note: Actual database and photo size checking would require additional implementation
    # This is a placeholder that would need to query actual sizes
    # For now, we'll skip this check as it requires external tools

    # TODO: Implement database size check
    # - Query pg_database_size for the database
    # - Compare against settings.database_size_limit_gb

    # TODO: Implement photo storage size check
    # - Calculate total size of photos directory
    # - Compare against settings.photo_size_limit_gb

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
            base_conditions.append(Notification.message == notification.message)

        # Build suppression logic based on re-alarm settings
        now = datetime.now(UTC)

        # Use longer suppression interval for fatigue warnings (2 hours instead of 30 minutes)
        # to avoid repeated alerts for the same person
        suppression_minutes = 120 if notification.type == "personnel_fatigue" else 30

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
        select(Notification)
        .where(Notification.event_id == event_id)
        .where(Notification.dismissed == False)  # noqa: E712
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
        if notification.type == "no_materials":
            if notification.message not in current_messages:
                notifications_to_resolve.append(notification)

        # For personnel fatigue, check if still in current notifications
        elif notification.type == "personnel_fatigue":
            if notification.message not in current_messages:
                notifications_to_resolve.append(notification)

        # For no_personnel alerts, check if still in current
        elif notification.type == "no_personnel":
            if notification.message not in current_messages:
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

    Returns:
        Created notification
    """
    # Build message
    relevance_text = "Einsatz relevant" if is_relevant else "Kein Einsatz nötig"
    if submitted_by_name:
        message = f"Neue Reko-Meldung von {submitted_by_name}: {incident_title} - {relevance_text}"
    else:
        message = f"Neue Reko-Meldung: {incident_title} - {relevance_text}"

    notification = Notification(
        type="reko_submitted",
        severity="info",
        message=message,
        incident_id=incident_id,
        event_id=event_id,
    )

    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    return notification


async def create_reko_arrived_notification(
    db: AsyncSession,
    incident_id: UUID,
    event_id: UUID,
    incident_title: str,
    arrived_by_name: str | None = None,
) -> Notification:
    """
    Create a notification when Reko personnel arrives on site.

    Args:
        db: Database session
        incident_id: ID of the incident the reko is for
        event_id: ID of the event
        incident_title: Title of the incident for the message
        arrived_by_name: Optional name of personnel who arrived

    Returns:
        Created notification
    """
    # Build message
    if arrived_by_name:
        message = f"REKO vor Ort: {arrived_by_name} bei {incident_title}"
    else:
        message = f"REKO vor Ort: {incident_title}"

    notification = Notification(
        type="reko_arrived",
        severity="info",
        message=message,
        incident_id=incident_id,
        event_id=event_id,
    )

    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    return notification
