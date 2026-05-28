"""Incident + status-transition + timeline schemas."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator


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
    REKO_DONE = "reko_done"
    DISPONIERT = "disponiert"
    EINSATZ = "einsatz"
    EINSATZ_BEENDET = "einsatz_beendet"
    ABSCHLUSS = "abschluss"


class IncidentBase(BaseModel):
    """Base incident schema."""

    title: str
    type: IncidentType
    priority: IncidentPriority
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    status: IncidentStatus = IncidentStatus.EINGEGANGEN
    description: str | None = None
    contact: str | None = None
    internal_notes: str | None = None
    nachbarhilfe: bool = False
    nachbarhilfe_note: str | None = None
    am_warten: bool = False
    am_warten_note: str | None = None
    zu_fuss: bool = False

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        """Validate incident title."""
        if not v or not v.strip():
            raise ValueError("Title cannot be empty")
        if len(v) > 200:
            raise ValueError("Title must be 200 characters or less")
        return v.strip()

    @field_validator("location_lat")
    @classmethod
    def validate_latitude(cls, v: str | Decimal | None) -> str | Decimal | None:
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

    @field_validator("location_lng")
    @classmethod
    def validate_longitude(cls, v: str | Decimal | None) -> str | Decimal | None:
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

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str | None) -> str | None:
        """Validate description length if provided."""
        if v and len(v) > 2000:
            raise ValueError("Description must be 2000 characters or less")
        return v.strip() if v else v


class IncidentCreate(IncidentBase):
    """Schema for creating incident."""

    event_id: UUID


class IncidentUpdate(BaseModel):
    """Schema for updating incident."""

    title: str | None = None
    type: IncidentType | None = None
    priority: IncidentPriority | None = None
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    status: IncidentStatus | None = None
    description: str | None = None
    contact: str | None = None
    internal_notes: str | None = None
    nachbarhilfe: bool | None = None
    nachbarhilfe_note: str | None = None
    am_warten: bool | None = None
    am_warten_note: str | None = None
    zu_fuss: bool | None = None


class AssignedVehicle(BaseModel):
    """Vehicle with assignment information."""

    model_config = ConfigDict(from_attributes=True)

    assignment_id: UUID
    vehicle_id: UUID
    name: str
    type: str
    assigned_at: datetime
    driver_stay: bool = False


class IncidentResponse(IncidentBase):
    """Full incident schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    completed_at: datetime | None = None
    status_changed_at: datetime | None = None
    assigned_vehicles: list[AssignedVehicle] = []
    has_completed_reko: bool = False
    reko_arrived_at: datetime | None = None

    @field_serializer("location_lat", "location_lng")
    def serialize_decimal(self, value):
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


# Status transitions
class StatusTransitionCreate(BaseModel):
    """Schema for creating status transition."""

    from_status: IncidentStatus
    to_status: IncidentStatus
    notes: str | None = None


class StatusTransitionResponse(BaseModel):
    """Status transition response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    from_status: str
    to_status: str
    timestamp: datetime
    user_id: UUID | None = None
    notes: str | None = None


# Timeline
class IncidentTimelineEvent(BaseModel):
    """A single event on the incident timeline.

    Flat shape with optional fields differentiated by `event_type`:
    - status_change → from_status, to_status, notes
    - assignment    → assignment_action ('assigned' | 'unassigned'),
                      resource_type, resource_name
    """

    event_type: str  # 'status_change' | 'assignment'
    timestamp: datetime
    actor_name: str | None = None

    # status_change fields
    from_status: str | None = None
    to_status: str | None = None
    notes: str | None = None

    # assignment fields
    assignment_action: str | None = None
    resource_type: str | None = None
    resource_name: str | None = None


class IncidentTimelineResponse(BaseModel):
    """Timeline events for an incident, sorted oldest → newest."""

    events: list[IncidentTimelineEvent]
