"""Schemas for the `/feld` field surface (plan 25).

`/feld` is the login-less page every crew in the field opens — not just the Reko
OF. Phase 0 was read-only: the person picker and "meine Einsatzstellen", each row
already carrying the Einsatzleiter, so a crew knows who is normally expected to
file before any form exists.

Phase 1 adds the four field actions — Angekommen, Einsatz beendet (+ the Abholung
follow-up), Abholung, Freitext-Meldung — and their KP twin. ``FieldReportUpdate``
and ``FieldReportState`` are shared by both doors on purpose: the shapes must not
drift, or a field the KP can set stops round-tripping through the field surface.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

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
    # "Abholung nötig" — carried on the list row so a crew reopening /feld sees
    # its own open request, not just the response of the tap that made it.
    pickup_needed: bool = False
    pickup_note: str | None = None
    pickup_requested_at: datetime | None = None
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
    # The station's Freitext-Meldung chips (decision 20). Carried on this
    # response rather than on an endpoint of their own: the detail view is one
    # tap away from this call, and a separate GET would be a second public
    # surface to guard for four strings.
    message_chips: list[str] = []


# ============================================
# Field reports — shared by BOTH doors
# ============================================


class FieldReportState(BaseModel):
    """The three field reports of one Schadenplatz.

    Returned identically by `/api/feld/...` and by the editor twin, because they
    are one CRUD module underneath. ``*_by`` is a personnel id and is populated
    **only** for a field write — a KP write leaves it NULL and puts the user in
    the audit log (decision 28). That asymmetry is the provenance rule; do not
    "fix" it by filling in the operator.
    """

    incident_id: UUID
    arrived_at: datetime | None = None
    arrived_by_personnel_id: UUID | None = None
    # True when the arrival was entered in the KP: no personnel id AND a time.
    # The UI needs to tell "im KP erfasst" from "nobody has reported it".
    arrived_in_kp: bool = False
    field_complete_reported_at: datetime | None = None
    field_complete_reported_by: UUID | None = None
    pickup_needed: bool = False
    pickup_note: str | None = None
    pickup_requested_at: datetime | None = None
    pickup_requested_by: UUID | None = None


class FieldReportUpdate(BaseModel):
    """The KP twin's payload: set **or clear** any of the three (decision 28).

    Every field is optional and the handler acts only on the ones actually
    present (``model_fields_set``), so ``null`` means "clear this" and absence
    means "leave it alone". Without that distinction an operator correcting the
    pickup note would silently wipe the arrival time.
    """

    arrived_at: datetime | None = None
    field_complete_reported_at: datetime | None = None
    pickup_needed: bool | None = None
    pickup_note: str | None = Field(default=None, max_length=500)
    pickup_requested_at: datetime | None = None


class FeldPickupRequest(BaseModel):
    """The Abholung answer from `/feld`.

    ``needed=False`` is the crew tapping *abgeholt*, and it is also the
    *"Wir fahren selbst"* half of the follow-up that "Einsatz beendet" asks
    (decision 24).
    """

    needed: bool
    note: str | None = Field(default=None, max_length=500)


class FeldMessageRequest(BaseModel):
    """Freitext-Meldung an den KP — a chip or a typed sentence."""

    message: str = Field(min_length=1, max_length=500)
