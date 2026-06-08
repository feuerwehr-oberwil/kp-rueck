"""Print-job + printer-config schemas."""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PrintJobType(str, Enum):
    """Print job type enumeration."""

    ASSIGNMENT = "assignment"
    BOARD = "board"
    TEST = "test"


class PrintJobStatus(str, Enum):
    """Print job status enumeration."""

    PENDING = "pending"
    PRINTING = "printing"
    COMPLETED = "completed"
    FAILED = "failed"


class PrintJobCreate(BaseModel):
    """Schema for creating a print job (internal use)."""

    job_type: PrintJobType
    payload: dict
    incident_id: UUID | None = None
    event_id: UUID | None = None


class PrintJobUpdate(BaseModel):
    """Schema for updating a print job (agent reports status)."""

    status: PrintJobStatus
    error_message: str | None = None


class PrintJobResponse(BaseModel):
    """Print job response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_type: PrintJobType
    status: PrintJobStatus
    payload: dict
    incident_id: UUID | None = None
    event_id: UUID | None = None
    created_at: datetime
    claimed_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    retry_count: int = 0


class PrintAssignmentRequest(BaseModel):
    """Request to print an assignment slip."""

    pass  # No body needed, incident_id comes from URL


class PrintBoardRequest(BaseModel):
    """Request to print board snapshot."""

    event_id: UUID
    include_completed: bool = False
    include_vehicles: bool = True
    include_personnel: bool = True


class PrinterConfigResponse(BaseModel):
    """Printer configuration for the print agent (no auth required)."""

    enabled: bool
    ip: str
    port: int


class PrinterStatusResponse(BaseModel):
    """Printer status response."""

    enabled: bool
    ip: str
    port: int
    auto_anfahrt: bool
    pending_jobs: int = 0
    last_job_at: datetime | None = None
    last_error: str | None = None
    # Print-service (Raspberry Pi agent) liveness — distinguishes a dead agent
    # from a reachable agent that simply can't reach the printer.
    agent_online: bool = False
    agent_last_seen: datetime | None = None
