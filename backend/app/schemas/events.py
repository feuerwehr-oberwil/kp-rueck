"""Event + special-function + event-stats schemas."""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .personnel import PersonnelActivity


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

    name: str | None = None
    training_flag: bool | None = None
    auto_attach_divera: bool | None = None
    archived_at: datetime | None = None


class EventResponse(EventBase):
    """Schema for event responses."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None
    last_activity_at: datetime
    auto_attach_divera: bool
    incident_count: int = 0


class EventListResponse(BaseModel):
    """Schema for event list responses."""

    events: list[EventResponse]
    total: int


# Special functions
class FunctionType(str, Enum):
    """Special function type enumeration."""

    DRIVER = "driver"
    REKO = "reko"
    MAGAZIN = "magazin"


class EventSpecialFunctionCreate(BaseModel):
    """Schema for assigning a special function to personnel."""

    personnel_id: UUID
    function_type: FunctionType
    vehicle_id: UUID | None = None  # Required for driver assignments


class EventSpecialFunctionDelete(BaseModel):
    """Schema for removing a special function assignment."""

    personnel_id: UUID
    function_type: FunctionType
    vehicle_id: UUID | None = None  # Required for driver unassignments


class EventSpecialFunctionResponse(BaseModel):
    """Special function assignment response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    personnel_id: UUID
    personnel_name: str
    function_type: FunctionType
    vehicle_id: UUID | None = None
    vehicle_name: str | None = None
    assigned_at: datetime
    assigned_by: UUID | None = None


# Stats
class EventStats(BaseModel):
    """Real-time statistics for an event."""

    status_counts: dict[str, int]
    personnel_available: int
    personnel_total: int
    avg_duration_minutes: int
    resource_utilization_percent: float
    personnel_activity: list[PersonnelActivity] = []
