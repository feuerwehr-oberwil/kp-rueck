"""Personnel + check-in schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class PersonnelBase(BaseModel):
    """Base personnel schema."""

    name: str
    role: str | None = None
    role_sort_order: int = 0
    status: str  # 'available', 'unavailable'
    tags: list[str] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate personnel name."""
        if not v or not v.strip():
            raise ValueError("Name cannot be empty")
        if len(v) > 100:
            raise ValueError("Name must be 100 characters or less")
        return " ".join(v.split())

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        """Validate duty status."""
        valid_statuses = {"available", "unavailable"}
        status_mapping = {
            "assigned": "available",
            "off_duty": "unavailable",
            "inactive": "unavailable",
        }
        if v in status_mapping:
            return status_mapping[v]
        if v not in valid_statuses:
            raise ValueError(f"Status must be one of: {', '.join(valid_statuses)}")
        return v

    @field_validator("role_sort_order")
    @classmethod
    def validate_sort_order(cls, v: int) -> int:
        """Validate sort order is non-negative."""
        if v < 0:
            raise ValueError("Sort order must be non-negative")
        return v


class PersonnelCreate(PersonnelBase):
    """Schema for creating personnel."""


class PersonnelUpdate(BaseModel):
    """Schema for updating personnel."""

    name: str | None = None
    role: str | None = None
    role_sort_order: int | None = None
    status: str | None = None
    tags: list[str] | None = None
    divera_user_id: int | None = None


class Personnel(PersonnelBase):
    """Full personnel schema with database fields.

    NOTE on the three attendance fields: attendance is a fact about a person *at an
    Ereignis*, and it lives in `event_attendance`. There is no attendance column on the
    personnel row to fall back on any more, so these must be filled in explicitly by
    ``crud.personnel.to_personnel_schema`` from the attendance row of the event that was
    asked about. Without an event there is no answer, and the honest one is "not present".
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    divera_user_id: int | None = None
    checked_in: bool = False
    checked_in_at: datetime | None = None
    checked_out_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# Check-in schemas
class PersonnelCheckInRequest(BaseModel):
    """Request to check in/out a person."""

    personnel_id: UUID
    checked_in: bool  # True = check in, False = check out


class PersonnelCheckInResponse(BaseModel):
    """Response with check-in status."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    role: str | None = None
    status: str
    tags: list[str] | None = None
    checked_in: bool
    checked_in_at: datetime | None = None
    checked_out_at: datetime | None = None
    is_assigned: bool = False  # Whether assigned to any incident in this event


class PersonnelListItem(BaseModel):
    """Simplified personnel info for check-in list."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    role: str | None = None
    status: str = "available"
    tags: list[str] | None = None
    checked_in: bool
    # The board's roll-call distinguishes "never came" from "came and went", which needs
    # both stamps; the phone ignores them and stays two-state on purpose.
    checked_in_at: datetime | None = None
    checked_out_at: datetime | None = None
    is_assigned: bool = False  # Whether assigned to any incident in this event


class CheckInListResponse(BaseModel):
    """Response for check-in list with event information."""

    personnel: list[PersonnelListItem]
    event_id: UUID
    event_name: str


class PersonnelActivity(BaseModel):
    """Personnel activity tracking for fatigue monitoring."""

    personnel_id: UUID
    name: str
    role: str | None = None
    status: str
    active_duration_minutes: int  # Time since checked in (for assigned personnel)
    assignment_count: int  # Number of incidents assigned to
    current_incident_title: str | None = None  # Current incident title if assigned
    checked_in_at: datetime | None = None
