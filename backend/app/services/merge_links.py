"""Links that name a merged card follow it to the card it went into (R2 review).

A Reko link, a /feld deep link or a printed Einsatzzettel carries the id of the
card it was minted for. When that card is merged into another one, the token
stays valid for the ORIGINAL id — that is what it was signed for, and a leaked
link must never reach a third card — but every read and write has to land on
the card that is live now, or a Reko report filed from the field would be
written to a hidden card nobody sees.

So: validate against the original id, then follow ``merged_into_id`` (a chain,
if the surviving card was itself merged later) to the live card.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models

#: A merge into a merged card is refused, so a chain only grows when a surviving
#: card is merged on later. This bound is a guard against bad data, not a limit
#: anybody will reach.
MAX_HOPS = 20


async def live_incident_id(db: AsyncSession, incident_id: uuid.UUID) -> uuid.UUID:
    """The id of the card this one lives on now — itself, if it was never merged."""
    current = incident_id
    for _ in range(MAX_HOPS):
        nxt = (
            await db.execute(select(models.Incident.merged_into_id).where(models.Incident.id == current))
        ).scalar_one_or_none()
        if nxt is None:
            return current
        current = nxt
    return current


async def merged_into_ids(db: AsyncSession, incident_id: uuid.UUID) -> list[uuid.UUID]:
    """Every card merged (directly or along a chain) into this one."""
    found: list[uuid.UUID] = []
    frontier = [incident_id]
    for _ in range(MAX_HOPS):
        if not frontier:
            break
        rows = (
            (await db.execute(select(models.Incident.id).where(models.Incident.merged_into_id.in_(frontier))))
            .scalars()
            .all()
        )
        frontier = [r for r in rows if r not in found and r != incident_id]
        found.extend(frontier)
    return found


async def merged_cards_of_event(db: AsyncSession, event_id: uuid.UUID) -> list[tuple[models.Incident, uuid.UUID]]:
    """Every card of the Ereignis merged into another, with the LIVE card it ended on.

    One query for the whole Ereignis; chains (A → B → C) are followed in memory,
    so a Rapport kept on A is still printed under C after B was merged on later.
    """
    rows = (
        (
            await db.execute(
                select(models.Incident).where(
                    models.Incident.event_id == event_id, models.Incident.merged_into_id.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    parent = {row.id: row.merged_into_id for row in rows}
    out: list[tuple[models.Incident, uuid.UUID]] = []
    for row in rows:
        live = row.merged_into_id
        for _ in range(MAX_HOPS):
            if live not in parent:
                break
            live = parent[live]
        if live is not None:
            out.append((row, live))
    return out
