"""Notification schemas — types, settings, response shapes."""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class NotificationSeverity(str, Enum):
    """Notification severity levels."""

    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class NotificationType(str, Enum):
    """Notification types.

    Must stay in sync with the ``valid_notification_type`` CHECK constraint on
    ``models.Notification`` — this enum is the response model, so a type the DB
    happily stores but this enum does not know is not a missing bell entry: it
    is a ``ResponseValidationError`` that fails the WHOLE ``GET /notifications``
    response and blanks the operator's bell. That is exactly how the five
    ``/feld`` types (plan 25) went missing.
    """

    TIME_OVERDUE = "time_overdue"
    NO_PERSONNEL = "no_personnel"
    NO_MATERIALS = "no_materials"
    PERSONNEL_FATIGUE = "personnel_fatigue"
    MISSING_LOCATION = "missing_location"
    EVENT_SIZE_LIMIT = "event_size_limit"
    REKO_SUBMITTED = "reko_submitted"
    REKO_ARRIVED = "reko_arrived"
    TRAINING_EMERGENCY = "training_emergency"
    VEHICLE_ARRIVED = "vehicle_arrived"
    # Field reporting (/feld, plan 25)
    RAPPORT_SUBMITTED = "rapport_submitted"
    FIELD_ARRIVED = "field_arrived"
    FIELD_COMPLETE = "field_complete"
    FIELD_MESSAGE = "field_message"
    FIELD_PICKUP = "field_pickup"
    FIELD_REPORT = "field_report"


class NotificationResponse(BaseModel):
    """Notification response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: NotificationType
    severity: NotificationSeverity
    message: str
    incident_id: UUID | None = None
    event_id: UUID | None = None
    created_at: datetime
    dismissed: bool
    dismissed_at: datetime | None = None
    dismissed_by: UUID | None = None


class NotificationSettings(BaseModel):
    """Notification threshold settings for Training and Live modes."""

    # Time thresholds (in minutes/hours)
    live_eingegangen_min: int = 60
    live_reko_min: int = 60
    live_disponiert_min: int = 20
    live_einsatz_hours: int = 2
    live_rueckfahrt_min: int = 20
    live_archive_hours: int = 1

    training_eingegangen_min: int = 90
    training_reko_min: int = 90
    training_disponiert_min: int = 30
    training_einsatz_hours: int = 3
    training_rueckfahrt_min: int = 30
    training_archive_hours: int = 2

    # Resource thresholds
    fatigue_hours: int = 4
    material_depletion_threshold: dict[str, int] = {}

    # Event size limits (in GB)
    database_size_limit_gb: int = 5
    photo_size_limit_gb: int = 5

    # Re-alarm settings
    re_alarm_interval_min: int = 0

    # Geofence settings
    enabled_geofence_alerts: bool = True
    geofence_radius_meters: int = 200

    # Enabled alerts (can toggle individual types)
    enabled_time_alerts: bool = True
    enabled_resource_alerts: bool = True
    enabled_data_quality_alerts: bool = True
    enabled_event_alerts: bool = True

    # How long non-critical notification toasts stay on screen (seconds).
    # Critical toasts always require manual dismissal regardless of this.
    toast_duration_seconds: int = 8

    def get_threshold_minutes(self, status: str, is_training: bool) -> int:
        """Get threshold in minutes for a given status and mode."""
        prefix = "training" if is_training else "live"

        status_map = {
            "incoming": f"{prefix}_eingegangen_min",
            "reko": f"{prefix}_reko_min",
            "enroute": f"{prefix}_disponiert_min",
            "active": f"{prefix}_einsatz_hours",
            "returning": f"{prefix}_rueckfahrt_min",
            "complete": f"{prefix}_archive_hours",
        }

        field_name = status_map.get(status)
        if not field_name:
            return 60

        value = getattr(self, field_name, 60)

        if "hours" in field_name:
            return value * 60

        return value


class NotificationSettingsUpdate(BaseModel):
    """Schema for updating notification settings."""

    live_eingegangen_min: int | None = None
    live_reko_min: int | None = None
    live_disponiert_min: int | None = None
    live_einsatz_hours: int | None = None
    live_rueckfahrt_min: int | None = None
    live_archive_hours: int | None = None

    training_eingegangen_min: int | None = None
    training_reko_min: int | None = None
    training_disponiert_min: int | None = None
    training_einsatz_hours: int | None = None
    training_rueckfahrt_min: int | None = None
    training_archive_hours: int | None = None

    fatigue_hours: int | None = None
    material_depletion_threshold: dict[str, int] | None = None
    database_size_limit_gb: int | None = None
    photo_size_limit_gb: int | None = None

    re_alarm_interval_min: int | None = None

    enabled_geofence_alerts: bool | None = None
    geofence_radius_meters: int | None = None

    enabled_time_alerts: bool | None = None
    enabled_resource_alerts: bool | None = None
    enabled_data_quality_alerts: bool | None = None
    enabled_event_alerts: bool | None = None

    @field_validator(
        "live_eingegangen_min",
        "live_reko_min",
        "live_disponiert_min",
        "live_rueckfahrt_min",
        "training_eingegangen_min",
        "training_reko_min",
        "training_disponiert_min",
        "training_rueckfahrt_min",
        "re_alarm_interval_min",
    )
    @classmethod
    def validate_minute_fields(cls, v: int | None) -> int | None:
        """Validate minute fields are positive or zero."""
        if v is not None:
            if v < 0:
                raise ValueError("Time in minutes must be non-negative")
            if v > 1440:
                raise ValueError("Time in minutes should not exceed 24 hours (1440 minutes)")
        return v

    @field_validator(
        "live_einsatz_hours",
        "live_archive_hours",
        "training_einsatz_hours",
        "training_archive_hours",
        "fatigue_hours",
    )
    @classmethod
    def validate_hour_fields(cls, v: int | None) -> int | None:
        """Validate hour fields are positive."""
        if v is not None:
            if v < 0:
                raise ValueError("Time in hours must be non-negative")
            if v > 168:
                raise ValueError("Time in hours should not exceed 1 week (168 hours)")
        return v

    @field_validator("database_size_limit_gb", "photo_size_limit_gb")
    @classmethod
    def validate_size_limits(cls, v: int | None) -> int | None:
        """Validate size limits are reasonable.

        0 disables the alarm — that is the value `_check_event_size_alerts`
        reads as "do not measure, do not warn". Rejecting it (the old `< 1`)
        left an operator no way to switch a disk alarm off once it was set.
        """
        if v is not None:
            if v < 0:
                raise ValueError("Size limit must not be negative")
            if v > 100:
                raise ValueError("Size limit should not exceed 100 GB")
        return v
