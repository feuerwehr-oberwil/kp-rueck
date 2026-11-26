"""Event + special-function + event-figures schemas."""

from datetime import datetime
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class EventBase(BaseModel):
    """Base schema for Event."""

    name: str
    training_flag: bool = False
    auto_attach_divera: bool = False


class EventCreate(EventBase):
    """Schema for creating a new event."""


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
    """The roles this release knows by name — documentation, not validation.

    Kept as an enum for the ones the code actually *behaves* differently for and
    for a readable OpenAPI. It is not the authority: since plan 26 (decision 5)
    the values live in ``special_function_types`` so a station can add its own
    without a migration, and ``crud.special_functions`` validates against that
    table.

    Which is why nothing **types a field with it any more.** It used to sit on
    the response schema, so a role the enum had never heard of was accepted on
    the way in and then 500'd on the way out — the create schema said ``str``
    and the response said enum, and the docstring promised the behaviour the
    response denied. `kommandoposten` is the role that found it.
    """

    DRIVER = "driver"
    REKO = "reko"
    MAGAZIN = "magazin"
    TELEFONDIENST = "telefondienst"
    KOMMANDOPOSTEN = "kommandoposten"


class EventSpecialFunctionCreate(BaseModel):
    """Schema for assigning a special function to personnel."""

    personnel_id: UUID
    # `str`, not the enum: the lookup table is the authority (decision 5).
    function_type: str
    vehicle_id: UUID | None = None  # Required for driver assignments


class EventSpecialFunctionDelete(BaseModel):
    """Schema for removing a special function assignment."""

    personnel_id: UUID
    # Same station-defined keys as creation and response schemas.
    function_type: str
    vehicle_id: UUID | None = None  # Required for driver unassignments


class EventSpecialFunctionResponse(BaseModel):
    """Special function assignment response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    personnel_id: UUID
    personnel_name: str
    # `str`, not the enum — the lookup table is the authority. See `FunctionType`.
    function_type: str
    vehicle_id: UUID | None = None
    vehicle_name: str | None = None
    assigned_at: datetime
    assigned_by: UUID | None = None


# Kennzahlen (services/reaction_times.py — shared with the PDF's Reaktionszeiten)
class StageFigures(BaseModel):
    """Median and nearest-rank P90 of one stage time, over ``count`` incidents."""

    model_config = ConfigDict(from_attributes=True)

    count: int
    median_seconds: float | None = None
    p90_seconds: float | None = None


class PriorityFigures(BaseModel):
    """Counts and reaction times for one priority (or ``all``)."""

    model_config = ConfigDict(from_attributes=True)

    priority: Literal["all", "high", "medium", "low"]
    total: int
    waiting: int
    in_progress: int
    done: int
    dispatched: StageFigures
    on_scene: StageFigures
    closed: StageFigures


class OldestWaitingFigure(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    incident_id: UUID
    title: str
    created_at: datetime


class EventFigures(BaseModel):
    """The Kennzahlen of one Ereignis: Lage counts, Reaktionszeiten per priority,
    the oldest «hoch» Meldung still waiting for a crew.

    ``waiting`` = not yet dispatched (Eingegangen, Reko, Reko abgeschlossen),
    ``in_progress`` = Disponiert, Im Einsatz, Rückfahrt, ``done`` = Abgeschlossen.
    """

    model_config = ConfigDict(from_attributes=True)

    total: int
    waiting: int
    in_progress: int
    done: int
    overall: PriorityFigures
    by_priority: list[PriorityFigures]
    oldest_waiting_high: OldestWaitingFigure | None = None
