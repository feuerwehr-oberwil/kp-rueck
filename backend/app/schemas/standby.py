"""The standby box's API (`/api/standby`, `app/api/standby.py`): who leads which Ereignis,
how current the mirror is, and the conflicts both systems wrote while apart.

The value sets match the CHECKs on `event_leads` / `event_conflicts` (migration
`568e14cea8c5`); `kept_on` and `deleted_on` are written from the same two sides.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

__all__ = [
    "StandbyConflict",
    "StandbyConflictSubject",
    "StandbyConflicts",
    "StandbyDetached",
    "StandbyLead",
    "StandbyPhotoRef",
    "StandbyPhotoWritten",
    "StandbyPhotosMissing",
    "StandbyResolved",
    "StandbyStatus",
    "StandbySyncApplied",
    "SystemSide",
]

# The two systems: the hosted board (KP Rück Online) and the box (KP Rück Offline).
SystemSide = Literal["hosted", "standby"]


class StandbyLead(BaseModel):
    """An Ereignis a box took over at some point, and how its two-way sync stands."""

    event_id: UUID
    holder: SystemSide
    since: datetime
    # Changes not yet on the other system – on the box: its own; on the hosted board: as the box last said.
    pending: int
    # The last time box and hosted board reached each other for this Ereignis.
    contact_at: datetime | None
    open_conflicts: int


class StandbyDetached(BaseModel):
    """An Ereignis that left the mirror for the two-way sync, and since when."""

    event_id: UUID
    detached_at: datetime


class StandbyStatus(BaseModel):
    """`GET /api/standby` (and the takeover answers). The mirror fields are null on the hosted board."""

    mirror: bool
    configured: bool | None = None
    current: bool | None = None
    last_received_at: datetime | None = None
    detached: list[StandbyDetached] | None = None
    leads: list[StandbyLead]


class StandbyConflictSubject(BaseModel):
    """The Einsatz a conflicting row belongs to, for its label."""

    incident_id: UUID | None
    number: int | None
    address: str | None


class StandbyConflict(BaseModel):
    """Something both systems changed while they could not talk; the leader's version stands."""

    id: UUID
    table_name: str
    row_id: UUID
    kind: Literal["field", "deleted", "duplicate"]
    kept_on: SystemSide
    deleted_on: SystemSide | None
    # For `field`: per column what stands and what lost (`kept`, `lost`, `text`).
    columns: dict[str, dict[str, Any]] | None
    # For `deleted`/`duplicate`: the version that did not survive (a raw table row).
    row: dict[str, Any] | None
    subject: StandbyConflictSubject | None
    lost_at: datetime | None
    detected_at: datetime
    resolved_at: datetime | None
    resolved_by: str | None
    resolution: Literal["kept", "other", "both"] | None


class StandbyConflicts(BaseModel):
    """`GET /api/standby/events/{id}/conflicts`, open ones first."""

    # This system leads the Ereignis, so its conflicts are decided here.
    decidable: bool
    conflicts: list[StandbyConflict]


class StandbyResolved(BaseModel):
    """The answer to a decided conflict."""

    resolved: UUID
    choice: Literal["kept", "other", "both"]


# --- the box -> hosted sync (internal: include_in_schema=False, the box's own client) -----


class StandbySyncApplied(BaseModel):
    """One result per op of a sync round, in order (`app/standby_sync.apply_ops`)."""

    results: list[str]


class StandbyPhotoRef(BaseModel):
    incident_id: UUID
    name: str


class StandbyPhotosMissing(BaseModel):
    """The box's photos this board does not have yet."""

    missing: list[StandbyPhotoRef]


class StandbyPhotoWritten(BaseModel):
    #: False when the photo was already there (it is left alone).
    written: bool
