"""«Neue Meldung» — a Schadenplatz reported from the field (plan 26 §3, decision 14).

Two shapes behind one endpoint, and they are different products:

* **Melden** — "I saw a tree down at Hauptstrasse 12". Creates the incident with
  ``source='feld'`` and assigns nobody. The KP disposes as usual.
* **Wir übernehmen das gleich** — the same, and the crew takes it on, so it
  reaches the board already in progress.

The second one is where the design work is. "Take the crew with me" is NOT a
transfer: `IncidentGroupAssignment` already says resources belong to the
*Auftrag* and are shared across all of its stops, so a crew that is working a
route simply gets another stop. Nothing moves, nothing is copied, and the old
Schadenplatz keeps its own status until somebody taps "Einsatz beendet" on it.

Copying the resources onto the new incident instead would leave everyone
double-assigned (which the board flags as a conflict), and *moving* them would
strip the unfinished job of its crew. Neither is what a squad driving from one
tree to the next is doing.

Three cases, in the order they are tried:

1. the person is on a stop of an Auftrag → append a stop; the route's resources
   already cover it.
2. the person is on a standalone Schadenplatz → open an Auftrag, put both in it,
   and **mirror** the active assignments to route level (see ``_mirror``).
3. the person is on nothing → assign them, plus the vehicle they drive.
"""

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import schemas
from ...models import (
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Personnel,
)
from ...services.audit import log_action

#: What happened to the new Schadenplatz, so the phone can say so in one line.
TakeoverMode = Literal["none", "stop", "auftrag", "solo"]


async def _current_work(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> Incident | None:
    """The Schadenplatz this person is working right now, if any.

    Active crew rows only: a released row is a place they have left, and a Reko
    auftrag is not work they can bring a second stop into.
    """
    result = await db.execute(
        select(Incident)
        .join(IncidentAssignment, IncidentAssignment.incident_id == Incident.id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
            IncidentAssignment.unassigned_at.is_(None),
            IncidentAssignment.purpose == "crew",
        )
        .order_by(IncidentAssignment.assigned_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def _mirror(db: AsyncSession, group_id: uuid.UUID, incident_id: uuid.UUID) -> None:
    """Give the route the resources the first Schadenplatz already has.

    **Mirrored, not moved.** Releasing the incident-level rows would be the
    tidier data model and is what "lift to the route" sounds like, but it means
    releasing a crew from a job they are standing on — which runs the completion
    cascade, re-derives the Einsatzleiter and briefly frees the resource in the
    board's conflict model, all while somebody is holding a hose. The payload
    builder already expects a resource to exist at both levels and resolves it
    ("a direct incident assignment wins"), so the safe direction is to add.
    """
    existing = await db.execute(
        select(IncidentGroupAssignment.resource_type, IncidentGroupAssignment.resource_id).where(
            IncidentGroupAssignment.incident_group_id == group_id,
            IncidentGroupAssignment.unassigned_at.is_(None),
        )
    )
    already = {(row[0], row[1]) for row in existing.all()}

    rows = await db.execute(
        select(IncidentAssignment).where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.unassigned_at.is_(None),
            # A Reko auftrag belongs to the Schadenplatz it was given for, not
            # to a route somebody later built around it.
            IncidentAssignment.purpose == "crew",
        )
    )
    for assignment in rows.scalars().all():
        if (assignment.resource_type, assignment.resource_id) in already:
            continue
        db.add(
            IncidentGroupAssignment(
                incident_group_id=group_id,
                resource_type=assignment.resource_type,
                resource_id=assignment.resource_id,
                is_leader=assignment.is_leader,
                driver_stay=assignment.driver_stay,
            )
        )


async def _driven_vehicle_ids(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[uuid.UUID]:
    """The vehicles this person drives in this Ereignis."""
    result = await db.execute(
        select(EventSpecialFunction.vehicle_id).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == personnel_id,
            EventSpecialFunction.function_type == "driver",
            EventSpecialFunction.vehicle_id.is_not(None),
        )
    )
    return [row[0] for row in result.all()]


async def create_field_report(
    db: AsyncSession,
    event_id: uuid.UUID,
    person: Personnel,
    payload: schemas.FeldIncidentCreate,
    request: Request,
) -> tuple[Incident, TakeoverMode]:
    """Create the Schadenplatz, and take it on if the crew said they would.

    ``source='feld'`` rather than ``'intake'``: both are somebody outside the KP
    saying "there is something here", but one is a phone call taken by an
    operator and the other is a known firefighter standing in front of it. The
    board draws them differently for that reason, and an editor cannot claim
    either (they are not in ``EditorIncidentSource``).
    """
    incident = Incident(
        title=payload.title,
        type=payload.type,
        priority=payload.priority,
        description=payload.description,
        location_address=payload.location_address,
        location_lat=payload.location_lat,
        location_lng=payload.location_lng,
        event_id=event_id,
        status="incoming",
        source="feld",
        # No user: this came through a login-less door. The audit row below
        # carries the reporter's name instead, which is the thing an operator
        # actually wants to know.
        created_by=None,
    )
    db.add(incident)
    await db.flush()

    mode: TakeoverMode = "none"
    if payload.take_over:
        mode = await _take_over(db, event_id, person, incident)

    await log_action(
        db=db,
        action_type="create",
        resource_type="incident",
        resource_id=incident.id,
        user=None,
        changes={
            "created": payload.model_dump(mode="json", exclude={"take_over"}),
            "source": "feld",
            "reported_by": person.name,
            "takeover": mode,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(incident)
    return incident, mode


async def _take_over(
    db: AsyncSession,
    event_id: uuid.UUID,
    person: Personnel,
    incident: Incident,
) -> TakeoverMode:
    """Put this crew on the new Schadenplatz — see the module docstring."""
    current = await _current_work(db, event_id, person.id)

    # 1. Already on a route: one more stop, and the route's resources cover it.
    if current is not None and current.group_id is not None:
        max_pos = await db.scalar(
            select(Incident.group_position)
            .where(Incident.group_id == current.group_id, Incident.deleted_at.is_(None))
            .order_by(Incident.group_position.desc())
            .limit(1)
        )
        incident.group_id = current.group_id
        incident.group_position = (max_pos + 1) if max_pos is not None else 0
        await db.flush()
        return "stop"

    # 2. On a single job: this is the second one, which makes it a route.
    if current is not None:
        group = IncidentGroup(
            event_id=event_id,
            name=current.title or current.location_address or "Auftrag",
            position=0,
        )
        db.add(group)
        await db.flush()
        current.group_id = group.id
        current.group_position = 0
        incident.group_id = group.id
        incident.group_position = 1
        await _mirror(db, group.id, current.id)
        await db.flush()
        return "auftrag"

    # 3. On nothing: just this person, and whatever they drive.
    db.add(
        IncidentAssignment(
            incident_id=incident.id,
            resource_type="personnel",
            resource_id=person.id,
            purpose="crew",
            assigned_at=datetime.now(UTC),
        )
    )
    for vehicle_id in await _driven_vehicle_ids(db, event_id, person.id):
        db.add(
            IncidentAssignment(
                incident_id=incident.id,
                resource_type="vehicle",
                resource_id=vehicle_id,
                assigned_at=datetime.now(UTC),
            )
        )
    await db.flush()
    return "solo"


def report_summary(incident: Incident, mode: TakeoverMode) -> dict[str, Any]:
    """What the phone needs back: the id, and what happened to it."""
    return {"incident_id": str(incident.id), "takeover": mode}
