"""The roster-snapshot status card (`/api/integrations/roster-snapshot`).

The status is a stored document (`settings` row ``roster_snapshot.status``, written by
``services/roster_snapshot_sync``), and what a row holds depends on the runs behind it: a
first run that was refused has no ``lastGood``, a crash keeps the previous report's keys.
The routes therefore hand the row out as stored (a JSONResponse, never validated), and these
models only describe it in the contract: every key optional (absent, never null), a key they
do not name allowed (``extra="allow"``). The defaults are what each key means when absent.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_SPARSE = ConfigDict(extra="allow", populate_by_name=True)


class RosterUnmatched(BaseModel):
    """One person a run could not place (`roster_snapshot.UnmatchedEntry`)."""

    model_config = _SPARSE

    external_id: str | None = None
    display_name: str
    reason: str


class RosterPostponed(BaseModel):
    """A deactivation waiting because the person is checked in or assigned on an open Ereignis."""

    model_config = _SPARSE

    display_name: str
    reason: str


class RosterStatusOutcome(BaseModel):
    """The run's outcome report (`roster-snapshot-outcome/1`), its unmatched list capped."""

    model_config = _SPARSE

    schema_: str = Field(default="roster-snapshot-outcome/1", alias="schema")
    provider: str | None = None
    snapshot_generated_at: str | None = None
    #: Why the whole run was refused – nothing was written.
    refused: str | None = None
    matched: int = 0
    created: int = 0
    updated: int = 0
    deactivated: int = 0
    unmatched: list[RosterUnmatched] = Field(default_factory=list)
    unknown_ranks: list[str] = Field(default_factory=list)


class RosterLastGood(BaseModel):
    """The snapshot the roster reflects now – after a refused run, still the previous one."""

    model_config = _SPARSE

    provider: str
    generated_at: str = Field(alias="generatedAt")
    sha256: str
    count: int


class StationIndexFile(BaseModel):
    model_config = _SPARSE

    kind: str
    schema_: str = Field(alias="schema")
    read: bool
    known: bool


class StationIndexSummary(BaseModel):
    """The station index the run read the roster through (`station_index.summary`)."""

    model_config = _SPARSE

    generated_at: str = Field(alias="generatedAt")
    provider: str
    sha256: str
    files: list[StationIndexFile]


class RosterSnapshotStatus(BaseModel):
    """The last roster-snapshot run, as stored."""

    model_config = _SPARSE

    trigger: str | None = None
    outcome: RosterStatusOutcome | None = None
    unmatched_total: int = Field(default=0, alias="unmatchedTotal")
    #: The deactivation cap held the run; an admin may release it (`force`).
    held: bool = False
    unchanged: bool = False
    stale: bool = False
    active_before: int = Field(default=0, alias="activeBefore")
    deactivation_limit: int | None = Field(default=None, alias="deactivationLimit")
    pending_deactivations: int = Field(default=0, alias="pendingDeactivations")
    postponed: list[RosterPostponed] = Field(default_factory=list)
    last_good: RosterLastGood | None = Field(default=None, alias="lastGood")
    applied_at: str | None = Field(default=None, alias="appliedAt")
    last_attempt: str | None = Field(default=None, alias="lastAttempt")
    last_success: str | None = Field(default=None, alias="lastSuccess")
    last_error: str | None = Field(default=None, alias="lastError")
    #: How the roster was found: through the station index, or the direct source.
    via: Literal["index", "direct"] | None = None
    index: StationIndexSummary | None = None


class RosterSnapshotResponse(BaseModel):
    """The status card: the configuration and the last run (null on a station without one)."""

    model_config = ConfigDict(populate_by_name=True)

    configured: bool
    interval_minutes: int = Field(alias="intervalMinutes")
    max_deactivate_pct: int = Field(alias="maxDeactivatePct")
    status: RosterSnapshotStatus | None
