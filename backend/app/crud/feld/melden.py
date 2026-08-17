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
    Vehicle,
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


async def _holds(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID, function: str) -> bool:
    """Does this person hold this role in this Ereignis?"""
    result = await db.execute(
        select(EventSpecialFunction.id)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == personnel_id,
            EventSpecialFunction.function_type == function,
        )
        .limit(1)
    )
    return result.first() is not None


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
    # The Telefondienst variant (decision 6). Claiming it is not enough —
    # holding the role is, and the server checks rather than trusting the flag,
    # because "this was a phone call" is provenance and provenance is never
    # faked from the client.
    took_a_call = payload.as_phone_call and await _holds(db, event_id, person.id, "telefondienst")

    incident = Incident(
        title=payload.title,
        type=payload.type,
        priority=payload.priority,
        description=payload.description,
        # «Weitere Hinweise» is not the Meldung — see FeldIncidentCreate.
        internal_notes=payload.internal_notes,
        location_address=payload.location_address,
        location_lat=payload.location_lat,
        location_lng=payload.location_lng,
        # The Melder — only meaningful when somebody took a call; a firefighter
        # standing in front of it IS the Melder and the audit row says so.
        contact=payload.contact if took_a_call else None,
        contact_phone=payload.contact_phone if took_a_call else None,
        event_id=event_id,
        status="incoming",
        source="intake" if took_a_call else "feld",
        # No user: this came through a login-less door. The audit row below
        # carries the reporter's name too, which is what an operator reads.
        created_by=None,
        # …and the id, which is what the reporter's own «Von mir gemeldet» list
        # is read back by. The audit row cannot serve that: it is a log, and a
        # correction has to find the incident, not the entry about it.
        reported_by_personnel_id=person.id,
    )
    db.add(incident)
    await db.flush()

    mode: TakeoverMode = "none"
    if payload.take_over:
        mode = await _take_over(db, event_id, person, incident)
        # "Wir übernehmen das gleich" means somebody is on the way to it, so it
        # does not sit in Eingegangen waiting to be disponiert — the crew just
        # disponierte it themselves. Left as `incoming` this reads on the board
        # as an unhandled alarm, which is the opposite of what was reported.
        incident.status = "enroute"

    await log_action(
        db=db,
        action_type="create",
        resource_type="incident",
        resource_id=incident.id,
        user=None,
        changes={
            "created": payload.model_dump(mode="json", exclude={"take_over"}),
            "source": "intake" if took_a_call else "feld",
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
        # Belonging to the Auftrag is not the same as the Auftrag having a crew.
        # A squad can be working a stop with everybody assigned to that *stop* —
        # which is what the board's own assign flow writes — and then the route
        # owns nobody, so a new stop appended here would arrive empty and the
        # crew standing on it would be the only people who could not see it.
        # Mirroring first is what makes "the route's resources cover it" true.
        await _mirror(db, current.group_id, current.id)
        await db.flush()
        return "stop"

    # 2. On a single job: this is the second one, which makes it a route.
    if current is not None:
        # Named after the crew, which is how the KP talks about a route on the
        # radio ("was macht Brunner?"). It outlives the reason for it if the
        # crew changes — the board can rename it in two seconds, and a name
        # somebody recognises beats a correct one nobody uses.
        group = IncidentGroup(event_id=event_id, name=f"Auftrag {person.name}", position=0)
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


#: While the Schadenplatz is still sitting in «Eingegangen», nobody has been sent
#: anywhere and the reporter may still fix what they typed. The moment the KP
#: disponiert it, a crew is driving to that address and the address stops being
#: the reporter's to change — the correction goes over the radio, like it always
#: did. This is the whole of the edit window, and it is enforced server-side.
EDITABLE_STATUS = "incoming"


def report_is_editable(incident: Incident) -> bool:
    """Can the person who reported this still correct it?"""
    return incident.status == EDITABLE_STATUS and incident.deleted_at is None


async def own_reports(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """The Meldungen this person made in this Ereignis, newest first.

    **Not part of the visibility union**, on purpose. That union answers "which
    Schadenplätze are mine to work on", and a reported tree the KP gave to
    somebody else is not one — it would show up as an Auftrag the reporter does
    not have. This answers a different question, "what did I send in", and it is
    scoped by the same two-step: the caller is bound to this person, and rows are
    matched on `reported_by_personnel_id`.
    """
    rows = await db.execute(
        select(Incident)
        .where(
            Incident.event_id == event_id,
            Incident.reported_by_personnel_id == personnel_id,
            Incident.deleted_at.is_(None),
        )
        .order_by(Incident.created_at.desc())
    )
    incidents = list(rows.scalars().all())
    if not incidents:
        return []

    # Which vehicles the KP put on each one. It is the only thing a reporter
    # actually wants from the board's side of the story: "das TLF 2 fährt hin"
    # is the answer to "hat das jemand gesehen?".
    vehicle_rows = await db.execute(
        select(IncidentAssignment.incident_id, Vehicle.name)
        .join(Vehicle, Vehicle.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_([incident.id for incident in incidents]),
            IncidentAssignment.resource_type == "vehicle",
            IncidentAssignment.unassigned_at.is_(None),
        )
        .order_by(Vehicle.display_order, Vehicle.name)
    )
    vehicles: dict[uuid.UUID, list[str]] = {}
    for incident_id, name in vehicle_rows.all():
        vehicles.setdefault(incident_id, []).append(name)

    return [
        {
            "incident_id": incident.id,
            "title": incident.title,
            "type": incident.type,
            "priority": incident.priority,
            "description": incident.description,
            "location_address": incident.location_address,
            "location_lat": incident.location_lat,
            "location_lng": incident.location_lng,
            "contact": incident.contact,
            "contact_phone": incident.contact_phone,
            "status": incident.status,
            "created_at": incident.created_at,
            "editable": report_is_editable(incident),
            "vehicles": vehicles.get(incident.id, []),
        }
        for incident in incidents
    ]


async def update_field_report(
    db: AsyncSession,
    incident: Incident,
    person: Personnel,
    payload: schemas.FeldIncidentUpdate,
    request: Request,
) -> Incident:
    """Correct a Meldung that has not been disponiert yet.

    The caller has already been checked (`report_is_editable` plus the reporter
    binding); this only writes and logs. Every field is optional — the phone
    sends the whole form back, but a Meldung that only had its description fixed
    must not have its address blanked by an omitted key.

    **The title follows the address** when it was the address: a crew's Meldung
    is titled with the street it is at (`create_field_report`), so correcting the
    street and leaving «Hauptstrasse 12» on the board's card would make the
    correction invisible exactly where it is read.
    """
    before = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "location_address": incident.location_address,
        "description": incident.description,
        "internal_notes": incident.internal_notes,
    }
    old_address = incident.location_address

    if payload.type is not None:
        incident.type = payload.type
    if payload.priority is not None:
        incident.priority = payload.priority
    if payload.description is not None:
        incident.description = payload.description or None
    if payload.internal_notes is not None:
        incident.internal_notes = payload.internal_notes or None
    if payload.location_address is not None:
        incident.location_address = payload.location_address or None
    if payload.location_lat is not None:
        incident.location_lat = payload.location_lat
    if payload.location_lng is not None:
        incident.location_lng = payload.location_lng
    if payload.contact is not None:
        incident.contact = payload.contact or None
    if payload.contact_phone is not None:
        incident.contact_phone = payload.contact_phone or None
    if payload.title is not None and payload.title.strip():
        incident.title = payload.title.strip()
    elif payload.location_address is not None and incident.title == old_address:
        incident.title = incident.location_address or incident.title

    await log_action(
        db=db,
        action_type="update",
        resource_type="incident",
        resource_id=incident.id,
        user=None,
        changes={
            "before": before,
            "after": {
                "title": incident.title,
                "type": incident.type,
                "priority": incident.priority,
                "location_address": incident.location_address,
                "description": incident.description,
            },
            "corrected_by": person.name,
            "source": "feld",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(incident)
    return incident
