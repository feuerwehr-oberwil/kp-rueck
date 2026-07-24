"""Reko (reconnaissance) report + dashboard schemas."""

from datetime import datetime
from typing import Literal
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
    """Schema for creating Reko report."""

    incident_id: UUID
    token: str


class RekoReportUpdate(RekoReportBase):
    """Schema for updating Reko report."""

    pass


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

    @field_validator("photos_json", mode="before")
    @classmethod
    def ensure_photos_list(cls, v):
        """Convert None to empty list for photos_json."""
        if v is None:
            return []
        return v


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
    submitted_at: datetime | None = None
    submitted_by_personnel_name: str | None = None


class EventRekoSummariesResponse(BaseModel):
    """Response containing all reko summaries for an event."""

    summaries: dict[str, RekoSummary]  # incident_id -> summary
    total: int


# Reko dashboard
class RekoDashboardPersonnel(BaseModel):
    """Reko personnel with assignment status for dashboard list."""

    personnel_id: UUID
    name: str
    role: str | None = None
    assignment_count: int = 0
    # Active assignments whose incident still needs a reko (actively open work).
    open_count: int = 0
    # Active assignments whose incident already has a completed reko ("Beendet").
    done_count: int = 0


class RekoDashboardPersonnelListResponse(BaseModel):
    """Response for Reko dashboard personnel list."""

    personnel: list[RekoDashboardPersonnel]
    event_id: UUID
    event_name: str


class RekoDashboardAssignment(BaseModel):
    """Incident assignment for Reko personnel (active or historical)."""

    incident_id: UUID
    incident_title: str
    incident_type: str
    incident_status: str
    location_address: str | None = None
    location_lat: str | None = None
    location_lng: str | None = None
    assignment_id: UUID | None = None
    assigned_at: datetime | None = None
    has_completed_reko: bool = False
    is_active_assignment: bool = True


class RekoDashboardAssignmentsResponse(BaseModel):
    """Response for Reko personnel assignments."""

    personnel_id: UUID
    personnel_name: str
    assignments: list[RekoDashboardAssignment]


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
