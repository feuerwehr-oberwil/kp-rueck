"""The card as the board shows it, and the broadcast that redraws cards on every board.

For writes outside the plain incident CRUD – a merge, its undo, an alarm attach, a /feld
Meldung merged into a card – that must hand the boards the card as GET /incidents/{id} returns it.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..crud import incidents as incidents_crud
from ..database import after_commit
from ..websocket_manager import broadcast_incident_update
from . import incident_display


async def board_response(db: AsyncSession, incident: models.Incident) -> schemas.IncidentResponse:
    """The card as GET /{id} returns it — vehicles, reko flags and all — for the response and the broadcast."""
    populated = await incidents_crud.get_incident(db, incident.id)
    return await incident_display.incident_with_display(db, populated or incident)


async def broadcast_repointed(db: AsyncSession, incident_ids: list[uuid.UUID]) -> None:
    """Cards whose «mögliches Duplikat» now names a different card: every board redraws them after the commit."""
    for incident_id in incident_ids:
        row = await incidents_crud.get_incident(db, incident_id)
        if row is not None and row.deleted_at is None:
            response = await incident_display.incident_with_display(db, row)
            after_commit(db, broadcast_incident_update, response.model_dump(mode="json"), "update")
