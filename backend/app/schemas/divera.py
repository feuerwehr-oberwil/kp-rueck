"""Divera 24/7 integration — emergency pool + personnel sync."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator


class DiveraWebhookPayload(BaseModel):
    """Divera 24/7 webhook payload structure (actual format from Divera PRO)."""

    id: int
    number: str | None = None  # Incident number like "E-123"
    title: str
    text: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    # priority is inferred from title/text content, not from Divera payload
    cluster: list[str] | None = None
    group: list[str] | None = None
    vehicle: list[str] | None = None
    ts_create: int | None = None
    ts_update: int | None = None


class DiveraEmergencyResponse(BaseModel):
    """Divera emergency response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    divera_id: int
    divera_number: str | None = None
    title: str
    text: str | None = None
    address: str | None = None
    latitude: str | Decimal | None = None
    longitude: str | Decimal | None = None
    received_at: datetime
    attached_to_event_id: UUID | None = None
    attached_at: datetime | None = None
    created_incident_id: UUID | None = None
    is_archived: bool

    @field_serializer("latitude", "longitude")
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

    @field_validator("emergency_ids")
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


# Personnel sync
class DiveraMemberPreview(BaseModel):
    """Preview of a single Divera member."""

    divera_id: int
    name: str


class DiveraSyncPreviewItem(BaseModel):
    """A single item in the sync preview."""

    member: DiveraMemberPreview
    status: str  # "new" | "unchanged" | "not_in_divera"
    existing_id: UUID | None = None


class DiveraSyncPreview(BaseModel):
    """Full sync preview with categorized items."""

    new: list[DiveraSyncPreviewItem]
    unchanged: list[DiveraSyncPreviewItem]
    not_in_divera: list[DiveraSyncPreviewItem]


class DiveraSyncExecute(BaseModel):
    """Request to execute Divera sync."""

    remove_stale: bool = False


class DiveraSyncResult(BaseModel):
    """Result of sync execution."""

    created: int
    deleted: int
    unchanged: int
