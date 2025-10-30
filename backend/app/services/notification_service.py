"""Notification evaluation and management service."""

import json
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Event, Incident, IncidentAssignment, Material, Notification, Personnel, Vehicle
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
    db: AsyncSession,
    settings: NotificationSettings,
    user_id: UUID
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
        time_notifications = await _check_time_based_alerts(
            db, event_id, is_training, settings
        )
        notifications.extend(time_notifications)

    # Resource alerts
    if settings.enabled_resource_alerts:
        resource_notifications = await _check_resource_alerts(
            db, event_id, settings
        )
        notifications.extend(resource_notifications)

    # Data quality alerts
    if settings.enabled_data_quality_alerts:
        data_quality_notifications = await _check_data_quality_alerts(
            db, event_id
        )
        notifications.extend(data_quality_notifications)

    # Event size alerts
    if settings.enabled_event_alerts:
        event_notifications = await _check_event_size_alerts(
            db, event_id, settings
        )
        notifications.extend(event_notifications)

    # Deduplicate and save new notifications
    saved_notifications = await _deduplicate_and_save(db, notifications, event_id)

    # Return all active notifications AND recently dismissed ones (last 20 from last 24 hours)
    # This ensures the frontend can show history while preventing stale dismissed notifications
    twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)

    # Get active notifications
    active_result = await db.execute(
        select(Notification)
        .where(Notification.event_id == event_id)
        .where(Notification.dismissed == False)
        .order_by(Notification.created_at.desc())
    )
    active_notifications = list(active_result.scalars().all())

    # Get recently dismissed notifications (last 20)
    dismissed_result = await db.execute(
        select(Notification)
        .where(Notification.event_id == event_id)
        .where(Notification.dismissed == True)
        .where(Notification.dismissed_at >= twenty_four_hours_ago)
        .order_by(Notification.dismissed_at.desc())
        .limit(20)
    )
    dismissed_notifications = list(dismissed_result.scalars().all())

    # Combine and return
    return active_notifications + dismissed_notifications


async def _check_time_based_alerts(
    db: AsyncSession,
    event_id: UUID,
    is_training: bool,
    settings: NotificationSettings
) -> list[Notification]:
    """Check for time-based alerts on incidents."""
    notifications = []
    now = datetime.now(timezone.utc)

    # Get all active incidents (not in final status)
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.status.in_(["eingegangen", "reko", "disponiert", "einsatz", "einsatz_beendet"]))
        .where(Incident.deleted_at.is_(None))
    )
    incidents = result.scalars().all()

    for incident in incidents:
        # Get the most recent status transition to determine how long in current status
        from ..models import StatusTransition
        transition_result = await db.execute(
            select(StatusTransition)
            .where(StatusTransition.incident_id == incident.id)
            .where(StatusTransition.to_status == incident.status)
            .order_by(StatusTransition.timestamp.desc())
            .limit(1)
        )
        last_transition = transition_result.scalar_one_or_none()

        # Use transition time or incident creation time
        status_start = last_transition.timestamp if last_transition else incident.created_at
        duration_minutes = (now - status_start).total_seconds() / 60

        # Get threshold for this status
        threshold_minutes = settings.get_threshold_minutes(incident.status, is_training)

        if duration_minutes > threshold_minutes:
            hours = int(duration_minutes // 60)
            minutes = int(duration_minutes % 60)
            duration_str = f"{hours}h {minutes}m" if hours > 0 else f"{minutes}m"

            notifications.append(Notification(
                type="time_overdue",
                severity="warning",
                message=f"Einsatz '{incident.title}' ist {duration_str} im Status '{incident.status}'",
                incident_id=incident.id,
                event_id=event_id,
            ))

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

                notifications.append(Notification(
                    type="time_overdue",
                    severity="warning",
                    message=f"Einsatz '{incident.title}' ist seit {duration_str} abgeschlossen, aber nicht archiviert",
                    incident_id=incident.id,
                    event_id=event_id,
                ))

    return notifications


async def _check_resource_alerts(
    db: AsyncSession,
    event_id: UUID,
    settings: NotificationSettings
) -> list[Notification]:
    """Check for resource constraint alerts."""
    notifications = []

    # Check available personnel
    # Get personnel checked in for this event
    from ..models import EventAttendance
    result = await db.execute(
        select(EventAttendance)
        .where(EventAttendance.event_id == event_id)
        .where(EventAttendance.checked_in == True)
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
            notifications.append(Notification(
                type="no_personnel",
                severity="critical",
                message="Kein Personal mehr verfügbar - alle eingecheckten Personen sind zugewiesen",
                event_id=event_id,
            ))

    # Check personnel fatigue (assigned > threshold hours)
    now = datetime.now(timezone.utc)
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
            notifications.append(Notification(
                type="personnel_fatigue",
                severity="warning",
                message=f"{personnel_name} ist seit {hours} Stunden im Einsatz",
                event_id=event_id,
            ))

    # Check material depletion
    for material_type, threshold in settings.material_depletion_threshold.items():
        result = await db.execute(
            select(func.count(Material.id))
            .where(Material.type == material_type)
            .where(Material.status == "available")
        )
        available_count = result.scalar_one()

        if available_count <= threshold:
            notifications.append(Notification(
                type="no_materials",
                severity="critical" if available_count == 0 else "warning",
                message=f"Nur noch {available_count} Einheiten von '{material_type}' verfügbar (Schwellenwert: {threshold})",
                event_id=event_id,
            ))

    return notifications


async def _check_data_quality_alerts(
    db: AsyncSession,
    event_id: UUID
) -> list[Notification]:
    """Check for data quality issues."""
    notifications = []

    # Missing geocoded location
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.deleted_at.is_(None))
        .where(Incident.location_lat.is_(None))
    )
    incidents_no_location = result.scalars().all()

    for incident in incidents_no_location:
        notifications.append(Notification(
            type="missing_location",
            severity="info",
            message=f"Einsatz '{incident.title}' hat keine geokodierte Position",
            incident_id=incident.id,
            event_id=event_id,
        ))

    # Missing personnel in "einsatz" status
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.status == "einsatz")
        .where(Incident.deleted_at.is_(None))
    )
    incidents_in_einsatz = result.scalars().all()

    for incident in incidents_in_einsatz:
        # Check if has assigned personnel
        assignment_result = await db.execute(
            select(func.count(IncidentAssignment.id))
            .where(IncidentAssignment.incident_id == incident.id)
            .where(IncidentAssignment.resource_type == "personnel")
            .where(IncidentAssignment.unassigned_at.is_(None))
        )
        personnel_count = assignment_result.scalar_one()

        if personnel_count == 0:
            notifications.append(Notification(
                type="missing_personnel",
                severity="warning",
                message=f"Einsatz '{incident.title}' ist im Status 'Einsatz' aber hat kein zugewiesenes Personal",
                incident_id=incident.id,
                event_id=event_id,
            ))

    # Missing vehicle in "disponiert" status
    result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id)
        .where(Incident.status == "disponiert")
        .where(Incident.deleted_at.is_(None))
    )
    incidents_disponiert = result.scalars().all()

    for incident in incidents_disponiert:
        # Check if has assigned vehicle
        assignment_result = await db.execute(
            select(func.count(IncidentAssignment.id))
            .where(IncidentAssignment.incident_id == incident.id)
            .where(IncidentAssignment.resource_type == "vehicle")
            .where(IncidentAssignment.unassigned_at.is_(None))
        )
        vehicle_count = assignment_result.scalar_one()

        if vehicle_count == 0:
            notifications.append(Notification(
                type="missing_vehicle",
                severity="warning",
                message=f"Einsatz '{incident.title}' ist disponiert aber hat kein zugewiesenes Fahrzeug",
                incident_id=incident.id,
                event_id=event_id,
            ))

    return notifications


async def _check_event_size_alerts(
    db: AsyncSession,
    event_id: UUID,
    settings: NotificationSettings
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
    db: AsyncSession,
    new_notifications: list[Notification],
    event_id: UUID
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
        from sqlalchemy import or_, and_

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

        # Build suppression logic based on re-alarm settings
        now = datetime.now(timezone.utc)

        if re_alarm_enabled:
            # Re-alarming enabled: suppress both active and dismissed notifications within intervals
            active_suppression = now - timedelta(minutes=30)
            dismissed_suppression = now - timedelta(minutes=settings.re_alarm_interval_min)

            suppression_conditions = or_(
                # Active notifications created recently
                and_(
                    Notification.dismissed == False,
                    Notification.created_at >= active_suppression
                ),
                # Dismissed notifications within re-alarm interval
                and_(
                    Notification.dismissed == True,
                    Notification.dismissed_at.isnot(None),
                    Notification.dismissed_at >= dismissed_suppression
                )
            )
        else:
            # Re-alarming disabled (default): suppress active notifications AND any dismissed notification
            active_suppression = now - timedelta(minutes=30)

            suppression_conditions = or_(
                # Active notifications created recently
                and_(
                    Notification.dismissed == False,
                    Notification.created_at >= active_suppression
                ),
                # ANY dismissed notification (permanent suppression)
                Notification.dismissed == True
            )

        query = select(Notification).where(
            and_(*base_conditions, suppression_conditions)
        )

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


async def dismiss_notification(
    db: AsyncSession,
    notification_id: UUID,
    user_id: UUID
) -> Optional[Notification]:
    """Dismiss a notification."""
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id)
    )
    notification = result.scalar_one_or_none()

    if notification:
        notification.dismissed = True
        notification.dismissed_at = datetime.now(timezone.utc)
        notification.dismissed_by = user_id
        await db.commit()
        await db.refresh(notification)

    return notification
