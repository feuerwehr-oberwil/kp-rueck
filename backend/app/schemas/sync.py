"""Railway sync schemas — direction, status, deltas, logs."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SyncDirection(str, Enum):
    """Sync direction enumeration."""

    FROM_RAILWAY = "from_railway"
    TO_RAILWAY = "to_railway"


class SyncStatus(str, Enum):
    """Sync status enumeration."""

    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"
    IN_PROGRESS = "in_progress"


class SyncResult(BaseModel):
    """Result of a sync operation."""

    success: bool
    direction: SyncDirection
    records_synced: dict[str, int]  # e.g., {"incidents": 5, "personnel": 2}
    errors: list[str] | None = None
    started_at: datetime
    completed_at: datetime | None = None


class Delta(BaseModel):
    """Delta of changes between Railway and Local.

    NOTE: Users are NOT synced - they are authentication records managed per environment.
    Incidents reference users via created_by, so users must exist on both systems independently.
    """

    events: list[dict[str, Any]] = []
    incidents: list[dict[str, Any]] = []
    personnel: list[dict[str, Any]] = []
    vehicles: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    settings: list[dict[str, Any]] = []
    total_records: int = 0


class SyncStatusResponse(BaseModel):
    """Current sync status response."""

    last_sync: datetime | None = None
    direction: SyncDirection | None = None
    railway_healthy: bool
    is_syncing: bool
    records_pending: int = 0
    last_error: str | None = None


class SyncLogResponse(BaseModel):
    """Sync log entry response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sync_direction: SyncDirection
    started_at: datetime
    completed_at: datetime | None = None
    status: SyncStatus
    records_synced: dict[str, Any] | None = None
    errors: dict[str, Any] | None = None
