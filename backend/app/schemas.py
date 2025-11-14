"""Pydantic schemas for request/response validation."""
from datetime import datetime
from decimal import Decimal
from enum import Enum
from ipaddress import IPv4Address, IPv6Address
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator


# ============================================
# Personnel Schemas
# ============================================


class PersonnelBase(BaseModel):
    """Base personnel schema."""

    name: str
    role: Optional[str] = None
    availability: str  # 'available', 'assigned', 'unavailable'
    tags: Optional[list[str]] = None


class PersonnelCreate(PersonnelBase):
    """Schema for creating personnel."""

    pass


class PersonnelUpdate(BaseModel):
    """Schema for updating personnel."""

    name: Optional[str] = None
    role: Optional[str] = None
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
# Vehicle Schemas
# ============================================


class VehicleBase(BaseModel):
    """Base vehicle schema."""

    name: str
    type: str  # Configurable vehicle types (e.g., 'TLF', 'DLK', 'MTW')
    display_order: int
    status: str  # 'available', 'assigned', 'planned', 'maintenance'
    radio_call_sign: str


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


# ============================================
# Material Schemas
# ============================================


class MaterialBase(BaseModel):
    """Base material schema."""

    name: str
    type: str  # Material type (e.g., 'Tauchpumpen', 'Wassersauger', 'Sägen', 'Generatoren', 'Anhänger')
    location: str  # Storage location (e.g., 'TLF', 'Pio', 'MoWa', 'Bühne', 'Depot')
    description: Optional[str] = None
    status: str = "available"  # 'available', 'assigned', 'planned', 'maintenance'


class MaterialCreate(MaterialBase):
    """Schema for creating material."""

    pass


class MaterialUpdate(BaseModel):
    """Schema for updating material."""

    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
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


class EventCreate(EventBase):
    """Schema for creating a new event."""

    pass


class EventUpdate(BaseModel):
    """Schema for updating an event."""

    name: Optional[str] = None
    training_flag: Optional[bool] = None
    archived_at: Optional[datetime] = None  # For archiving


class EventResponse(EventBase):
    """Schema for event responses."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    last_activity_at: datetime
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
    material_depletion_threshold: dict[str, int] = {
        "Tauchpumpen": -1,
        "Wassersauger": -1,
        "Sägen": -1,
        "Generatoren": -1,
        "Anhänger": -1,
        "Elektrowerkzeug": -1,
    }

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


class EventStats(BaseModel):
    """Real-time statistics for an event."""

    status_counts: dict[str, int]  # Count of incidents by status
    personnel_available: int  # Number of available personnel
    personnel_total: int  # Total number of personnel
    avg_duration_minutes: int  # Average incident duration in minutes
    resource_utilization_percent: float  # Percentage of personnel assigned


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
