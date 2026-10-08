"""Workable requests from the field (R13) — shared by the board and `/feld`.

Its own module because both ``schemas.incidents`` (the board's card carries the
open ones) and ``schemas.feld`` (the crew reads its requests back) need it, and
``feld`` already imports ``incidents``.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

FieldRequestStatus = Literal["open", "in_progress", "done"]


class FieldRequestResponse(BaseModel):
    """One workable request from the field (R13) — what the board and `/feld` read.

    ``label`` is the server's German one-liner («Material: Tauchpumpe Gr. ×2»),
    the same sentence the bell, the audit log and the PDF carry; the clients
    render their own localised label from ``kind`` / ``item`` / ``quantity`` and
    fall back to it.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    kind: Literal["message", "material", "personnel", "pickup"]
    status: FieldRequestStatus
    text: str | None = None
    item: str | None = None
    quantity: int | None = None
    label: str
    created_at: datetime
    created_by_name: str | None = None
    # True when a crew member sent it; False = entered in the KP from a radio call.
    from_field: bool = True
    notification_id: UUID | None = None
    seen_at: datetime | None = None
    in_progress_at: datetime | None = None
    in_progress_by_name: str | None = None
    done_at: datetime | None = None
    done_by_name: str | None = None


class FieldRequestStatusUpdate(BaseModel):
    """The KP working a request: offen → in Arbeit → erledigt, or back to offen."""

    status: FieldRequestStatus
