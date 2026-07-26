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
    contact_phone: str | None = None
    internal_notes: str | None = None
    nachbarhilfe: bool = False
    nachbarhilfe_note: str | None = None
    am_warten: bool = False
    am_warten_note: str | None = None
    zu_fuss: bool = False
    # Auftrag (incident group) membership. Lets the streamlined "add stop" create
    # an incident already attached to a route.
    group_id: UUID | None = None

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
                    raise ValueError("Invalid latitude value") from e
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
                    raise ValueError("Invalid longitude value") from e
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


class PublicIncidentCreate(BaseModel):
    """Lean schema for alarms created via the public token-gated intake form.

    Intentionally narrow: a phone operator / walk-in only provides the essentials.
    The event comes from the token, status is forced to ``eingegangen`` and
    operator-only fields (internal_notes, nachbarhilfe, am_warten, …) are set later
    by an editor on the board. Validators mirror ``IncidentBase``.
    """

    title: str
    type: IncidentType
    priority: IncidentPriority
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    description: str | None = None
    contact: str | None = None  # "Melder / Anrufer"
    contact_phone: str | None = None  # Direct phone number

    # Reuse the shared validators from IncidentBase. `.__func__` unwraps the classmethod so it
    # can be re-registered here; mypy sees the already-bound method and doesn't model the
    # descriptor, hence the narrow ignores. The runtime behaviour is pydantic's documented way
    # of sharing validators between models.
    _validate_title = field_validator("title")(IncidentBase.validate_title.__func__)  # type: ignore[attr-defined]
    _validate_lat = field_validator("location_lat")(IncidentBase.validate_latitude.__func__)  # type: ignore[attr-defined]
    _validate_lng = field_validator("location_lng")(IncidentBase.validate_longitude.__func__)  # type: ignore[attr-defined]
    _validate_description = field_validator("description")(IncidentBase.validate_description.__func__)  # type: ignore[attr-defined]


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
    contact_phone: str | None = None
    internal_notes: str | None = None
    nachbarhilfe: bool | None = None
    nachbarhilfe_note: str | None = None
    am_warten: bool | None = None
    am_warten_note: str | None = None
    zu_fuss: bool | None = None
    # Attach/detach from an Auftrag (incident group) via a normal PATCH.
    group_id: UUID | None = None


class IncidentReorder(BaseModel):
    """Persist the manual top-to-bottom card order for one status column."""

    event_id: UUID
    ordered_ids: list[UUID]


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
    position: int = 0
    # Auftrag (incident group) membership + order of this stop within it.
    group_id: UUID | None = None
    group_position: int = 0
    source: str = "operator"
    # The alarm's id in the delivering system (pool source_id), when the
    # incident was created from a pool alarm.
    source_ref: str | None = None
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    completed_at: datetime | None = None
    status_changed_at: datetime | None = None
    assigned_vehicles: list[AssignedVehicle] = []
    has_completed_reko: bool = False
    reko_arrived_at: datetime | None = None
    # Field crew reported the incident finished; operator decides to close it.
    field_complete_reported_at: datetime | None = None
    # Server-computed short label for location_address (home city stripped) so
    # clients can render the final string on first paint — no reformat flash
    # once the home_city setting loads client-side. "" when the address is only
    # the home city; None when there is no address (or on older backends).
    location_display: str | None = None

    @field_serializer("location_lat", "location_lng")
    def serialize_decimal(self, value: str | Decimal | None) -> str | None:
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
