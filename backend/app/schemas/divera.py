"""Divera 24/7 integration — emergency pool + personnel sync."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator

from .incidents import IncidentResponse


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
    # Simulated alarm from the Übungssteuerung (never a real Divera alarm)
    is_training: bool = False

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


class BulkAttachEmergenciesResponse(BaseModel):
    """Result of a bulk attach: incidents created plus any per-emergency errors.

    Exposing ``errors`` lets the client report partial failures instead of
    silently treating a partial success as a full one.
    """

    created: list[IncidentResponse]
    errors: list[str] = []


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
    # For "unchanged" matches: whether the local person already has the Divera id
    # stored (i.e. is addressable for outbound alarms). Backfilled on sync if False.
    divera_linked: bool = False


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
    linked: int = 0  # existing people backfilled with their Divera id


# Outbound alarm (ausalarmierung)
class DiveraAlarmRequest(BaseModel):
    """Request to send an outbound Divera alarm for an incident.

    Recipients are the incident's assigned personnel that the operator selected
    in the confirmation sheet. The backend resolves each to its Divera id and
    skips anyone not linked to Divera.
    """

    personnel_ids: list[UUID]
    title: str | None = None  # falls back to the divera.alarm_title_template setting
    text: str | None = None  # falls back to the divera.alarm_text_template setting
    priority: bool = False
    send_push: bool = True
    send_sms: bool = False
    send_call: bool = False
    send_mail: bool = False

    @field_validator("personnel_ids")
    @classmethod
    def validate_personnel_ids(cls, v: list[UUID]) -> list[UUID]:
        """At least one recipient, capped to a sane upper bound."""
        if not v:
            raise ValueError("Must select at least one recipient")
        if len(v) > 200:
            raise ValueError("Cannot alarm more than 200 people at once")
        return v


class DiveraTestAlarmRequest(BaseModel):
    """Request to send a setup test alarm to a single Divera member.

    Targets a Divera user directly (by user_cluster_relation id), so the test
    works even before any local personnel are linked.
    """

    divera_user_id: int
    name: str | None = None


class DiveraAlarmRecipient(BaseModel):
    """One resolved recipient in the alarm result."""

    personnel_id: UUID | None = None  # None for the settings test alarm (no local person)
    name: str
    divera_user_id: int | None = None
    reason: str | None = None  # why skipped, if skipped (e.g. "not linked to Divera")


class DiveraAlarmResponse(BaseModel):
    """Result of an outbound alarm send."""

    success: bool
    foreign_id: str
    divera_alarm_id: int | None = None
    sent: list[DiveraAlarmRecipient] = []
    skipped: list[DiveraAlarmRecipient] = []
    count_recipients: int | None = None
    error: str | None = None
    # True when this was a training run: the flow ran end-to-end but nothing was
    # actually sent to Divera (no external request). Lets the UI show a clearly
    # different "simulated" confirmation instead of a real-send success.
    simulated: bool = False
