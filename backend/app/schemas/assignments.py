"""Resource-assignment + transfer schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class AssignmentCreate(BaseModel):
    """Schema for creating resource assignment."""

    resource_type: str  # 'personnel', 'vehicle', 'material'
    resource_id: UUID

    @field_validator("resource_type")
    @classmethod
    def validate_resource_type(cls, v: str) -> str:
        """Validate resource type is one of the allowed values."""
        valid_types = {"personnel", "vehicle", "material"}
        if v not in valid_types:
            raise ValueError(f"resource_type must be one of: {', '.join(sorted(valid_types))}")
        return v


class AssignmentUpdate(BaseModel):
    """Schema for updating assignment properties."""

    driver_stay: bool | None = None


class AssignmentResponse(BaseModel):
    """Assignment response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    resource_type: str
    resource_id: UUID
    assigned_at: datetime
    unassigned_at: datetime | None = None
    assigned_by: UUID | None = None
    driver_stay: bool = False


# Transfer
class TransferAssignmentsRequest(BaseModel):
    """Request to transfer all assignments from one incident to another."""

    target_incident_id: UUID


class TransferAssignmentsResponse(BaseModel):
    """Response from assignment transfer operation."""

    transferred_count: int
    assignment_ids: list[UUID]
    message: str
