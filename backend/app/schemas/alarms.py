"""Generic (provider-neutral) alarm intake schemas.

Any dispatch system — Alamos, eAlarm, a cantonal Leitstelle, a shell script —
can deliver alarms into the intake pool via ``POST /api/alarms``. Divera keeps
its own adapter endpoint (``POST /api/divera/webhook``); both paths land in the
same pool and share the same auto-attach and inference logic.
"""

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

# Slugs owned by built-in ingest paths; generic senders must pick their own.
# "operator"/"intake" are incident sources (dashboard / public phone form),
# "divera" is the vendor adapter, "training" is the exercise generator.
#
# This is the UNION with KP Front's list — "migrated" is Front's, kept here so a station
# running both can feed one dispatch system into both apps without discovering on the second
# integration that a slug accepted by one is rejected by the other. Reserving a name this app
# doesn't use costs nothing; it was never a valid external sender name anyway.
# Keep in sync with kp-front's app/schemas.py. See docs/RUNNING-BOTH.md.
RESERVED_ALARM_SOURCES = {"divera", "intake", "manual", "migrated", "operator", "training"}

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

    # --- Fields KP Front's `POST /api/alarms` already accepted --------------------------
    # Same path, same purpose, two incompatible payloads: a relay written against one app
    # got a 422 or silent data loss from the other. These three are accepted here so ONE
    # payload works against both. All optional, so nothing that sends today breaks.
    #
    # They are hints, not commands: an unknown `type` or an out-of-range `priority` falls
    # back to the keyword inference instead of failing the alarm. A dispatch system that
    # knows better than our keywords should be able to say so; a dispatch system with a
    # typo should not be able to drop an alarm on the floor.
    type: str | None = Field(default=None, max_length=50)
    priority: str | None = Field(default=None, max_length=20)
    # When the alarm went off at the sender, as opposed to when it reached us.
    started_at: datetime | None = None

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
