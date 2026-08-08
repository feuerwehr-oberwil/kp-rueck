"""Schemas for the `/feld` field surface (plan 25).

`/feld` is the login-less page every crew in the field opens — not just the Reko
OF. Phase 0 is read-only: the person picker and "meine Einsatzstellen", each row
already carrying the Einsatzleiter, so a crew knows who is normally expected to
file before any form exists.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

# 'none'      – no schadenplatz_reports row for this incident yet
# 'draft'     – a row exists but is_draft is still True
# 'submitted' – filed
RapportState = Literal["none", "draft", "submitted"]


class FeldPersonnel(BaseModel):
    """One row of the `/feld` person picker.

    The list holds exactly the people with an assignment in this event, active or
    already released — not the roster. Someone with nothing to file would
    otherwise land on an empty page with no explanation.
    """

    personnel_id: UUID
    name: str
    role: str | None = None
    # Incidents in this event the person is or was assigned to.
    incident_count: int = 0
    # Of those, the ones still actively assigned.
    open_count: int = 0
    # Of those, the ones without a submitted Schadenplatz-Rapport.
    missing_rapport_count: int = 0


class FeldPersonnelListResponse(BaseModel):
    """Response for the `/feld` person picker."""

    personnel: list[FeldPersonnel]
    event_id: UUID
    event_name: str


class FeldAssignment(BaseModel):
    """One Schadenplatz a person is (or was) assigned to in this event."""

    incident_id: UUID
    incident_title: str
    incident_type: str
    incident_status: str
    location_address: str | None = None
    location_lat: str | None = None
    location_lng: str | None = None
    # False once the board released the person — they may still file (and often
    # only file then), so the row stays visible.
    is_active_assignment: bool = True
    rapport_state: RapportState = "none"
    arrived_at: datetime | None = None
    field_complete_reported_at: datetime | None = None
    # The Einsatzleiter of THIS incident (decision 22): briefed, never enforced.
    # Both stay None when nobody carries the role, which the UI must render as
    # "kein EL erfasst" rather than a blank line.
    leader_personnel_id: UUID | None = None
    leader_name: str | None = None


class FeldAssignmentsResponse(BaseModel):
    """Response for "meine Einsatzstellen"."""

    personnel_id: UUID
    personnel_name: str
    personnel_role: str | None = None
    event_id: UUID
    event_name: str
    assignments: list[FeldAssignment]
