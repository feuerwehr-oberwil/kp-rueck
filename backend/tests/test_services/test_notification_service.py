"""Tests for the notification_service module.

Tests notification evaluation, settings management, and notification lifecycle including:
- Settings retrieval and persistence
- Time-based alerts
- Resource alerts
- Data quality alerts
- Notification deduplication
- Dismissal functionality
"""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    Material,
    Notification,
    Personnel,
    Setting,
    StatusTransition,
    User,
)
from app.schemas import NotificationSettings
from app.services.notification_service import (
    NOTIFICATION_SETTINGS_KEY,
    _auto_resolve_stale_notifications,
    _check_data_quality_alerts,
    _check_event_size_alerts,
    _check_resource_alerts,
    _check_time_based_alerts,
    _deduplicate_and_save,
    create_reko_notification,
    dismiss_notification,
    evaluate_notifications,
    get_notification_settings,
    save_notification_settings,
)


# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def notif_user(db_session: AsyncSession) -> User:
    """Create a test user for notification tests."""
    user = User(
        id=uuid4(),
        username="notification_test_user",
        password_hash="$2b$12$test",
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def notif_event(db_session: AsyncSession) -> Event:
    """Create a test event for notification tests."""
    event = Event(
        id=uuid4(),
        name="Notification Test Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def training_event(db_session: AsyncSession) -> Event:
    """Create a training event for notification tests."""
    event = Event(
        id=uuid4(),
        name="Training Event",
        training_flag=True,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def notif_incident(db_session: AsyncSession, notif_event: Event, notif_user: User) -> Incident:
    """Create a test incident for notification tests."""
    incident = Incident(
        id=uuid4(),
        title="Notification Test Incident",
        type="brandbekaempfung",
        priority="high",
        status="eingegangen",
        event_id=notif_event.id,
        created_by=notif_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def notif_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel for notification tests."""
    personnel = Personnel(
        id=uuid4(),
        name="Test Person",
        role="Atemschutz",
        availability="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def notif_material(db_session: AsyncSession) -> Material:
    """Create test material for notification tests."""
    material = Material(
        id=uuid4(),
        name="Test Atemschutzgerät",
        type="Atemschutz",
        location="Depot",  # Location is used for threshold notifications
        status="available",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


@pytest_asyncio.fixture
async def default_settings() -> NotificationSettings:
    """Return default notification settings."""
    return NotificationSettings()


# ============================================
# Settings Tests
# ============================================


class TestGetNotificationSettings:
    """Tests for get_notification_settings function."""

    @pytest.mark.asyncio
    async def test_returns_defaults_when_no_settings(self, db_session: AsyncSession):
        """Test returns default settings when none saved."""
        settings = await get_notification_settings(db_session)

        assert isinstance(settings, NotificationSettings)
        assert settings.live_eingegangen_min == 60
        assert settings.fatigue_hours == 4
        assert settings.enabled_time_alerts is True

    @pytest.mark.asyncio
    async def test_returns_saved_settings(self, db_session: AsyncSession):
        """Test returns settings from database when present."""
        # Save custom settings
        custom_settings = NotificationSettings(
            live_eingegangen_min=30,
            fatigue_hours=6,
            enabled_time_alerts=False,
        )
        setting = Setting(
            key=NOTIFICATION_SETTINGS_KEY,
            value=custom_settings.model_dump_json(),
        )
        db_session.add(setting)
        await db_session.commit()

        # Retrieve settings
        settings = await get_notification_settings(db_session)

        assert settings.live_eingegangen_min == 30
        assert settings.fatigue_hours == 6
        assert settings.enabled_time_alerts is False

    @pytest.mark.asyncio
    async def test_returns_defaults_on_invalid_json(self, db_session: AsyncSession):
        """Test returns defaults when stored JSON is invalid."""
        setting = Setting(
            key=NOTIFICATION_SETTINGS_KEY,
            value="invalid json",
        )
        db_session.add(setting)
        await db_session.commit()

        settings = await get_notification_settings(db_session)
        assert isinstance(settings, NotificationSettings)
        assert settings.live_eingegangen_min == 60  # Default


class TestSaveNotificationSettings:
    """Tests for save_notification_settings function."""

    @pytest.mark.asyncio
    async def test_saves_settings(self, db_session: AsyncSession, notif_user: User):
        """Test settings are saved to database."""
        settings = NotificationSettings(
            live_eingegangen_min=45,
            fatigue_hours=5,
        )

        result = await save_notification_settings(db_session, settings, notif_user.id)

        assert result == settings

        # Verify saved in database
        saved = await db_session.execute(select(Setting).where(Setting.key == NOTIFICATION_SETTINGS_KEY))
        saved_setting = saved.scalar_one()
        saved_data = json.loads(saved_setting.value)
        assert saved_data["live_eingegangen_min"] == 45
        assert saved_data["fatigue_hours"] == 5


# ============================================
# Time-Based Alert Tests
# ============================================


class TestCheckTimeBasedAlerts:
    """Tests for _check_time_based_alerts function."""

    @pytest.mark.asyncio
    async def test_no_alerts_for_recent_incident(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident, default_settings: NotificationSettings
    ):
        """Test no alerts for recently created incidents."""
        notifications = await _check_time_based_alerts(
            db_session, notif_event.id, is_training=False, settings=default_settings
        )

        # Recently created incident should not trigger alert
        assert len(notifications) == 0

    @pytest.mark.asyncio
    async def test_alert_for_overdue_incident(
        self, db_session: AsyncSession, notif_event: Event, notif_user: User, default_settings: NotificationSettings
    ):
        """Test alert generated for incident in status too long."""
        # Create incident that's been in eingegangen for 2 hours (threshold is 60 min)
        old_incident = Incident(
            id=uuid4(),
            title="Old Incident",
            type="brandbekaempfung",
            priority="high",
            status="eingegangen",
            event_id=notif_event.id,
            created_by=notif_user.id,
            created_at=datetime.now(UTC) - timedelta(hours=2),
        )
        db_session.add(old_incident)
        await db_session.commit()

        notifications = await _check_time_based_alerts(
            db_session, notif_event.id, is_training=False, settings=default_settings
        )

        assert len(notifications) >= 1
        assert any(n.type == "time_overdue" for n in notifications)
        assert any("Old Incident" in n.message for n in notifications)

    @pytest.mark.asyncio
    async def test_training_mode_uses_longer_thresholds(
        self, db_session: AsyncSession, training_event: Event, notif_user: User
    ):
        """Test training mode uses longer time thresholds."""
        # Create incident that's 70 minutes old
        # Live threshold: 60 min (would alert)
        # Training threshold: 90 min (would not alert)
        incident = Incident(
            id=uuid4(),
            title="Training Incident",
            type="brandbekaempfung",
            priority="high",
            status="eingegangen",
            event_id=training_event.id,
            created_by=notif_user.id,
            created_at=datetime.now(UTC) - timedelta(minutes=70),
        )
        db_session.add(incident)
        await db_session.commit()

        settings = NotificationSettings()
        notifications = await _check_time_based_alerts(
            db_session, training_event.id, is_training=True, settings=settings
        )

        # Should not alert in training mode (70 min < 90 min threshold)
        assert len(notifications) == 0

    @pytest.mark.asyncio
    async def test_completed_incident_not_archived_alert(
        self, db_session: AsyncSession, notif_event: Event, notif_user: User, default_settings: NotificationSettings
    ):
        """Test alert for completed incident not yet archived."""
        # Create completed incident
        incident = Incident(
            id=uuid4(),
            title="Completed Not Archived",
            type="brandbekaempfung",
            priority="high",
            status="einsatz_beendet",
            event_id=notif_event.id,
            created_by=notif_user.id,
            completed_at=datetime.now(UTC) - timedelta(hours=2),  # Completed 2 hours ago
        )
        db_session.add(incident)
        await db_session.commit()

        notifications = await _check_time_based_alerts(
            db_session, notif_event.id, is_training=False, settings=default_settings
        )

        assert len(notifications) >= 1
        assert any("nicht archiviert" in n.message for n in notifications)


# ============================================
# Resource Alert Tests
# ============================================


class TestCheckResourceAlerts:
    """Tests for _check_resource_alerts function."""

    @pytest.mark.asyncio
    async def test_no_personnel_alert(
        self,
        db_session: AsyncSession,
        notif_event: Event,
        notif_incident: Incident,
        notif_personnel: Personnel,
        default_settings: NotificationSettings,
    ):
        """Test alert when all personnel are assigned."""
        # Check in personnel to event
        attendance = EventAttendance(
            event_id=notif_event.id,
            personnel_id=notif_personnel.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
        db_session.add(attendance)

        # Assign all personnel
        assignment = IncidentAssignment(
            incident_id=notif_incident.id,
            resource_type="personnel",
            resource_id=notif_personnel.id,
        )
        db_session.add(assignment)
        await db_session.commit()

        notifications = await _check_resource_alerts(db_session, notif_event.id, default_settings)

        assert any(n.type == "no_personnel" for n in notifications)
        assert any("Kein Personal mehr verfügbar" in n.message for n in notifications)

    @pytest.mark.asyncio
    async def test_personnel_fatigue_alert(
        self,
        db_session: AsyncSession,
        notif_event: Event,
        notif_incident: Incident,
        notif_personnel: Personnel,
    ):
        """Test alert for personnel assigned too long."""
        # Check in personnel
        attendance = EventAttendance(
            event_id=notif_event.id,
            personnel_id=notif_personnel.id,
            checked_in=True,
        )
        db_session.add(attendance)

        # Create long-running assignment (5 hours, threshold is 4)
        assignment = IncidentAssignment(
            incident_id=notif_incident.id,
            resource_type="personnel",
            resource_id=notif_personnel.id,
            assigned_at=datetime.now(UTC) - timedelta(hours=5),
        )
        db_session.add(assignment)
        await db_session.commit()

        settings = NotificationSettings(fatigue_hours=4)
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)

        assert any(n.type == "personnel_fatigue" for n in notifications)

    @pytest.mark.asyncio
    async def test_material_depletion_critical(
        self,
        db_session: AsyncSession,
        notif_event: Event,
    ):
        """Test critical alert when no materials available."""
        # No materials at location "Depot" in database
        settings = NotificationSettings(material_depletion_threshold={"Depot": 2})
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)

        assert any(n.type == "no_materials" and n.severity == "critical" for n in notifications)

    @pytest.mark.asyncio
    async def test_material_depletion_warning(
        self,
        db_session: AsyncSession,
        notif_event: Event,
        notif_material: Material,
    ):
        """Test warning when materials below threshold."""
        # Only 1 material available at "Depot" location, threshold is 2
        settings = NotificationSettings(material_depletion_threshold={"Depot": 2})
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)

        assert any(n.type == "no_materials" and n.severity == "warning" for n in notifications)

    @pytest.mark.asyncio
    async def test_material_depletion_disabled(
        self,
        db_session: AsyncSession,
        notif_event: Event,
    ):
        """Test no alert when material location disabled (threshold -1)."""
        settings = NotificationSettings(material_depletion_threshold={"Depot": -1})
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)

        # No alerts for Depot since disabled
        assert not any(n.message and "Depot" in n.message for n in notifications)

    @pytest.mark.asyncio
    async def test_material_depletion_excludes_assigned_materials(
        self,
        db_session: AsyncSession,
        notif_event: Event,
        notif_incident: Incident,
    ):
        """Test that assigned materials are excluded from available count."""
        # Create 3 materials at "Depot" location
        materials = []
        for i in range(3):
            material = Material(
                id=uuid4(),
                name=f"Test Material {i}",
                type="TestType",
                location="Depot",
                status="available",
            )
            db_session.add(material)
            materials.append(material)
        await db_session.commit()

        # With threshold=2 and 3 materials, no warning should appear
        settings = NotificationSettings(material_depletion_threshold={"Depot": 2})
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        assert not any(n.type == "no_materials" and "Depot" in n.message for n in notifications)

        # Now assign 2 materials to an incident
        for i in range(2):
            assignment = IncidentAssignment(
                incident_id=notif_incident.id,
                resource_type="material",
                resource_id=materials[i].id,
            )
            db_session.add(assignment)
        await db_session.commit()

        # Now only 1 material is truly available (3 total - 2 assigned = 1 available)
        # With threshold=2, this should trigger a warning
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        assert any(n.type == "no_materials" and n.severity == "warning" for n in notifications)
        assert any("Depot" in n.message and "1" in n.message for n in notifications)

    @pytest.mark.asyncio
    async def test_material_depletion_critical_when_all_assigned(
        self,
        db_session: AsyncSession,
        notif_event: Event,
        notif_incident: Incident,
    ):
        """Test critical alert when all materials are assigned."""
        # Create 2 materials at "TLF" location
        materials = []
        for i in range(2):
            material = Material(
                id=uuid4(),
                name=f"TLF Material {i}",
                type="TestType",
                location="TLF",
                status="available",
            )
            db_session.add(material)
            materials.append(material)
        await db_session.commit()

        # Assign all materials to an incident
        for material in materials:
            assignment = IncidentAssignment(
                incident_id=notif_incident.id,
                resource_type="material",
                resource_id=material.id,
            )
            db_session.add(assignment)
        await db_session.commit()

        # With threshold=1 and 0 available (all assigned), critical alert
        settings = NotificationSettings(material_depletion_threshold={"TLF": 1})
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        assert any(n.type == "no_materials" and n.severity == "critical" for n in notifications)
        assert any("TLF" in n.message and "Keine Einheiten" in n.message for n in notifications)

    @pytest.mark.asyncio
    async def test_material_depletion_unassigned_materials_counted(
        self,
        db_session: AsyncSession,
        notif_event: Event,
        notif_incident: Incident,
    ):
        """Test that unassigned (released) materials are counted as available."""
        # Create 2 materials at "MoWa" location
        materials = []
        for i in range(2):
            material = Material(
                id=uuid4(),
                name=f"MoWa Material {i}",
                type="TestType",
                location="MoWa",
                status="available",
            )
            db_session.add(material)
            materials.append(material)
        await db_session.commit()

        # Assign all materials
        assignments = []
        for material in materials:
            assignment = IncidentAssignment(
                incident_id=notif_incident.id,
                resource_type="material",
                resource_id=material.id,
            )
            db_session.add(assignment)
            assignments.append(assignment)
        await db_session.commit()
        for assignment in assignments:
            await db_session.refresh(assignment)

        # With threshold=1 and 0 available, critical alert
        settings = NotificationSettings(material_depletion_threshold={"MoWa": 1})
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        assert any(n.type == "no_materials" and n.severity == "critical" for n in notifications)

        # Now unassign one material (release it)
        assignments[0].unassigned_at = datetime.now(UTC)
        await db_session.commit()

        # Now 1 material is available, threshold is 1, so warning (not critical)
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        # Should no longer be critical (1 available, threshold 1 means warning OR no alert)
        # Since available (1) <= threshold (1), still warning
        assert any(n.type == "no_materials" and n.severity == "warning" for n in notifications)

        # Unassign the second material too
        assignments[1].unassigned_at = datetime.now(UTC)
        await db_session.commit()

        # Now 2 materials available, threshold is 1, no alert
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        assert not any(n.type == "no_materials" and "MoWa" in n.message for n in notifications)


# ============================================
# Data Quality Alert Tests
# ============================================


class TestCheckDataQualityAlerts:
    """Tests for _check_data_quality_alerts function."""

    @pytest.mark.asyncio
    async def test_missing_location_alert(
        self, db_session: AsyncSession, notif_event: Event, notif_user: User
    ):
        """Test alert for incident without geocoded location in disponiert status."""
        # Create incident in disponiert status without location
        incident = Incident(
            id=uuid4(),
            title="No Location Incident",
            type="brandbekaempfung",
            priority="high",
            status="disponiert",  # In disponiert - needs location
            event_id=notif_event.id,
            created_by=notif_user.id,
            location_lat=None,
            location_lng=None,
        )
        db_session.add(incident)
        await db_session.commit()

        notifications = await _check_data_quality_alerts(db_session, notif_event.id)

        assert len(notifications) == 1
        assert notifications[0].type == "missing_location"
        assert "keine geokodierte Position" in notifications[0].message

    @pytest.mark.asyncio
    async def test_no_alert_for_eingegangen_without_location(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident
    ):
        """Test no alert for incident in eingegangen status without location."""
        # notif_incident is in eingegangen status and has no location
        notifications = await _check_data_quality_alerts(db_session, notif_event.id)

        # Should not alert - location not required for eingegangen
        assert not any(n.incident_id == notif_incident.id for n in notifications)


# ============================================
# Event Size Alert Tests
# ============================================


class TestCheckEventSizeAlerts:
    """Tests for _check_event_size_alerts function."""

    @pytest.mark.asyncio
    async def test_event_size_alerts_returns_empty(
        self, db_session: AsyncSession, notif_event: Event, default_settings: NotificationSettings
    ):
        """Test event size alerts (currently placeholder)."""
        # This is a placeholder function that returns empty list
        notifications = await _check_event_size_alerts(db_session, notif_event.id, default_settings)
        assert notifications == []


# ============================================
# Deduplication Tests
# ============================================


class TestDeduplicateAndSave:
    """Tests for _deduplicate_and_save function."""

    @pytest.mark.asyncio
    async def test_saves_new_notification(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident
    ):
        """Test new notifications are saved."""
        notification = Notification(
            type="time_overdue",
            severity="warning",
            message="Test notification",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
        )

        saved = await _deduplicate_and_save(db_session, [notification], notif_event.id)

        assert len(saved) == 1
        assert saved[0].id is not None

    @pytest.mark.asyncio
    async def test_deduplicates_recent_notification(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident
    ):
        """Test recent notifications are deduplicated.

        The deduplication logic checks for notifications created within 30 minutes.
        After creating an existing notification, trying to add another of the same
        type for the same incident gets deduplicated.
        """
        # Create existing notification (just created, within 30 minutes)
        existing = Notification(
            type="time_overdue",
            severity="warning",
            message="Existing notification",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
            dismissed=False,
        )
        db_session.add(existing)
        await db_session.commit()
        await db_session.refresh(existing)

        # Try to add same type notification for same incident
        new_notification = Notification(
            type="time_overdue",
            severity="warning",
            message="New notification",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
        )

        saved = await _deduplicate_and_save(db_session, [new_notification], notif_event.id)

        # Should be deduplicated (not saved) since there's already an active notification
        assert len(saved) == 0

    @pytest.mark.asyncio
    async def test_dismissed_notification_permanent_suppression(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident, notif_user: User
    ):
        """Test dismissed notifications are permanently suppressed by default."""
        # Create and dismiss a notification
        dismissed = Notification(
            type="time_overdue",
            severity="warning",
            message="Dismissed notification",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
            dismissed=True,
            dismissed_at=datetime.now(UTC) - timedelta(hours=1),
            dismissed_by=notif_user.id,
        )
        db_session.add(dismissed)
        await db_session.commit()

        # Try to add same type notification (should be suppressed)
        new_notification = Notification(
            type="time_overdue",
            severity="warning",
            message="New notification after dismiss",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
        )

        saved = await _deduplicate_and_save(db_session, [new_notification], notif_event.id)

        # Should be suppressed due to permanent suppression (default)
        assert len(saved) == 0

    @pytest.mark.asyncio
    async def test_empty_notifications_list(self, db_session: AsyncSession, notif_event: Event):
        """Test empty list returns empty."""
        saved = await _deduplicate_and_save(db_session, [], notif_event.id)
        assert saved == []

    @pytest.mark.asyncio
    async def test_different_locations_not_suppressed(
        self, db_session: AsyncSession, notif_event: Event, notif_user: User
    ):
        """Test that dismissed notification for one location doesn't suppress another location.

        This is critical for material depletion notifications - a dismissed 'Bühne' notification
        should NOT suppress a new 'Depot' notification, even though they have the same type.
        """
        # Create and dismiss a notification for "Bühne"
        dismissed_buehne = Notification(
            type="no_materials",
            severity="critical",
            message="Keine Einheiten von 'Bühne' mehr verfügbar",
            incident_id=None,  # Event-level notification
            event_id=notif_event.id,
            dismissed=True,
            dismissed_at=datetime.now(UTC) - timedelta(minutes=5),
            dismissed_by=notif_user.id,
        )
        db_session.add(dismissed_buehne)
        await db_session.commit()

        # Try to add notification for different location "Depot"
        new_depot_notification = Notification(
            type="no_materials",
            severity="warning",
            message="Nur noch 1 Einheiten von 'Depot' verfügbar",
            incident_id=None,  # Event-level notification
            event_id=notif_event.id,
        )

        saved = await _deduplicate_and_save(db_session, [new_depot_notification], notif_event.id)

        # Should be saved because it's a different location (different message)
        assert len(saved) == 1
        assert "Depot" in saved[0].message

    @pytest.mark.asyncio
    async def test_same_location_is_suppressed(
        self, db_session: AsyncSession, notif_event: Event, notif_user: User
    ):
        """Test that dismissed notification for same location IS suppressed."""
        # Create and dismiss a notification for "Depot"
        dismissed_depot = Notification(
            type="no_materials",
            severity="warning",
            message="Nur noch 1 Einheiten von 'Depot' verfügbar",
            incident_id=None,
            event_id=notif_event.id,
            dismissed=True,
            dismissed_at=datetime.now(UTC) - timedelta(minutes=5),
            dismissed_by=notif_user.id,
        )
        db_session.add(dismissed_depot)
        await db_session.commit()

        # Try to add same notification again
        new_depot_notification = Notification(
            type="no_materials",
            severity="warning",
            message="Nur noch 1 Einheiten von 'Depot' verfügbar",
            incident_id=None,
            event_id=notif_event.id,
        )

        saved = await _deduplicate_and_save(db_session, [new_depot_notification], notif_event.id)

        # Should be suppressed because it's the exact same notification
        assert len(saved) == 0


# ============================================
# Dismiss Notification Tests
# ============================================


class TestDismissNotification:
    """Tests for dismiss_notification function."""

    @pytest.mark.asyncio
    async def test_dismisses_notification(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident, notif_user: User
    ):
        """Test notification is dismissed properly."""
        # Create notification
        notification = Notification(
            type="time_overdue",
            severity="warning",
            message="Test",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
        )
        db_session.add(notification)
        await db_session.commit()
        await db_session.refresh(notification)

        # Dismiss it
        result = await dismiss_notification(db_session, notification.id, notif_user.id)

        assert result is not None
        assert result.dismissed is True
        assert result.dismissed_at is not None
        assert result.dismissed_by == notif_user.id

    @pytest.mark.asyncio
    async def test_dismiss_nonexistent_notification(
        self, db_session: AsyncSession, notif_user: User
    ):
        """Test dismissing non-existent notification returns None."""
        fake_id = uuid4()
        result = await dismiss_notification(db_session, fake_id, notif_user.id)
        assert result is None


# ============================================
# Create Reko Notification Tests
# ============================================


class TestCreateRekoNotification:
    """Tests for create_reko_notification function."""

    @pytest.mark.asyncio
    async def test_creates_relevant_reko_notification(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident
    ):
        """Test creates notification for relevant reko."""
        notification = await create_reko_notification(
            db=db_session,
            incident_id=notif_incident.id,
            event_id=notif_event.id,
            incident_title="Test Incident",
            is_relevant=True,
            submitted_by_name="Max Mustermann",
        )

        assert notification.type == "reko_submitted"
        assert notification.severity == "info"
        assert "Einsatz relevant" in notification.message
        assert "Max Mustermann" in notification.message
        assert notification.incident_id == notif_incident.id
        assert notification.event_id == notif_event.id

    @pytest.mark.asyncio
    async def test_creates_not_relevant_reko_notification(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident
    ):
        """Test creates notification for not relevant reko."""
        notification = await create_reko_notification(
            db=db_session,
            incident_id=notif_incident.id,
            event_id=notif_event.id,
            incident_title="Test Incident",
            is_relevant=False,
        )

        assert "Kein Einsatz nötig" in notification.message

    @pytest.mark.asyncio
    async def test_creates_reko_without_submitter(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident
    ):
        """Test creates notification without submitter name."""
        notification = await create_reko_notification(
            db=db_session,
            incident_id=notif_incident.id,
            event_id=notif_event.id,
            incident_title="Test Incident",
            is_relevant=True,
        )

        assert "Reko abgeschlossen:" in notification.message
        assert notification.id is not None


# ============================================
# Main Evaluate Notifications Tests
# ============================================


class TestEvaluateNotifications:
    """Tests for evaluate_notifications main function."""

    @pytest.mark.asyncio
    async def test_returns_empty_for_nonexistent_event(self, db_session: AsyncSession):
        """Test returns empty list for non-existent event."""
        fake_event_id = uuid4()
        notifications = await evaluate_notifications(db_session, fake_event_id)
        assert notifications == []

    @pytest.mark.asyncio
    async def test_calls_all_alert_checks_when_enabled(
        self, db_session: AsyncSession, notif_event: Event
    ):
        """Test all alert checks are called when enabled."""
        with (
            patch("app.services.notification_service._check_time_based_alerts") as mock_time,
            patch("app.services.notification_service._check_resource_alerts") as mock_resource,
            patch("app.services.notification_service._check_data_quality_alerts") as mock_quality,
            patch("app.services.notification_service._check_event_size_alerts") as mock_event,
            patch("app.services.notification_service._deduplicate_and_save") as mock_dedup,
        ):
            mock_time.return_value = []
            mock_resource.return_value = []
            mock_quality.return_value = []
            mock_event.return_value = []
            mock_dedup.return_value = []

            await evaluate_notifications(db_session, notif_event.id)

            mock_time.assert_called_once()
            mock_resource.assert_called_once()
            mock_quality.assert_called_once()
            mock_event.assert_called_once()

    @pytest.mark.asyncio
    async def test_respects_disabled_alert_types(
        self, db_session: AsyncSession, notif_event: Event
    ):
        """Test disabled alert types are not checked."""
        # Save settings with all alerts disabled
        disabled_settings = NotificationSettings(
            enabled_time_alerts=False,
            enabled_resource_alerts=False,
            enabled_data_quality_alerts=False,
            enabled_event_alerts=False,
        )
        setting = Setting(
            key=NOTIFICATION_SETTINGS_KEY,
            value=disabled_settings.model_dump_json(),
        )
        db_session.add(setting)
        await db_session.commit()

        with (
            patch("app.services.notification_service._check_time_based_alerts") as mock_time,
            patch("app.services.notification_service._check_resource_alerts") as mock_resource,
            patch("app.services.notification_service._check_data_quality_alerts") as mock_quality,
            patch("app.services.notification_service._check_event_size_alerts") as mock_event,
        ):
            await evaluate_notifications(db_session, notif_event.id)

            mock_time.assert_not_called()
            mock_resource.assert_not_called()
            mock_quality.assert_not_called()
            mock_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_active_and_recently_dismissed(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident, notif_user: User
    ):
        """Test returns both active and recently dismissed notifications."""
        # Create active notification
        active = Notification(
            type="time_overdue",
            severity="warning",
            message="Active notification",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
            dismissed=False,
        )
        db_session.add(active)

        # Create recently dismissed notification
        dismissed = Notification(
            type="missing_location",
            severity="info",
            message="Dismissed notification",
            incident_id=notif_incident.id,
            event_id=notif_event.id,
            dismissed=True,
            dismissed_at=datetime.now(UTC) - timedelta(hours=1),
            dismissed_by=notif_user.id,
        )
        db_session.add(dismissed)
        await db_session.commit()

        notifications = await evaluate_notifications(db_session, notif_event.id)

        # Should include both
        assert len(notifications) >= 2
        assert any(not n.dismissed for n in notifications)
        assert any(n.dismissed for n in notifications)


# ============================================
# NotificationSettings Method Tests
# ============================================


class TestNotificationSettingsGetThresholdMinutes:
    """Tests for NotificationSettings.get_threshold_minutes method."""

    def test_live_mode_eingegangen(self, default_settings: NotificationSettings):
        """Test live mode threshold for eingegangen status."""
        threshold = default_settings.get_threshold_minutes("eingegangen", is_training=False)
        assert threshold == 60  # Default is 60 minutes

    def test_training_mode_eingegangen(self, default_settings: NotificationSettings):
        """Test training mode threshold for eingegangen status."""
        threshold = default_settings.get_threshold_minutes("eingegangen", is_training=True)
        assert threshold == 90  # Training default is 90 minutes

    def test_einsatz_converts_hours_to_minutes(self, default_settings: NotificationSettings):
        """Test einsatz threshold converts hours to minutes."""
        threshold = default_settings.get_threshold_minutes("einsatz", is_training=False)
        assert threshold == 120  # 2 hours * 60 = 120 minutes

    def test_unknown_status_returns_default(self, default_settings: NotificationSettings):
        """Test unknown status returns 60 minute default."""
        threshold = default_settings.get_threshold_minutes("unknown_status", is_training=False)
        assert threshold == 60


# ============================================
# Edge Cases
# ============================================


class TestNotificationEdgeCases:
    """Tests for edge cases in notification service."""

    @pytest.mark.asyncio
    async def test_notification_with_null_incident_id(
        self, db_session: AsyncSession, notif_event: Event
    ):
        """Test notification without incident_id (event-level notification)."""
        notification = Notification(
            type="no_personnel",
            severity="critical",
            message="Event-level notification",
            incident_id=None,
            event_id=notif_event.id,
        )
        db_session.add(notification)
        await db_session.commit()
        await db_session.refresh(notification)

        assert notification.id is not None
        assert notification.incident_id is None
        assert notification.event_id == notif_event.id

    @pytest.mark.asyncio
    async def test_deduplication_distinguishes_incident_ids(
        self, db_session: AsyncSession, notif_event: Event, notif_incident: Incident, notif_user: User
    ):
        """Test deduplication correctly distinguishes different incident_ids."""
        # Create existing notification for one incident
        incident_id_1 = notif_incident.id
        existing = Notification(
            type="time_overdue",
            severity="warning",
            message="Incident 1 notification",
            incident_id=incident_id_1,
            event_id=notif_event.id,
        )
        db_session.add(existing)
        await db_session.commit()

        # Create second incident
        incident_2 = Incident(
            id=uuid4(),
            title="Second Incident",
            type="brandbekaempfung",
            priority="high",
            status="eingegangen",
            event_id=notif_event.id,
            created_by=notif_user.id,
        )
        db_session.add(incident_2)
        await db_session.commit()

        # Try to add notification for different incident
        new_notification = Notification(
            type="time_overdue",
            severity="warning",
            message="Incident 2 notification",
            incident_id=incident_2.id,
            event_id=notif_event.id,
        )

        saved = await _deduplicate_and_save(db_session, [new_notification], notif_event.id)

        # Should be saved (different incident_id)
        assert len(saved) == 1


# ============================================
# Auto-Resolution Tests
# ============================================


class TestAutoResolution:
    """Tests for automatic resolution of stale notifications."""

    @pytest.mark.asyncio
    async def test_material_notification_auto_resolves_when_condition_fixed(
        self,
        db_session: AsyncSession,
        notif_event: Event,
        notif_incident: Incident,
    ):
        """Test that material notification is auto-resolved when materials unassigned."""
        # Create 3 materials at Depot
        materials = []
        for i in range(3):
            material = Material(
                id=uuid4(),
                name=f"Depot Material {i}",
                type="TestType",
                location="Depot",
                status="available",
            )
            db_session.add(material)
            materials.append(material)
        await db_session.commit()

        # Assign 2 materials (leaving 1 available, below threshold of 2)
        assignments = []
        for i in range(2):
            assignment = IncidentAssignment(
                incident_id=notif_incident.id,
                resource_type="material",
                resource_id=materials[i].id,
            )
            db_session.add(assignment)
            assignments.append(assignment)
        await db_session.commit()
        for a in assignments:
            await db_session.refresh(a)

        # Configure threshold
        settings = NotificationSettings(material_depletion_threshold={"Depot": 2})

        # First evaluation should create the notification
        from app.services.notification_service import _check_resource_alerts, _auto_resolve_stale_notifications

        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        assert any("Depot" in n.message for n in notifications)

        # Save the notification
        depot_notification = Notification(
            type="no_materials",
            severity="warning",
            message="Nur noch 1 Einheiten von 'Depot' verfügbar",
            incident_id=None,
            event_id=notif_event.id,
            dismissed=False,
        )
        db_session.add(depot_notification)
        await db_session.commit()
        await db_session.refresh(depot_notification)

        # Now unassign 1 material (2 available now, equals threshold - still warning)
        assignments[0].unassigned_at = datetime.now(UTC)
        await db_session.commit()

        # Re-check - should still generate notification (2 available <= 2 threshold)
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        # Message changes to "2 Einheiten" but still triggers
        assert any("Depot" in n.message for n in notifications)

        # Unassign second material (3 available now, above threshold)
        assignments[1].unassigned_at = datetime.now(UTC)
        await db_session.commit()

        # Re-check - should NOT generate notification anymore
        notifications = await _check_resource_alerts(db_session, notif_event.id, settings)
        assert not any("Depot" in n.message for n in notifications)

        # Auto-resolve should dismiss the old notification
        await _auto_resolve_stale_notifications(db_session, notif_event.id, notifications, settings)

        # Refresh and check it was dismissed
        await db_session.refresh(depot_notification)
        assert depot_notification.dismissed is True
        assert depot_notification.dismissed_at is not None
        # dismissed_by should be None for auto-resolved
        assert depot_notification.dismissed_by is None
