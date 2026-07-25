"""Generic (provider-neutral) alarm intake schemas.

Any dispatch system — Alamos, eAlarm, a cantonal Leitstelle, a shell script —
can deliver alarms into the intake pool via ``POST /api/alarms``. Divera keeps
its own adapter endpoint (``POST /api/divera/webhook``); both paths land in the
same pool and share the same auto-attach and inference logic.
"""

import re
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

# Slugs owned by built-in ingest paths; generic senders must pick their own.
# "operator"/"intake" are incident sources (dashboard / public phone form),
# "divera" is the vendor adapter, "training" is the exercise generator.
RESERVED_ALARM_SOURCES = {"divera", "operator", "intake", "training", "manual"}

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class AlarmIn(BaseModel):
    """A provider-neutral alarm as delivered by an external dispatch system."""

    # Sender identity: lowercase slug, ≤20 chars so it can flow onto
    # incidents.source unchanged. One slug per sending system.
    source: str = Field(default="webhook", max_length=20)
    # Sender-side alarm id. Optional — when present, redelivery of the same
    # (source, source_id) is deduplicated instead of creating a second alarm.
    source_id: str | None = Field(default=None, max_length=255)
    title: str = Field(min_length=1, max_length=255)
    text: str | None = Field(default=None, max_length=5000)
    address: str | None = Field(default=None, max_length=500)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    # Sender reference number shown in the pool (like Divera's "E-123").
    number: str | None = Field(default=None, max_length=50)

    @field_validator("source")
    @classmethod
    def validate_source_slug(cls, v: str) -> str:
        if not _SLUG_RE.fullmatch(v):
            raise ValueError("source must be a lowercase slug (a-z, 0-9, '-', '_'), starting with a letter or digit")
        return v

    @field_validator("title", "text", "address", "source_id", "number", mode="before")
    @classmethod
    def strip_strings(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = v.strip()
        return v or None

    @model_validator(mode="after")
    def validate_location_pair(self) -> "AlarmIn":
        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat and lng must be provided together")
        return self


class AlarmAck(BaseModel):
    """Acknowledgement returned to the sending system."""

    status: str = "ok"
    # False when the alarm was a redelivery and the existing pool entry was kept.
    created: bool
    emergency_id: UUID
    auto_attached_incident_id: UUID | None = None
