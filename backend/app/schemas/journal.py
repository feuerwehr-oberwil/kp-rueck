"""Einsatztagebuch (journal) schemas — see models.JournalEntry and services/journal.py."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

__all__ = ["JournalCorrectionCreate", "JournalEntryCreate", "JournalEntryOut", "JournalPage"]


class JournalEntryOut(BaseModel):
    """One row as the app reads it. Corrections are rows too (`corrects_id` set); the
    client folds them into the row they correct."""

    id: UUID
    seq: int
    event_id: UUID
    incident_id: UUID | None
    #: The Einsatz's title now — or as it was, for an Einsatz that has since been deleted.
    incident_title: str | None = None
    kind: str
    #: Filter group: manual | field | status | resources
    category: str
    text: str | None
    data: dict[str, Any] | None
    occurred_at: datetime
    created_at: datetime
    author_name: str | None
    corrects_id: UUID | None


class JournalPage(BaseModel):
    """Rows with seq > since_seq, oldest seq first. `latest_seq` is the next cursor."""

    entries: list[JournalEntryOut]
    latest_seq: int


class JournalEntryCreate(BaseModel):
    """A manual line. `client_id` makes a retried POST harmless."""

    client_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=2000)
    incident_id: UUID | None = None


class JournalCorrectionCreate(BaseModel):
    """The new wording of a manual line. The original stays."""

    client_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=2000)
