"""Reko (reconnaissance) report schemas."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class DangersAssessment(BaseModel):
    """Structured danger checklist."""

    fire: bool = False
    fire_danger: bool = False
    explosion: bool = False
    collapse: bool = False
    chemical: bool = False
    electrical: bool = False
    other_notes: str | None = None


class EffortEstimation(BaseModel):
    """Resource effort estimation."""

    personnel_count: int | None = None
    vehicles_needed: list[str] = []
    equipment_needed: list[str] = []
    estimated_duration_hours: float | None = None


class RekoReportBase(BaseModel):
    """Base schema for Reko reports.

    Deliberately has no ``is_draft`` field: draft status is controlled only by
    the explicit ``submit`` query param on the API, so a stray draft-save with
    ``is_draft: true`` in the body can never un-submit a submitted report.
    """

    is_relevant: bool | None = None
    dangers_json: DangersAssessment | None = None
    effort_json: EffortEstimation | None = None
    power_supply: str | None = None  # 'available' | 'unavailable' | 'emergency_needed'
    summary_text: str | None = None
    additional_notes: str | None = None


class RekoReportCreate(RekoReportBase):
    """Schema for creating Reko report.

    ``token`` is optional since plan 26 §5.1: the same route is also the board's
    door. A field crew sends the incident's form token; an editor sends none and
    is identified by the session cookie instead. Neither is still a 401 — one
    route, two doors, never a `…-by-editor` twin that drifts (decision 11).
    """

    incident_id: UUID
    token: str | None = None


class RekoReportUpdate(RekoReportBase):
    """Schema for updating Reko report."""


class RekoReportResponse(RekoReportBase):
    """Full Reko report schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    is_draft: bool = False
    incident_title: str | None = None
    incident_location: str | None = None
    incident_type: str | None = None
    incident_description: str | None = None
    incident_contact: str | None = None
    arrived_at: datetime | None = None
    submitted_at: datetime
    updated_at: datetime
    photos_json: list[str] = []
    submitted_by_personnel_id: UUID | None = None
    submitted_by_personnel_name: str | None = None
    # Provenance (§5.3). The personnel FK above is the field side; these three are
    # the KP side, and a mixed report carries both. NULL on all three means the
    # report arrived through the form link, which is the normal case.
    created_by_user_id: UUID | None = None
    updated_by_user_id: UUID | None = None
    arrived_reported_by_user_id: UUID | None = None

    @field_validator("photos_json", mode="before")
    @classmethod
    def ensure_photos_list(cls, v: Any) -> Any:
        """Convert None to empty list for photos_json."""
        if v is None:
            return []
        return v


class RekoArrivedUpdate(BaseModel):
    """ "Reko meldet: vor Ort" as the KP hears it (plan 26 §5.2).

    Three shapes, and the difference between the last two is the point:

    * field **absent** — "now", and idempotent: an arrival already on the row is
      left where it is, exactly as a crew's second tap is.
    * field **set** — that time. A radio message logged five minutes late has to
      land at the right time or the board's waiting clocks lie.
    * field **null** — clear it. A mis-heard call is corrected, not amended, and
      clearing takes the provenance with it: "nobody has reported it" is not a
      KP report.
    """

    arrived_at: datetime | None = None


class RekoArrivedState(BaseModel):
    """What the board shows in the Feldmeldungen row after the write.

    The provenance is the *absence* of the user FK, read the same way everywhere:
    NULL means a crew tapped "Ich bin vor Ort" on `/reko`, set means an operator
    logged the radio message. Never a resolved "who" — a User is not a Personnel.
    """

    incident_id: UUID
    arrived_at: datetime | None = None
    arrived_reported_by_user_id: UUID | None = None


class RekoSummary(BaseModel):
    """Lightweight Reko report summary for bulk loading (used in kanban board)."""

    model_config = ConfigDict(from_attributes=True)

    incident_id: UUID
    has_completed_reko: bool
    arrived_at: datetime | None = None
    is_relevant: bool | None = None
    dangers_json: DangersAssessment | None = None
    effort_json: EffortEstimation | None = None
    summary_text: str | None = None
    # Filenames only — served through /api/photos/{incident_id}/{filename},
    # which takes a session or, event-scoped, a viewer share token.
    photos_json: list[str] = []
    submitted_at: datetime | None = None
    submitted_by_personnel_name: str | None = None

    @field_validator("photos_json", mode="before")
    @classmethod
    def ensure_photos_list(cls, v: Any) -> Any:
        """Convert None to empty list for photos_json."""
        if v is None:
            return []
        return v


class ViewerRekoDangers(BaseModel):
    """The danger checklist without its free-text note (see ViewerRekoSummary)."""

    fire: bool = False
    fire_danger: bool = False
    explosion: bool = False
    collapse: bool = False
    chemical: bool = False
    electrical: bool = False


class ViewerRekoSummary(BaseModel):
    """What a share link may show of a Reko result — deliberately narrower than RekoSummary.

    The /viewer/data endpoint has no session behind it: the token in the URL is
    the only gate, and a URL gets forwarded. So this drops

    * ``other_notes`` on the dangers — free text the Reko dictated about the
      site, which can name people who live there;
    * the submitter's name and the submission time — nothing on the display
      renders them, and who reported it is not part of the situation.

    ``photos_json`` **is** carried, and that is a deliberate widening of the
    boundary: a picture of the damage is the most useful part of a Reko result,
    and the detail dialog on the share board drew an empty grid without it.
    /api/photos/{incident}/{file} therefore takes the same viewer token as a
    second door, scoped to the token's own event and to files a submitted report
    lists (see ``serve_photo``). Filenames only — the URL is built client-side.

    What is left is what the card and the detail dialog actually draw.
    """

    is_relevant: bool | None = None
    dangers_json: ViewerRekoDangers | None = None
    summary_text: str | None = None
    # Flattened out of effort_json: the display reads these two numbers and
    # nothing else from the effort estimation.
    personnel_count: int | None = None
    estimated_duration_hours: float | None = None
    photos_json: list[str] = []


class EventRekoSummariesResponse(BaseModel):
    """Response containing all reko summaries for an event."""

    summaries: dict[str, RekoSummary]  # incident_id -> summary
    total: int


class AssignRekoPersonnelRequest(BaseModel):
    """Request to assign Reko personnel to an incident."""

    personnel_id: UUID


class RekoOpenAssignmentInfo(BaseModel):
    """Where a Reko person's open work is (for the assign dialog)."""

    incident_id: UUID
    incident_title: str
    location_address: str | None = None


class AvailableRekoPersonnel(BaseModel):
    """Available Reko personnel for assignment."""

    personnel_id: UUID
    name: str
    role: str | None = None
    assignment_count: int = 0
    open_count: int = 0
    done_count: int = 0
    open_assignments: list[RekoOpenAssignmentInfo] = []
    # Straight-line metres from the target incident to this person's nearest
    # open assignment ("open") or, if none, their most recent one ("last").
    distance_m: int | None = None
    distance_source: Literal["open", "last"] | None = None


class AvailableRekoPersonnelResponse(BaseModel):
    """Response for available Reko personnel."""

    personnel: list[AvailableRekoPersonnel]
    currently_assigned_id: UUID | None = None
