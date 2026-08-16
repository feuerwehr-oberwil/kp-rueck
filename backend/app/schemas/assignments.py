"""Resource-assignment + transfer schemas."""

from datetime import datetime
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


# Transfer
class TransferAssignmentsRequest(BaseModel):
    """Request to transfer all assignments from one incident to another."""

    target_incident_id: UUID


class TransferAssignmentsResponse(BaseModel):
    """Response from assignment transfer operation."""

    transferred_count: int
    assignment_ids: list[UUID]
    message: str
