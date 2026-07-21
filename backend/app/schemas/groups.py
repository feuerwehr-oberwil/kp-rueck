"""Auftrag (incident group) schemas — an ordered multi-stop route over incidents."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GroupProgress(BaseModel):
    """Derived checklist roll-up of an Auftrag's member stops.

    `done` counts stops in ``einsatz_beendet`` / ``abschluss``.
    """

    total: int = 0
    done: int = 0


class IncidentGroupBase(BaseModel):
    """Base Auftrag schema."""

    name: str
    color: str | None = None
    mode: Literal["squad", "vehicle_only"] = "squad"
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
    """Schema for updating an Auftrag (partial PATCH — includes the mode toggle)."""

    name: str | None = None
    color: str | None = None
    mode: Literal["squad", "vehicle_only"] | None = None
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


class CopySquadRequest(BaseModel):
    """Copy the source stop's active assignments to all sibling stops.

    ``resource_types`` filters which assignment kinds are copied. ``None`` derives
    the filter from the group's ``mode`` (``squad`` = all three; ``vehicle_only``
    = ``["vehicle"]``).
    """

    source_incident_id: UUID
    resource_types: list[Literal["vehicle", "personnel", "material"]] | None = None
