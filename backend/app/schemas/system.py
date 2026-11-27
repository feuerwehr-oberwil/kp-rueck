"""The instance's own answers: health, the demo switches, logout and the diagnostics surface.

Where a body has two forms (a disk that could not be measured, demo mode off, a component
that failed), the model is a union of the forms, so the contract names both and neither
grows the other's keys. Keys the frontend reads in camelCase keep that spelling via aliases.
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# --- Health ----------------------------------------------------------------------------


class DiskReport(BaseModel):
    """Free space on the photo volume (advisory: it never changes the HTTP status)."""

    status: Literal["ok", "low"]
    free_bytes: int
    total_bytes: int
    free_percent: float


class DiskUnknown(BaseModel):
    """The volume could not be measured."""

    status: Literal["unknown"]


class HealthResponse(BaseModel):
    """`GET /health`, for load balancers and uptime monitors."""

    status: Literal["healthy"]
    disk: DiskReport | DiskUnknown


class PoolStats(BaseModel):
    size: int
    checked_in: int
    checked_out: int
    overflow: int


class PoolStatsUnavailable(BaseModel):
    error: str


class PoolHealth(BaseModel):
    """A database pool that answered."""

    status: Literal["healthy"]
    pool: PoolStats | PoolStatsUnavailable


class WebsocketHealth(BaseModel):
    status: Literal["healthy"]
    connections: int
    rooms: dict[str, int]


class AuditCleanupHealth(BaseModel):
    status: Literal["healthy", "stopped", "not_initialized"]
    running: bool
    retention_days: int


class ComponentFailure(BaseModel):
    """A component whose check raised: the exception's type name, never its message."""

    status: Literal["unhealthy", "unknown"]
    error: str


class HealthComponents(BaseModel):
    database: PoolHealth | ComponentFailure
    audit_pool: PoolHealth
    websocket: WebsocketHealth | ComponentFailure
    audit_cleanup: AuditCleanupHealth | ComponentFailure


class DetailedHealthResponse(BaseModel):
    """`GET /health/detailed` (not on production)."""

    status: Literal["healthy", "degraded"]
    components: HealthComponents


# --- Demo ------------------------------------------------------------------------------


class DemoOff(BaseModel):
    """Not a demo instance: the banner and the reset countdown stay away."""

    demo: Literal[False]


class DemoOn(BaseModel):
    demo: Literal[True]
    #: ISO timestamp of the next scheduled reset; None before the scheduler planned one.
    next_reset: str | None
    seconds_until_reset: int
    reset_interval_hours: int


DemoStatus = DemoOff | DemoOn


class DemoSandboxResponse(BaseModel):
    """The visitor's own sandbox Ereignis – or, at the cap, the oldest one (`reused`)."""

    event_id: UUID
    name: str
    reused: bool


class DemoResetResponse(BaseModel):
    status: Literal["reset_complete"]


# --- Auth ------------------------------------------------------------------------------


class LogoutResponse(BaseModel):
    message: str


# --- Diagnostics -----------------------------------------------------------------------


class RecentError(BaseModel):
    """One sanitised client error from the in-memory buffer (`app/telemetry/recent.py`)."""

    model_config = ConfigDict(populate_by_name=True)

    at: str
    kind: str
    message: str
    stack: str
    component_stack: str = Field(alias="componentStack")
    path: str
    #: Only when the client sent them – absent, not null.
    release: str | None = None
    device: str | None = None


class DiagnosticsExport(BaseModel):
    """The bundle an operator attaches to a Rückmeldung (served without unset keys)."""

    model_config = ConfigDict(populate_by_name=True)

    generated_at: str = Field(alias="generatedAt")
    app: str
    release: str
    #: The random per-install id; None until the first send minted one.
    install: str | None
    device: str
    errors: list[RecentError]
    errors_kept: int = Field(alias="errorsKept")
    note: str


class TelemetryOutboxRow(BaseModel):
    """A queued or sent telemetry payload, verbatim – the admin reads the actual JSON."""

    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    channel: str
    created_at: str | None = Field(alias="createdAt")
    sent_at: str | None = Field(alias="sentAt")
    attempts: int
    last_error: str | None = Field(alias="lastError")
    #: What was (or will be) sent, as sent: its shape belongs to the telemetry envelope.
    payload: dict[str, Any]


class TelemetryStatus(BaseModel):
    """What this instance sends, and whether it may."""

    model_config = ConfigDict(populate_by_name=True)

    consent: Literal["off", "errors"]
    #: False until an admin answered once – «nobody looked yet» is not a decision.
    decided: bool
    install_id: str | None = Field(alias="installId")
    #: False when the deployer disabled outbound telemetry in the environment.
    outbound_allowed: bool = Field(alias="outboundAllowed")
    ingest_configured: bool = Field(alias="ingestConfigured")
    pending: int
    recent: list[TelemetryOutboxRow]


class TelemetryConsentResult(BaseModel):
    consent: Literal["off", "errors"]
    #: Unsent payloads dropped by turning it off.
    discarded: int


class InstallIdResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    install_id: str = Field(alias="installId")


class ClientAddressResponse(BaseModel):
    """Which address the backend takes for the caller, and from where (proxy-chain check)."""

    address: str | None
    source: str
    x_forwarded_for: str | None
    x_real_ip: str | None
    socket: str | None
