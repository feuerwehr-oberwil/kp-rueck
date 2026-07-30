"""Auftrag (incident group) schemas — an ordered multi-stop route over incidents."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GroupProgress(BaseModel):
    """Derived checklist roll-up of an Auftrag's member stops.

    `done` counts stops in ``returning`` / ``complete``.
    """

    total: int = 0
    done: int = 0


class IncidentGroupBase(BaseModel):
    """Base Auftrag schema."""

    name: str
    color: str | None = None
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate Auftrag name."""
        if not v or not v.strip():
            raise ValueError("Name cannot be empty")
        if len(v) > 200:
            raise ValueError("Name must be 200 characters or less")
        return v.strip()

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v: str | None) -> str | None:
        """Validate notes length if provided."""
        if v and len(v) > 2000:
            raise ValueError("Notes must be 2000 characters or less")
        return v.strip() if v else v


class IncidentGroupCreate(IncidentGroupBase):
    """Schema for creating an Auftrag."""

    event_id: UUID


class IncidentGroupUpdate(BaseModel):
    """Schema for updating an Auftrag (partial PATCH)."""

    name: str | None = None
    color: str | None = None
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        """Validate Auftrag name when provided."""
        if v is None:
            return v
        if not v.strip():
            raise ValueError("Name cannot be empty")
        if len(v) > 200:
            raise ValueError("Name must be 200 characters or less")
        return v.strip()

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v: str | None) -> str | None:
        """Validate notes length if provided."""
        if v and len(v) > 2000:
            raise ValueError("Notes must be 2000 characters or less")
        return v.strip() if v else v


class GroupAssignmentCreate(BaseModel):
    """Assign a resource directly to an Auftrag (shared across all its stops).

    Mirrors ``AssignmentCreate``. A resource can be assigned to an Auftrag even
    when it has zero stops.
    """

    resource_type: str  # 'personnel', 'vehicle', 'material'
    resource_id: UUID

    @field_validator("resource_type")
    @classmethod
    def validate_resource_type(cls, v: str) -> str:
        """Validate resource type is one of the allowed values."""
        valid_types = {"personnel", "vehicle", "material"}
        if v not in valid_types:
            raise ValueError(f"resource_type must be one of: {', '.join(sorted(valid_types))}")
        return v


class GroupAssignmentResponse(BaseModel):
    """Auftrag-level assignment response (mirrors ``AssignmentResponse``)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_group_id: UUID
    resource_type: str
    resource_id: UUID
    assigned_at: datetime
    unassigned_at: datetime | None = None
    assigned_by: UUID | None = None
    driver_stay: bool = False


class IncidentGroupResponse(IncidentGroupBase):
    """Full Auftrag schema with database fields plus derived read fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    position: int = 0
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    # Derived read fields (member incident ids in group_position order + roll-up)
    stop_ids: list[UUID] = []
    progress: GroupProgress = Field(default_factory=GroupProgress)
    # Route-level resource assignments (active only), shared across all stops.
    assignments: list[GroupAssignmentResponse] = []
    # What was last read out over the radio for this Auftrag (see IncidentGroup).
    last_announced_at: datetime | None = None
    last_announced_fingerprint: str | None = None
    last_announced_stop_id: UUID | None = None
    last_announced_full: bool = False


class IncidentGroupReorder(BaseModel):
    """Reorder the Aufträge within an event (mirror IncidentReorder)."""

    event_id: UUID
    ordered_ids: list[UUID]


class GroupStopsReorder(BaseModel):
    """Reorder the stops within a single Auftrag."""

    ordered_ids: list[UUID]


class AddStopsRequest(BaseModel):
    """Attach existing incidents to an Auftrag as stops (appended to the end)."""

    incident_ids: list[UUID]


class GroupAnnouncementRequest(BaseModel):
    """Record that a Funkdurchsage was made for an Auftrag.

    ``fingerprint`` is an opaque digest of the route's crew/vehicles/material as
    the client saw them when it built the announcement — the server stores it and
    never interprets it. The next stop compares its own digest against this one:
    equal means the short «weiter mit Stop N» form, different means the route
    gained resources and the full announcement is due again.
    """

    fingerprint: str
    stop_id: UUID | None = None
    full: bool = False

    @field_validator("fingerprint")
    @classmethod
    def validate_fingerprint(cls, v: str) -> str:
        """Keep the digest bounded — it is a digest, not a payload.

        A rejected fingerprint only costs one extra full announcement, which is
        the harmless direction, so a hard cap is safe here.
        """
        if len(v) > 2000:
            raise ValueError("Fingerprint must be 2000 characters or less")
        return v
