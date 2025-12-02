"""Pydantic schemas for request/response validation."""
from datetime import datetime
from decimal import Decimal
from enum import Enum
from ipaddress import IPv4Address, IPv6Address
from typing import Optional, Union
from uuid import UUID
import re

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator, validator, EmailStr, HttpUrl


# ============================================
# Personnel Schemas
# ============================================


class PersonnelBase(BaseModel):
    """Base personnel schema."""

    name: str
    role: Optional[str] = None
    role_sort_order: int = 0
    availability: str  # 'available', 'assigned', 'unavailable'
    tags: Optional[list[str]] = None

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate personnel name."""
        if not v or not v.strip():
            raise ValueError("Name cannot be empty")
        if len(v) > 100:
            raise ValueError("Name must be 100 characters or less")
        # Remove any excessive whitespace
        return ' '.join(v.split())

    @field_validator('availability')
    @classmethod
    def validate_availability(cls, v: str) -> str:
        """Validate availability status."""
        valid_statuses = {'available', 'assigned', 'unavailable'}
        if v not in valid_statuses:
            raise ValueError(f"Availability must be one of: {', '.join(valid_statuses)}")
        return v

    @field_validator('role_sort_order')
    @classmethod
    def validate_sort_order(cls, v: int) -> int:
        """Validate sort order is non-negative."""
        if v < 0:
            raise ValueError("Sort order must be non-negative")
        return v


class PersonnelCreate(PersonnelBase):
    """Schema for creating personnel."""

    pass


class PersonnelUpdate(BaseModel):
    """Schema for updating personnel."""

    name: Optional[str] = None
    role: Optional[str] = None
    role_sort_order: Optional[int] = None
    availability: Optional[str] = None
    tags: Optional[list[str]] = None


class Personnel(PersonnelBase):
    """Full personnel schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    checked_in: bool = False
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class CategorySortOrder(BaseModel):
    """Schema for updating category sort orders."""

    category: str  # The category name (role for personnel, location for materials)
    sort_order: int  # The new sort order value


class BulkCategorySortOrderUpdate(BaseModel):
    """Schema for bulk updating category sort orders."""

    categories: list[CategorySortOrder]


# ============================================
# Personnel Check-In Schemas
# ============================================


class PersonnelCheckInRequest(BaseModel):
    """Request to check in/out a person."""

    personnel_id: UUID
    checked_in: bool  # True = check in, False = check out


class PersonnelCheckInResponse(BaseModel):
    """Response with check-in status."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    role: Optional[str] = None
    availability: str
    tags: Optional[list[str]] = None
    checked_in: bool
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None
    is_assigned: bool = False  # Whether assigned to any incident in this event


class PersonnelListItem(BaseModel):
    """Simplified personnel info for check-in list."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    role: Optional[str] = None
    tags: Optional[list[str]] = None
    checked_in: bool
    is_assigned: bool = False  # Whether assigned to any incident in this event


class CheckInListResponse(BaseModel):
    """Response for check-in list with event information."""

    personnel: list[PersonnelListItem]
    event_id: UUID
    event_name: str


# ============================================
# Special Function Schemas
# ============================================


class FunctionType(str, Enum):
    """Special function type enumeration."""

    DRIVER = "driver"
    REKO = "reko"
    MAGAZIN = "magazin"


class EventSpecialFunctionCreate(BaseModel):
    """Schema for assigning a special function to personnel."""

    personnel_id: UUID
    function_type: FunctionType
    vehicle_id: Optional[UUID] = None  # Required for driver assignments


class EventSpecialFunctionDelete(BaseModel):
    """Schema for removing a special function assignment."""

    personnel_id: UUID
    function_type: FunctionType
    vehicle_id: Optional[UUID] = None  # Required for driver unassignments


class EventSpecialFunctionResponse(BaseModel):
    """Special function assignment response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    personnel_id: UUID
    personnel_name: str  # Computed field
    function_type: FunctionType
    vehicle_id: Optional[UUID] = None
    vehicle_name: Optional[str] = None  # Computed field for drivers
    assigned_at: datetime
    assigned_by: Optional[UUID] = None


# ============================================
# Vehicle Schemas
# ============================================


class VehicleBase(BaseModel):
    """Base vehicle schema."""

    name: str
    type: str  # Configurable vehicle types (e.g., 'TLF', 'DLK', 'MTW')
    display_order: int
    status: str  # 'available', 'assigned', 'planned', 'maintenance'
    radio_call_sign: str

    @field_validator('name', 'radio_call_sign')
    @classmethod
    def validate_string_fields(cls, v: str) -> str:
        """Validate string fields are not empty."""
        if not v or not v.strip():
            raise ValueError("Field cannot be empty")
        if len(v) > 100:
            raise ValueError("Field must be 100 characters or less")
        return v.strip()

    @field_validator('status')
    @classmethod
    def validate_status(cls, v: str) -> str:
        """Validate vehicle status."""
        valid_statuses = {'available', 'assigned', 'planned', 'maintenance'}
        if v not in valid_statuses:
            raise ValueError(f"Status must be one of: {', '.join(valid_statuses)}")
        return v

    @field_validator('display_order')
    @classmethod
    def validate_display_order(cls, v: int) -> int:
        """Validate display order is non-negative."""
        if v < 0:
            raise ValueError("Display order must be non-negative")
        return v


class VehicleCreate(VehicleBase):
    """Schema for creating vehicle."""

    pass


class VehicleUpdate(BaseModel):
    """Schema for updating vehicle."""

    name: Optional[str] = None
    type: Optional[str] = None
    display_order: Optional[int] = None
    status: Optional[str] = None
    radio_call_sign: Optional[str] = None


class Vehicle(VehicleBase):
    """Full vehicle schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


class VehicleStatusResponse(BaseModel):
    """Vehicle status with driver and incident information."""

    model_config = ConfigDict(from_attributes=True)

    # Vehicle details
    id: UUID
    name: str
    type: str
    status: str
    radio_call_sign: str

    # Driver information (if assigned for the event)
    driver_id: Optional[UUID] = None
    driver_name: Optional[str] = None
    driver_assigned_at: Optional[datetime] = None

    # Current incident assignment (if any)
    incident_id: Optional[UUID] = None
    incident_title: Optional[str] = None
    incident_location_address: Optional[str] = None
    incident_status: Optional[str] = None  # The column it's in
    incident_assigned_at: Optional[datetime] = None  # When vehicle was assigned to incident
    assignment_duration_minutes: Optional[int] = None  # Auto-calculated field


# ============================================
# Material Schemas
# ============================================


class MaterialBase(BaseModel):
    """Base material schema."""

    name: str
    type: str  # Material type (e.g., 'Tauchpumpen', 'Wassersauger', 'Sägen', 'Generatoren', 'Anhänger')
    location: str  # Storage location (e.g., 'TLF', 'Pio', 'MoWa', 'Bühne', 'Depot')
    location_sort_order: int = 0
    description: Optional[str] = None
    status: str = "available"  # 'available', 'assigned', 'planned', 'maintenance'

    @field_validator('name', 'type', 'location')
    @classmethod
    def validate_required_strings(cls, v: str) -> str:
        """Validate required string fields."""
        if not v or not v.strip():
            raise ValueError("Field cannot be empty")
        if len(v) > 100:
            raise ValueError("Field must be 100 characters or less")
        return v.strip()

    @field_validator('description')
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        """Validate description length if provided."""
        if v and len(v) > 500:
            raise ValueError("Description must be 500 characters or less")
        return v.strip() if v else v

    @field_validator('status')
    @classmethod
    def validate_status(cls, v: str) -> str:
        """Validate material status."""
        valid_statuses = {'available', 'assigned', 'planned', 'maintenance'}
        if v not in valid_statuses:
            raise ValueError(f"Status must be one of: {', '.join(valid_statuses)}")
        return v

    @field_validator('location_sort_order')
    @classmethod
    def validate_sort_order(cls, v: int) -> int:
        """Validate sort order is non-negative."""
        if v < 0:
            raise ValueError("Sort order must be non-negative")
        return v


class MaterialCreate(MaterialBase):
    """Schema for creating material."""

    pass


class MaterialUpdate(BaseModel):
    """Schema for updating material."""

    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    location_sort_order: Optional[int] = None
    description: Optional[str] = None
    status: Optional[str] = None


class Material(MaterialBase):
    """Full material schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


# ============================================
# Event Schemas
# ============================================


class EventBase(BaseModel):
    """Base schema for Event."""

    name: str
    training_flag: bool = False
    auto_attach_divera: bool = False


class EventCreate(EventBase):
    """Schema for creating a new event."""

    pass


class EventUpdate(BaseModel):
    """Schema for updating an event."""

    name: Optional[str] = None
    training_flag: Optional[bool] = None
    auto_attach_divera: Optional[bool] = None
    archived_at: Optional[datetime] = None  # For archiving


class EventResponse(EventBase):
    """Schema for event responses."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    last_activity_at: datetime
    auto_attach_divera: bool
    incident_count: int = 0  # Computed field


class EventListResponse(BaseModel):
    """Schema for event list responses."""

    events: list[EventResponse]
    total: int


# ============================================
# Incident Schemas
# ============================================


class IncidentType(str, Enum):
    """Incident type enumeration."""

    BRANDBEKAEMPFUNG = "brandbekaempfung"
    ELEMENTAREREIGNIS = "elementarereignis"
    STRASSENRETTUNG = "strassenrettung"
    TECHNISCHE_HILFELEISTUNG = "technische_hilfeleistung"
    OELWEHR = "oelwehr"
    CHEMIEWEHR = "chemiewehr"
    STRAHLENWEHR = "strahlenwehr"
    EINSATZ_BAHNANLAGEN = "einsatz_bahnanlagen"
    BMA_UNECHTE_ALARME = "bma_unechte_alarme"
    DIENSTLEISTUNGEN = "dienstleistungen"
    DIVERSE_EINSAETZE = "diverse_einsaetze"
    GERETTETE_MENSCHEN = "gerettete_menschen"
    GERETTETE_TIERE = "gerettete_tiere"


class IncidentPriority(str, Enum):
    """Incident priority enumeration."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class IncidentStatus(str, Enum):
    """Incident status enumeration."""

    EINGEGANGEN = "eingegangen"
    REKO = "reko"
    DISPONIERT = "disponiert"
    EINSATZ = "einsatz"
    EINSATZ_BEENDET = "einsatz_beendet"
    ABSCHLUSS = "abschluss"


class IncidentBase(BaseModel):
    """Base incident schema."""

    title: str
    type: IncidentType
    priority: IncidentPriority
    location_address: Optional[str] = None
    location_lat: Optional[Union[str, Decimal]] = None
    location_lng: Optional[Union[str, Decimal]] = None
    status: IncidentStatus = IncidentStatus.EINGEGANGEN
    description: Optional[str] = None
    contact: Optional[str] = None
    internal_notes: Optional[str] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v: str) -> str:
        """Validate incident title."""
        if not v or not v.strip():
            raise ValueError("Title cannot be empty")
        if len(v) > 200:
            raise ValueError("Title must be 200 characters or less")
        return v.strip()

    @field_validator('location_lat')
    @classmethod
    def validate_latitude(cls, v: Optional[Union[str, Decimal]]) -> Optional[Union[str, Decimal]]:
        """Validate latitude is within valid range."""
        if v is not None:
            try:
                lat_val = float(str(v))
                if not -90 <= lat_val <= 90:
                    raise ValueError("Latitude must be between -90 and 90 degrees")
            except (ValueError, TypeError) as e:
                if "Latitude must be between" not in str(e):
                    raise ValueError("Invalid latitude value")
                raise
        return v

    @field_validator('location_lng')
    @classmethod
    def validate_longitude(cls, v: Optional[Union[str, Decimal]]) -> Optional[Union[str, Decimal]]:
        """Validate longitude is within valid range."""
        if v is not None:
            try:
                lng_val = float(str(v))
                if not -180 <= lng_val <= 180:
                    raise ValueError("Longitude must be between -180 and 180 degrees")
            except (ValueError, TypeError) as e:
                if "Longitude must be between" not in str(e):
                    raise ValueError("Invalid longitude value")
                raise
        return v

    @field_validator('description')
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        """Validate description length if provided."""
        if v and len(v) > 2000:
            raise ValueError("Description must be 2000 characters or less")
        return v.strip() if v else v


class IncidentCreate(IncidentBase):
    """Schema for creating incident."""

    event_id: UUID  # Required for creating incidents


class IncidentUpdate(BaseModel):
    """Schema for updating incident."""

    title: Optional[str] = None
    type: Optional[IncidentType] = None
    priority: Optional[IncidentPriority] = None
    location_address: Optional[str] = None
    location_lat: Optional[Union[str, Decimal]] = None
    location_lng: Optional[Union[str, Decimal]] = None
    status: Optional[IncidentStatus] = None
    description: Optional[str] = None
    contact: Optional[str] = None
    internal_notes: Optional[str] = None
    # training_flag intentionally excluded (use separate endpoint)


class AssignedVehicle(BaseModel):
    """Vehicle with assignment information."""

    model_config = ConfigDict(from_attributes=True)

    assignment_id: UUID  # ID of the assignment record
    vehicle_id: UUID
    name: str
    type: str
    assigned_at: datetime


class IncidentResponse(IncidentBase):
    """Full incident schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID  # Include event_id in responses
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    status_changed_at: Optional[datetime] = None  # Timestamp of last status transition
    assigned_vehicles: list[AssignedVehicle] = []  # List of assigned vehicles with details
    has_completed_reko: bool = False  # Whether a non-draft reko report has been submitted

    @field_serializer('location_lat', 'location_lng')
    def serialize_decimal(self, value):
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


# ============================================
# Assignment Schemas
# ============================================


class AssignmentCreate(BaseModel):
    """Schema for creating resource assignment."""

    resource_type: str  # 'personnel', 'vehicle', 'material'
    resource_id: UUID


class AssignmentResponse(BaseModel):
    """Assignment response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    resource_type: str
    resource_id: UUID
    assigned_at: datetime
    unassigned_at: Optional[datetime] = None
    assigned_by: Optional[UUID] = None


# ============================================
# Status Transition Schemas
# ============================================


class StatusTransitionCreate(BaseModel):
    """Schema for creating status transition."""

    from_status: IncidentStatus
    to_status: IncidentStatus
    notes: Optional[str] = None


class StatusTransitionResponse(BaseModel):
    """Status transition response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    from_status: str
    to_status: str
    timestamp: datetime
    user_id: Optional[UUID] = None
    notes: Optional[str] = None


# ============================================
# User Schemas
# ============================================


class UserBase(BaseModel):
    """Base user schema."""

    username: str
    role: str  # 'editor', 'viewer'


class UserCreate(UserBase):
    """Schema for creating user."""

    password: str


class User(UserBase):
    """Full user schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    last_login: Optional[datetime] = None


# Alias for API responses (matches task specification)
UserResponse = User


# ============================================
# Setting Schemas
# ============================================


class SettingBase(BaseModel):
    """Base setting schema."""

    key: str
    value: str


class SettingUpdate(BaseModel):
    """Schema for updating setting."""

    value: str


class Setting(SettingBase):
    """Full setting schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    updated_at: datetime
    updated_by: Optional[UUID] = None


# ============================================
# Reko Report Schemas
# ============================================


class DangersAssessment(BaseModel):
    """Structured danger checklist."""

    fire: bool = False
    explosion: bool = False
    collapse: bool = False
    chemical: bool = False
    electrical: bool = False
    other_notes: Optional[str] = None


class EffortEstimation(BaseModel):
    """Resource effort estimation."""

    personnel_count: Optional[int] = None
    vehicles_needed: list[str] = []
    equipment_needed: list[str] = []
    estimated_duration_hours: Optional[float] = None


class RekoReportBase(BaseModel):
    """Base schema for Reko reports."""

    is_relevant: Optional[bool] = None
    dangers_json: Optional[DangersAssessment] = None
    effort_json: Optional[EffortEstimation] = None
    power_supply: Optional[str] = None  # 'available' | 'unavailable' | 'emergency_needed'
    summary_text: Optional[str] = None
    additional_notes: Optional[str] = None
    is_draft: bool = False


class RekoReportCreate(RekoReportBase):
    """Schema for creating Reko report."""

    incident_id: UUID
    token: str


class RekoReportUpdate(RekoReportBase):
    """Schema for updating Reko report."""

    pass


class RekoReportResponse(RekoReportBase):
    """Full Reko report schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    incident_title: Optional[str] = None  # Computed from incident.title
    incident_location: Optional[str] = None  # Computed from incident.location_address
    incident_type: Optional[str] = None  # Computed from incident.type
    incident_description: Optional[str] = None  # Computed from incident.description
    submitted_at: datetime
    updated_at: datetime
    photos_json: list[str] = []  # Array of photo filenames

    @field_validator('photos_json', mode='before')
    @classmethod
    def ensure_photos_list(cls, v):
        """Convert None to empty list for photos_json."""
        if v is None:
            return []
        return v


# ============================================
# Audit Log Schemas
# ============================================


class AuditLogEntry(BaseModel):
    """Audit log entry schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: Optional[UUID] = None
    action_type: str
    resource_type: str
    resource_id: Optional[UUID] = None
    changes_json: Optional[dict] = None
    timestamp: datetime
    ip_address: Optional[Union[str, IPv4Address, IPv6Address]] = None
    user_agent: Optional[str] = None

    @field_serializer('ip_address')
    def serialize_ip_address(self, ip_address: Optional[Union[str, IPv4Address, IPv6Address]], _info) -> Optional[str]:
        """Convert IPv4Address/IPv6Address to string."""
        if ip_address is None:
            return None
        return str(ip_address)


# ============================================
# Excel Import/Export Schemas
# ============================================


class ExcelImportPreview(BaseModel):
    """Preview of Excel import data."""

    personnel_preview: list[dict]
    personnel_total: int
    vehicles_preview: list[dict]
    vehicles_total: int
    materials_preview: list[dict]
    materials_total: int


class ExcelImportResult(BaseModel):
    """Result of Excel import operation."""

    success: bool
    mode: str
    counts: dict[str, int]
    timestamp: datetime


# ============================================
# Notification Schemas
# ============================================


class NotificationSeverity(str, Enum):
    """Notification severity levels."""

    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class NotificationType(str, Enum):
    """Notification types."""

    TIME_OVERDUE = "time_overdue"
    NO_PERSONNEL = "no_personnel"
    NO_MATERIALS = "no_materials"
    PERSONNEL_FATIGUE = "personnel_fatigue"
    MISSING_LOCATION = "missing_location"
    EVENT_SIZE_LIMIT = "event_size_limit"
    TRAINING_EMERGENCY = "training_emergency"


class NotificationResponse(BaseModel):
    """Notification response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: NotificationType
    severity: NotificationSeverity
    message: str
    incident_id: Optional[UUID] = None
    event_id: Optional[UUID] = None
    created_at: datetime
    dismissed: bool
    dismissed_at: Optional[datetime] = None
    dismissed_by: Optional[UUID] = None


class NotificationDismiss(BaseModel):
    """Schema for dismissing a notification."""

    pass  # No body needed, user comes from auth


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
    # When 0 (default), dismissed notifications never re-appear
    # When > 0, dismissed notifications can re-appear after this many minutes
    re_alarm_interval_min: int = 0

    # Enabled alerts (can toggle individual types)
    enabled_time_alerts: bool = True
    enabled_resource_alerts: bool = True
    enabled_data_quality_alerts: bool = True
    enabled_event_alerts: bool = True

    def get_threshold_minutes(self, status: str, is_training: bool) -> int:
        """Get threshold in minutes for a given status and mode."""
        prefix = "training" if is_training else "live"

        # Map status to threshold field
        status_map = {
            "eingegangen": f"{prefix}_eingegangen_min",
            "reko": f"{prefix}_reko_min",
            "disponiert": f"{prefix}_disponiert_min",
            "einsatz": f"{prefix}_einsatz_hours",
            "einsatz_beendet": f"{prefix}_rueckfahrt_min",
            "abschluss": f"{prefix}_archive_hours",
        }

        field_name = status_map.get(status)
        if not field_name:
            return 60  # Default fallback

        value = getattr(self, field_name, 60)

        # Convert hours to minutes for einsatz and abschluss
        if "hours" in field_name:
            return value * 60

        return value


class NotificationSettingsUpdate(BaseModel):
    """Schema for updating notification settings."""

    # All fields are optional for partial updates
    live_eingegangen_min: Optional[int] = None
    live_reko_min: Optional[int] = None
    live_disponiert_min: Optional[int] = None
    live_einsatz_hours: Optional[int] = None
    live_rueckfahrt_min: Optional[int] = None
    live_archive_hours: Optional[int] = None

    training_eingegangen_min: Optional[int] = None
    training_reko_min: Optional[int] = None
    training_disponiert_min: Optional[int] = None
    training_einsatz_hours: Optional[int] = None
    training_rueckfahrt_min: Optional[int] = None
    training_archive_hours: Optional[int] = None

    fatigue_hours: Optional[int] = None
    material_depletion_threshold: Optional[dict[str, int]] = None
    database_size_limit_gb: Optional[int] = None
    photo_size_limit_gb: Optional[int] = None

    re_alarm_interval_min: Optional[int] = None

    enabled_time_alerts: Optional[bool] = None
    enabled_resource_alerts: Optional[bool] = None
    enabled_data_quality_alerts: Optional[bool] = None
    enabled_event_alerts: Optional[bool] = None

    @field_validator('live_eingegangen_min', 'live_reko_min', 'live_disponiert_min',
                    'live_rueckfahrt_min', 'training_eingegangen_min', 'training_reko_min',
                    'training_disponiert_min', 'training_rueckfahrt_min', 're_alarm_interval_min')
    @classmethod
    def validate_minute_fields(cls, v: Optional[int]) -> Optional[int]:
        """Validate minute fields are positive or zero."""
        if v is not None:
            if v < 0:
                raise ValueError("Time in minutes must be non-negative")
            if v > 1440:  # 24 hours
                raise ValueError("Time in minutes should not exceed 24 hours (1440 minutes)")
        return v

    @field_validator('live_einsatz_hours', 'live_archive_hours',
                    'training_einsatz_hours', 'training_archive_hours', 'fatigue_hours')
    @classmethod
    def validate_hour_fields(cls, v: Optional[int]) -> Optional[int]:
        """Validate hour fields are positive."""
        if v is not None:
            if v < 0:
                raise ValueError("Time in hours must be non-negative")
            if v > 168:  # 1 week
                raise ValueError("Time in hours should not exceed 1 week (168 hours)")
        return v

    @field_validator('database_size_limit_gb', 'photo_size_limit_gb')
    @classmethod
    def validate_size_limits(cls, v: Optional[int]) -> Optional[int]:
        """Validate size limits are reasonable."""
        if v is not None:
            if v < 1:
                raise ValueError("Size limit must be at least 1 GB")
            if v > 100:
                raise ValueError("Size limit should not exceed 100 GB")
        return v


# ============================================
# Training Automation Schemas
# ============================================


class EmergencyTemplateBase(BaseModel):
    """Base schema for emergency template."""

    title_pattern: str
    incident_type: str
    category: str  # 'normal' or 'critical'
    message_pattern: str


class EmergencyTemplateCreate(EmergencyTemplateBase):
    """Schema for creating emergency template."""

    pass


class EmergencyTemplateResponse(EmergencyTemplateBase):
    """Schema for emergency template response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    is_active: bool


class TrainingLocationBase(BaseModel):
    """Base schema for training location."""

    street: str
    house_number: str
    postal_code: str = "4104"
    city: str = "Oberwil"
    building_type: Optional[str] = None
    latitude: Optional[Union[str, Decimal]] = None
    longitude: Optional[Union[str, Decimal]] = None

    @field_validator('street')
    @classmethod
    def validate_street(cls, v: str) -> str:
        """Validate street name."""
        if not v or not v.strip():
            raise ValueError("Street cannot be empty")
        if len(v) > 100:
            raise ValueError("Street must be 100 characters or less")
        return v.strip()

    @field_validator('house_number')
    @classmethod
    def validate_house_number(cls, v: str) -> str:
        """Validate house number format."""
        if not v or not v.strip():
            raise ValueError("House number cannot be empty")
        # Allow formats like "12", "12a", "12-14", etc.
        if not re.match(r'^[\d]+[a-zA-Z\-\/]*$', v.strip()):
            raise ValueError("Invalid house number format")
        return v.strip()

    @field_validator('postal_code')
    @classmethod
    def validate_postal_code(cls, v: str) -> str:
        """Validate Swiss postal code."""
        if not re.match(r'^\d{4}$', v):
            raise ValueError("Postal code must be 4 digits")
        # Basel-Landschaft postal codes typically range from 4000-4499
        code = int(v)
        if not (4000 <= code <= 4499):
            raise ValueError("Postal code should be in Basel-Landschaft range (4000-4499)")
        return v

    @field_validator('latitude')
    @classmethod
    def validate_latitude(cls, v: Optional[Union[str, Decimal]]) -> Optional[Union[str, Decimal]]:
        """Validate latitude is within Basel-Landschaft area."""
        if v is not None:
            try:
                lat_val = float(str(v))
                # Basel-Landschaft approximate latitude range
                if not (47.3 <= lat_val <= 47.6):
                    raise ValueError("Latitude should be within Basel-Landschaft area (47.3 to 47.6)")
            except (ValueError, TypeError) as e:
                if "Latitude should be" not in str(e):
                    raise ValueError("Invalid latitude value")
                raise
        return v

    @field_validator('longitude')
    @classmethod
    def validate_longitude(cls, v: Optional[Union[str, Decimal]]) -> Optional[Union[str, Decimal]]:
        """Validate longitude is within Basel-Landschaft area."""
        if v is not None:
            try:
                lng_val = float(str(v))
                # Basel-Landschaft approximate longitude range
                if not (7.3 <= lng_val <= 7.9):
                    raise ValueError("Longitude should be within Basel-Landschaft area (7.3 to 7.9)")
            except (ValueError, TypeError) as e:
                if "Longitude should be" not in str(e):
                    raise ValueError("Invalid longitude value")
                raise
        return v

    @field_serializer('latitude', 'longitude')
    def serialize_decimal(self, value):
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


class TrainingLocationCreate(TrainingLocationBase):
    """Schema for creating training location."""

    pass


class TrainingLocationResponse(TrainingLocationBase):
    """Schema for training location response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool

    def get_full_address(self) -> str:
        return f"{self.street} {self.house_number}, {self.postal_code} {self.city}"


class TrainingAutoGenSettings(BaseModel):
    """Schema for training auto-generation settings."""

    enabled: bool = False
    min_interval_sec: int = 120
    max_interval_sec: int = 420
    normal_weight: int = 90
    critical_weight: int = 10
    early_multiplier: float = 2.0


class GenerateEmergencyRequest(BaseModel):
    """Schema for manual emergency generation request."""

    category: Optional[str] = None  # 'normal', 'critical', or None for random
    count: int = 1  # For burst generation (1-10)


# ============================================
# Stats Schemas
# ============================================


class PersonnelActivity(BaseModel):
    """Personnel activity tracking for fatigue monitoring."""

    personnel_id: UUID
    name: str
    role: Optional[str] = None
    availability: str
    active_duration_minutes: int  # Time since checked in (for assigned personnel)
    assignment_count: int  # Number of incidents assigned to
    current_incident_title: Optional[str] = None  # Current incident title if assigned
    checked_in_at: Optional[datetime] = None


class EventStats(BaseModel):
    """Real-time statistics for an event."""

    status_counts: dict[str, int]  # Count of incidents by status
    personnel_available: int  # Number of available personnel
    personnel_total: int  # Total number of personnel
    avg_duration_minutes: int  # Average incident duration in minutes
    resource_utilization_percent: float  # Percentage of personnel assigned
    personnel_activity: list[PersonnelActivity] = []  # Personnel activity tracking


# ============================================
# Sync Schemas
# ============================================


class SyncDirection(str, Enum):
    """Sync direction enumeration."""

    FROM_RAILWAY = "from_railway"
    TO_RAILWAY = "to_railway"


class SyncStatus(str, Enum):
    """Sync status enumeration."""

    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"
    IN_PROGRESS = "in_progress"


class SyncResult(BaseModel):
    """Result of a sync operation."""

    success: bool
    direction: SyncDirection
    records_synced: dict[str, int]  # e.g., {"incidents": 5, "personnel": 2}
    errors: Optional[list[str]] = None
    started_at: datetime
    completed_at: Optional[datetime] = None


class Delta(BaseModel):
    """Delta of changes between Railway and Local.

    NOTE: Users are NOT synced - they are authentication records managed per environment.
    Incidents reference users via created_by, so users must exist on both systems independently.
    """

    events: list[dict] = []
    incidents: list[dict] = []
    personnel: list[dict] = []
    vehicles: list[dict] = []
    materials: list[dict] = []
    settings: list[dict] = []
    total_records: int = 0


class SyncStatusResponse(BaseModel):
    """Current sync status response."""

    last_sync: Optional[datetime] = None
    direction: Optional[SyncDirection] = None
    railway_healthy: bool
    is_syncing: bool
    records_pending: int = 0
    last_error: Optional[str] = None


class SyncLogResponse(BaseModel):
    """Sync log entry response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sync_direction: SyncDirection
    started_at: datetime
    completed_at: Optional[datetime] = None
    status: SyncStatus
    records_synced: Optional[dict] = None
    errors: Optional[dict] = None


# ============================================
# Divera Integration Schemas
# ============================================


class DiveraWebhookPayload(BaseModel):
    """Divera 24/7 webhook payload structure (actual format from Divera PRO)."""

    id: int
    number: Optional[str] = None  # Incident number like "E-123"
    title: str
    text: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    priority: int = 0  # 0 = low, 1 = medium, 2 = high (assumed)
    cluster: Optional[list[str]] = None  # e.g., ["Untereinheit 1"]
    group: Optional[list[str]] = None  # e.g., ["Gruppe 1", "Gruppe 2"]
    vehicle: Optional[list[str]] = None  # e.g., ["HLF-1", "LF-10"]
    ts_create: Optional[int] = None  # Unix timestamp
    ts_update: Optional[int] = None  # Unix timestamp


class DiveraEmergencyResponse(BaseModel):
    """Divera emergency response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    divera_id: int
    divera_number: Optional[str] = None
    title: str
    text: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[Union[str, Decimal]] = None
    longitude: Optional[Union[str, Decimal]] = None
    priority: int  # 0=low, 1=medium, 2=high
    received_at: datetime
    attached_to_event_id: Optional[UUID] = None
    attached_at: Optional[datetime] = None
    created_incident_id: Optional[UUID] = None
    is_archived: bool

    @field_serializer('latitude', 'longitude')
    def serialize_decimal(self, value):
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


class DiveraEmergencyListResponse(BaseModel):
    """Response for Divera emergency list."""

    emergencies: list[DiveraEmergencyResponse]
    total: int
    unattached_count: int


class AttachEmergencyRequest(BaseModel):
    """Request to attach a Divera emergency to an Event."""

    event_id: UUID


class BulkAttachEmergenciesRequest(BaseModel):
    """Request to attach multiple Divera emergencies to an Event."""

    event_id: UUID
    emergency_ids: list[UUID]

    @field_validator('emergency_ids')
    @classmethod
    def validate_emergency_ids(cls, v: list[UUID]) -> list[UUID]:
        """Validate emergency IDs list."""
        if not v or len(v) == 0:
            raise ValueError("Must provide at least one emergency ID")
        if len(v) > 100:
            raise ValueError("Cannot attach more than 100 emergencies at once")
        return v


class AutoAttachSettingRequest(BaseModel):
    """Request to enable/disable auto-attach for an Event."""

    event_id: UUID
    enabled: bool


# ============================================
# Transfer Assignments Schemas
# ============================================


class TransferAssignmentsRequest(BaseModel):
    """Request to transfer all assignments from one incident to another."""

    target_incident_id: UUID


class TransferAssignmentsResponse(BaseModel):
    """Response from assignment transfer operation."""

    transferred_count: int
    assignment_ids: list[UUID]
    message: str
