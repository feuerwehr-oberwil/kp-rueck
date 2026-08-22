"""Print-job + printer-config schemas."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PrintJobType(str, Enum):
    """Print job type enumeration."""

    ASSIGNMENT = "assignment"
    BOARD = "board"
    TEST = "test"
    QR_CODE = "qr_code"
    # The material half of the Restliste on paper (plan 25, decision 25):
    # address · unit · since when, the sheet somebody takes along the next
    # morning. Deliberately the existing print-job path rather than a fourth
    # document format — this is a list, not a report.
    ABHOLLISTE = "abholliste"


class PrintJobStatus(str, Enum):
    """Print job status enumeration."""

    PENDING = "pending"
    PRINTING = "printing"
    COMPLETED = "completed"
    FAILED = "failed"


class PrintJobCreate(BaseModel):
    """Schema for creating a print job (internal use)."""

    job_type: PrintJobType
    payload: dict[str, Any]
    incident_id: UUID | None = None
    event_id: UUID | None = None


class PrintJobUpdate(BaseModel):
    """Schema for updating a print job (agent reports status)."""

    status: PrintJobStatus
    error_message: str | None = None
    # "The printer did not answer" — as opposed to "the printer refused this job". Only the
    # second is worth one of the three attempts: an unreachable printer is usually rebooting,
    # being refilled, or briefly off the WLAN, and it used to consume the whole retry budget
    # in ninety seconds and drop an Einsatzzettel whose TTL said it stayed useful for an hour.
    # Defaults to False, so an older agent that does not send it behaves exactly as before.
    retryable: bool = False


class PrintJobResponse(BaseModel):
    """Print job response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_type: PrintJobType
    status: PrintJobStatus
    payload: dict[str, Any]
    incident_id: UUID | None = None
    event_id: UUID | None = None
    created_at: datetime
    claimed_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    retry_count: int = 0


class PrintAssignmentRequest(BaseModel):
    """Request to print an assignment slip."""

    # No body needed, incident_id comes from URL


class PrintBoardRequest(BaseModel):
    """Request to print board snapshot."""

    event_id: UUID
    include_incidents: bool = True
    include_completed: bool = False
    include_vehicles: bool = True
    include_personnel: bool = True


class PrintQRCodeRequest(BaseModel):
    """Request to print a QR-code slip (shareable link as QR + text).

    ``code`` and ``valid_until`` are the Feld slip's two extra fields. The
    scanned `/feld` page asks for four digits and says nothing about where they
    are written, because the answer is "on this slip" — so a slip that carries
    the QR without the code strands whoever scans it at a prompt they cannot
    answer, and one without an expiry looks exactly like a working slip long
    after it stopped. Both optional: every other link (Check-In, Reko, Viewer)
    sends neither and prints exactly as before.
    """

    qr_content: str  # full URL to encode in the QR code
    title: str  # heading, e.g. "Personal Check-In"
    subtitle: str | None = None  # one-line description of what the link is for
    event_id: UUID | None = None
    #: The Feld-Code, printed under the QR. A plain string, not an int — it is
    #: four digits that may start with a zero.
    code: str | None = None
    #: When the link stops working (ISO 8601). The agent prints the DATE only.
    valid_until: str | None = None


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
