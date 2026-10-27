"""Personnel + check-in schemas."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, StringConstraints, field_validator

from .fields import OptionalText50, PersonName, SortOrder, reject_null


def _personnel_status(v: str) -> str:
    """Map the legacy duty statuses onto the two the column holds, refuse anything else."""
    valid_statuses = {"available", "unavailable"}
    status_mapping = {
        "assigned": "available",
        "off_duty": "unavailable",
        "inactive": "unavailable",
    }
    if v in status_mapping:
        return status_mapping[v]
    if v not in valid_statuses:
        raise ValueError(f"Status must be one of: {', '.join(sorted(valid_statuses))}")
    return v


PersonnelStatus = Annotated[str, AfterValidator(_personnel_status)]


def _blank_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


# What tells two people of the same name apart (Jahrgang «1985», Personal-Nr. «412»):
# stripped, at most 20 characters, and a blank cell or field means "none" – stored as null,
# never as "". Name + Kennung is unique among the roster (`crud.personnel.find_name_clash`).
Kennung = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)] | None,
    BeforeValidator(_blank_to_none),
]


class PersonnelBase(BaseModel):
    """Base personnel schema."""

    name: PersonName
    kennung: Kennung = None
    role: OptionalText50 | None = None
    role_sort_order: SortOrder = 0
    status: PersonnelStatus  # 'available', 'unavailable'
    tags: list[str] | None = None


class PersonnelCreate(PersonnelBase):
    """Schema for creating personnel."""


class PersonnelUpdate(BaseModel):
    """Schema for updating personnel: same field rules as create, every field optional.

    `kennung`, `role` and `tags` may be cleared with null; the other columns cannot be empty.
    """

    name: PersonName | None = None
    kennung: Kennung = None
    role: OptionalText50 | None = None
    role_sort_order: SortOrder | None = None
    status: PersonnelStatus | None = None
    tags: list[str] | None = None

    _not_null = field_validator("name", "role_sort_order", "status")(reject_null)


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
    # Whether this person has a Divera identity in `personnel_external_identities`
    # (i.e. is addressable for outbound alarms). The provider-side id itself stays
    # server-side; the UI only needs the yes/no.
    divera_linked: bool = False
    checked_in: bool = False
    checked_in_at: datetime | None = None
    checked_out_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# Check-in schemas
class PersonnelCheckInResponse(BaseModel):
    """Response with check-in status."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kennung: str | None = None
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
    kennung: str | None = None
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
    """One checked-in person's time on duty (``GET /events/{id}/stats``, `api/stats.py`)."""

    personnel_id: UUID
    name: str
    role: str | None = None
    status: str  # "assigned" while on an incident or Auftrag, else the roster status
    active_duration_minutes: int  # Time on duty: since checked_in_at (arrival), not since the current assignment
    assignment_count: int  # Einsätze worked this Ereignis: distinct incidents + Aufträge, finished and current
    assigned_minutes: int = 0  # Time on an incident or Auftrag since check-in (overlaps once); the rest is Pause
    current_incident_title: str | None = None  # Where they are now (short address / Auftrag name), « · »-joined
    checked_in_at: datetime | None = None
