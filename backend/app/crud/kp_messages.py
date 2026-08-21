"""«Meldung an den Trupp» — KP → field messages (sweep 27 §P3.2).

The mirror of the crew's Freitext-Meldung, deliberately minimal: one direction,
one sentence per row, timestamp and sender's display name. No threads, no read
receipts — the phone polls its assignments every ten seconds and simply carries
the messages along (`crud/feld/visibility.py`), so no new public surface opens.

Every send is also an audit-log entry (`kp_message`): the message must survive
into the Einsatztagebuch and the incident's Verlauf exactly like the field's own
Meldungen do — the timeline endpoint reads it back from this table.
"""

import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, IncidentFieldMessage, User
from ..services.audit import log_action


def _author_display(user: User) -> str:
    """The name the squad reads under the message."""
    return user.display_name or user.username


async def create_kp_message(
    db: AsyncSession,
    incident: Incident,
    *,
    user: User,
    message: str,
    request: Request | None = None,
) -> IncidentFieldMessage:
    """Send one message to the squad at this Schadenplatz. Caller broadcasts."""
    row = IncidentFieldMessage(
        incident_id=incident.id,
        message=message.strip(),
        author_name=_author_display(user)[:100],
        created_by=user.id,
    )
    db.add(row)

    await log_action(
        db=db,
        action_type="kp_message",
        resource_type="incident",
        resource_id=incident.id,
        user=user,
        changes={"message": row.message, "source": "kp"},
        request=request,
    )
    await db.commit()
    await db.refresh(row)
    return row


async def messages_for_incident(db: AsyncSession, incident_id: uuid.UUID) -> list[IncidentFieldMessage]:
    """All KP messages of one Schadenplatz, oldest first — thread order."""
    result = await db.execute(
        select(IncidentFieldMessage)
        .where(IncidentFieldMessage.incident_id == incident_id)
        .order_by(IncidentFieldMessage.created_at)
    )
    return list(result.scalars().all())


async def messages_for_incidents(
    db: AsyncSession,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[IncidentFieldMessage]]:
    """The same, batched for the feld assignments payload — one query per poll."""
    if not incident_ids:
        return {}
    result = await db.execute(
        select(IncidentFieldMessage)
        .where(IncidentFieldMessage.incident_id.in_(incident_ids))
        .order_by(IncidentFieldMessage.created_at)
    )
    out: dict[uuid.UUID, list[IncidentFieldMessage]] = {}
    for row in result.scalars().all():
        out.setdefault(row.incident_id, []).append(row)
    return out
