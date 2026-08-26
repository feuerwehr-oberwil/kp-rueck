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

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Slugs owned by built-in ingest paths; generic senders must pick their own.
# "operator"/"intake" are incident sources (dashboard / public phone form),
# "divera" is the vendor adapter, "training" is the exercise generator.
#
# This is the UNION with KP Front's list — "migrated" is Front's, kept here so a station
# running both can feed one dispatch system into both apps without discovering on the second
# integration that a slug accepted by one is rejected by the other. Reserving a name this app
# doesn't use costs nothing; it was never a valid external sender name anyway.
# Keep in sync with kp-front's app/schemas.py. See docs/RUNNING-BOTH.md.
RESERVED_ALARM_SOURCES = {"divera", "feld", "intake", "manual", "migrated", "operator", "training"}

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class AlarmIn(BaseModel):
    """A provider-neutral alarm as delivered by an external dispatch system."""

    # Sender identity: lowercase slug, one per sending system, flowing onto
    # incidents.source unchanged.
    #
    # The ceiling is 16, not the 20 this column holds, because KP Front's
    # `incidents.source` is a String(16) and a 17–20 char slug therefore passed
    # here and 422'd there — one relay, two answers, which is the whole thing
    # `docs/alarm-intake-conformance.json` exists to stop. Widening Front would
    # have meant a migration on a live station database to buy four characters
    # nobody uses. Nothing shipped is longer than "training" (8).
    source: str = Field(default="webhook", max_length=16)
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


# --- FireHub (Tercero) adapter ------------------------------------------------------------
# FireHub has no public REST API for our use case, but it fires a station-configured webhook
# on the "Einsatzstart" and "Einsatzende" triggers. That is enough for the board: a start
# becomes a pool alarm, an end is noted. The payload is a fixed nested shape (Tercero, confirmed
# 2026-08), mapped onto the provider-neutral AlarmIn below. See docs/ALARM-INTEGRATIONS.md.


class FireHubOperation(BaseModel):
    """The ``operation`` object of a FireHub webhook.

    Field names mirror FireHub's camelCase JSON via aliases. ``extra="ignore"`` so fields
    FireHub may add later never break intake before we map them.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    # opsID is FireHub's stable operation identifier — it never changes, so it is our
    # idempotency and start↔end linking key. opsNumber is only a human-facing reference and
    # CAN change (Tercero confirmed: operations merged, or past ones backfilled), so it must
    # never be used to identify or dedupe — only displayed.
    ops_id: int = Field(alias="opsID")
    ops_number: int | None = Field(default=None, alias="opsNumber")
    category: str | None = None
    title: str = Field(min_length=1, max_length=255)
    street: str | None = None
    # Tercero is adding `city` so `street` alone isn't ambiguous across multi-Gemeinde
    # brigades; combined with street it makes the address reliably geocodable. Optional
    # because it ships slightly after this adapter and older payloads omit it.
    city: str | None = None
    created: datetime | None = None
    # FireHub sends no coordinates (only street + city). Declared optional so the day Tercero
    # adds them they flow straight through; until then they stay None and street+city is
    # geocoded downstream (or the pin is left unplaced).
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class FireHubTrigger(BaseModel):
    """The ``trigger`` object: which lifecycle event fired the webhook (``start``/``end``)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    type: str | None = None
    action: str = Field(min_length=1)
    tech_name: str | None = Field(default=None, alias="techName")


class FireHubWebhook(BaseModel):
    """A FireHub Einsatzstart/Einsatzende webhook payload (``POST /api/firehub/webhook``)."""

    model_config = ConfigDict(extra="ignore")

    operation: FireHubOperation
    status: str | None = None
    trigger: FireHubTrigger

    def to_alarm(self) -> "AlarmIn":
        """Map onto the provider-neutral alarm the intake pipeline consumes.

        ``category`` ("firealarm") is deliberately not carried into ``text`` or ``type``: it
        is an English slug, and the German title ("Oberwil: Feueralarm") already carries the
        keyword our type inference reads. Keeping it out avoids showing a stray English word
        in the pool.
        """
        op = self.operation
        address = ", ".join(part for part in (op.street, op.city) if part) or None
        return AlarmIn(
            source="firehub",
            source_id=str(op.ops_id),
            title=op.title,
            address=address,
            lat=op.lat,
            lng=op.lng,
            number=str(op.ops_number) if op.ops_number is not None else None,
            started_at=op.created,
        )
