"""Resource-assignment + transfer schemas."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .common import ResourceType


class AssignmentCreate(BaseModel):
    """Schema for creating resource assignment."""

    resource_type: ResourceType
    resource_id: UUID


class AssignmentUpdate(BaseModel):
    """Schema for updating assignment properties."""

    driver_stay: bool | None = None
    # Promote this person to Einsatzleiter for the incident. Setting it demotes
    # whoever held the role — the role is single-holder, so "set" and "move" are
    # the same operation and the caller never has to clear the old one.
    is_leader: bool | None = None


class AssignmentResponse(BaseModel):
    """Assignment response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    resource_type: ResourceType
    resource_id: UUID
    assigned_at: datetime
    unassigned_at: datetime | None = None
    assigned_by: UUID | None = None
    driver_stay: bool = False
    is_leader: bool = False
    # A Reko row's place in its person's order (Reko-Modus); null on every other row.
    reko_position: int | None = None
    # Why a person is on this Einsatz (plan 26 §27): a work crew or a Reko. The board shows a
    # Reko-function person's rows as Reko; this says which ones really are.
    purpose: Literal["crew", "reko"] = "crew"


class MaterialCollectedResponse(BaseModel):
    """«Abgeholt – freigeben» answered: when the assignment was released.

    The undo's token – ``DELETE …/material-collected/{id}?released_at=…`` reverses only the
    release that carries exactly this time, never a regular release or a later one.
    """

    released_at: datetime


# Transfer
class TransferAssignmentsRequest(BaseModel):
    """Request to transfer all assignments from one incident to another.

    ``assignment_ids``: «Rückgängig» of a transfer – move back exactly these rows (the
    ``assignment_ids`` the transfer answered with) and nothing the incident held before.
    Refused (409) unless every one of them is still active on the incident.
    """

    target_incident_id: UUID
    assignment_ids: list[UUID] | None = None


class TransferAssignmentsResponse(BaseModel):
    """Response from assignment transfer operation."""

    transferred_count: int
    assignment_ids: list[UUID]
    message: str


# «Danach» – planned assignments (Jetzt / Danach, 24.11.2026)
class PlannedAssignmentCreate(BaseModel):
    """«Danach vormerken»: exactly one of ``incident_id`` / ``incident_group_id``."""

    resource_type: ResourceType
    resource_id: UUID
    incident_id: UUID | None = None
    incident_group_id: UUID | None = None


class PlannedAssignmentUpdate(BaseModel):
    """«Verwerfen» of the «Danach frei» to-do (true) and its undo (false). The plan stays."""

    dismissed: bool


class PlannedAssignmentResponse(BaseModel):
    """A Danach as the board reads it.

    ``position``: its place in the resource's queue (1 = next). ``ready``: the resource is free
    (Jetzt nowhere) and this is its first Danach – the board shows the «Danach frei» to-do.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    incident_id: UUID | None = None
    incident_group_id: UUID | None = None
    resource_type: ResourceType
    resource_id: UUID
    planned_at: datetime
    planned_by: UUID | None = None
    dismissed_at: datetime | None = None
    position: int = 1
    ready: bool = False
    #: When it became ready (the resource's last release, or the planning if later); null while not.
    ready_since: datetime | None = None
