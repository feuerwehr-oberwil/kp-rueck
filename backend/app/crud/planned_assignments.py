"""«Danach» – planned assignments (Jetzt / Danach, owner picks 24.11.2026).

A resource is **Jetzt** where it has an active assignment row (an Einsatz or an Auftrag) and
**Danach** where it has a ``PlannedAssignment`` row. The rules this module holds:

* **Jetzt on one holder only** – a person, a vehicle, a non-consumable material. A Reko row
  never binds (a Reko person keeps their own order), consumable material never does.
  ``ensure_not_busy`` is called by the board's assign routes (``exclusive=True``) under the
  resource row lock; internal writers (undo, merge, import, seed) keep writing as before.
* **Free** = no Jetzt row. Nothing here reads a status: completion releases the crew
  («Abgeschlossen», owner pick 4) and a removal by hand releases too.
* A free resource's **first** Danach is **ready** – the board offers it as a to-do and never
  moves it by itself (owner pick 5). «Zuteilen» is ``promote``: a plain exclusive assign,
  which fulfils the plan (``fulfil``).
* A holder that closes drops the plans pointing at it (``drop_for_incident`` /
  ``drop_for_group_if_last_stop``); reopening it puts them back (``restore_dropped``).

Lock order (``crud/locking.py``): the holder (Auftrag, then Einsatz), then the resource row.
Planned rows are leaves under both.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Event,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    PlannedAssignment,
    User,
)
from ..services.audit import log_action
from .locking import AssignableResource, lock_groups, lock_incident_with_group, lock_resource


class ResourceBusyError(Exception):
    """The resource is Jetzt on another holder. ``holders`` are their labels, for the 409."""

    def __init__(self, holders: list[str]) -> None:
        super().__init__(f"Ressource ist schon im Einsatz: {', '.join(holders)}")
        self.holders = holders


class PlanRefusedError(Exception):
    """A plan that cannot exist. ``str()`` is the German 409 detail."""


@dataclass(frozen=True)
class JetztHolder:
    """Where a resource is Jetzt: an Einsatz (``kind='incident'``) or an Auftrag (``'group'``)."""

    kind: str
    holder_id: uuid.UUID
    label: str


def never_binds(resource: AssignableResource | None) -> bool:
    """Consumable material is drawn by several Einsätze at once – never Jetzt, never Danach."""
    return isinstance(resource, Material) and resource.consumable


async def jetzt_holders(
    db: AsyncSession, event_id: uuid.UUID, resource_type: str, resource_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[JetztHolder]]:
    """Every holder each resource is Jetzt on IN THIS EREIGNIS: active crew/vehicle/material rows
    on a live Einsatz (Reko rows excluded) and active rows on a live Auftrag.

    Scoped to the Ereignis on purpose: the roster and the fleet are shared, and a training
    Ereignis left open must neither block a live assignment nor hold a Danach back – the board
    only ever shows (and asks about) its own Ereignis."""
    found: dict[uuid.UUID, list[JetztHolder]] = {rid: [] for rid in resource_ids}
    if not resource_ids:
        return found
    incident_rows = await db.execute(
        select(IncidentAssignment.resource_id, Incident.id, Incident.title, Incident.location_address)
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .where(
            IncidentAssignment.resource_type == resource_type,
            IncidentAssignment.resource_id.in_(resource_ids),
            IncidentAssignment.unassigned_at.is_(None),
            IncidentAssignment.purpose != "reko",
            Incident.deleted_at.is_(None),
            Incident.merged_into_id.is_(None),
            Incident.event_id == event_id,
        )
    )
    for rid, incident_id, title, address in incident_rows.tuples():
        found[rid].append(JetztHolder("incident", incident_id, address or title or "Einsatz"))
    group_rows = await db.execute(
        select(IncidentGroupAssignment.resource_id, IncidentGroup.id, IncidentGroup.name)
        .join(IncidentGroup, IncidentGroup.id == IncidentGroupAssignment.incident_group_id)
        .where(
            IncidentGroupAssignment.resource_type == resource_type,
            IncidentGroupAssignment.resource_id.in_(resource_ids),
            IncidentGroupAssignment.unassigned_at.is_(None),
            IncidentGroup.deleted_at.is_(None),
            IncidentGroup.event_id == event_id,
        )
    )
    for rid, group_id, name in group_rows.tuples():
        found[rid].append(JetztHolder("group", group_id, name or "Auftrag"))
    return found


async def ensure_not_busy(
    db: AsyncSession,
    resource: AssignableResource,
    resource_type: str,
    *,
    event_id: uuid.UUID,
    incident_id: uuid.UUID | None = None,
    group_id: uuid.UUID | None = None,
) -> None:
    """Refuse a new Jetzt while the resource is Jetzt anywhere else in the Ereignis (owner pick 2B:
    never on two).

    Call with the resource row locked: every writer of its assignment rows holds that lock, so the
    answer cannot change before the caller's insert. A Reko row on a Reko assignment does not go
    through here.

    Raises:
        ResourceBusyError: Jetzt on another Einsatz or Auftrag.
    """
    if never_binds(resource):
        return
    holders = (await jetzt_holders(db, event_id, resource_type, [resource.id]))[resource.id]
    others = [
        h
        for h in holders
        if not (h.kind == "incident" and h.holder_id == incident_id)
        and not (h.kind == "group" and h.holder_id == group_id)
    ]
    if others:
        raise ResourceBusyError([h.label for h in others])


async def fulfil(
    db: AsyncSession,
    resource_type: str,
    resource_id: uuid.UUID,
    *,
    incident_id: uuid.UUID | None = None,
    group_id: uuid.UUID | None = None,
) -> bool:
    """A resource just became Jetzt on a holder: its Danach there is done. True if one was."""
    holder = (
        PlannedAssignment.incident_id == incident_id
        if incident_id is not None
        else PlannedAssignment.incident_group_id == group_id
    )
    result = await db.execute(
        delete(PlannedAssignment)
        .where(holder, PlannedAssignment.resource_type == resource_type, PlannedAssignment.resource_id == resource_id)
        .returning(PlannedAssignment.id)
    )
    return result.first() is not None


async def plan_resource(
    db: AsyncSession,
    *,
    resource_type: str,
    resource_id: uuid.UUID,
    incident_id: uuid.UUID | None,
    group_id: uuid.UUID | None,
    current_user: User,
    request: Request | None,
) -> PlannedAssignment:
    """«Danach vormerken»: put the resource at the END of its queue for this holder.

    Raises:
        LookupError: the holder or the resource does not exist (or the holder is deleted).
        PlanRefusedError: closed holder, consumable material, already Jetzt or planned here.
        ResourceNotAssignableError: ``ensure_assignable`` refused the resource.
    """
    from .assignments import ensure_assignable

    if (incident_id is None) == (group_id is None):
        raise PlanRefusedError("Genau ein Ziel angeben: Einsatz oder Auftrag.")
    incident: Incident | None = None
    if incident_id is not None:
        incident = await lock_incident_with_group(db, incident_id)
        if incident is None or incident.deleted_at is not None or incident.merged_into_id is not None:
            raise LookupError(f"incident {incident_id} does not exist")
        if incident.status == "complete":
            raise PlanRefusedError("Der Einsatz ist abgeschlossen – hier wird nichts mehr vorgemerkt.")
        event_id = incident.event_id
    else:
        await lock_groups(db, [group_id])
        group = await db.get(IncidentGroup, group_id, populate_existing=True)
        if group is None or group.deleted_at is not None:
            raise LookupError(f"incident group {group_id} does not exist")
        event_id = group.event_id
    resource = await lock_resource(db, resource_type, resource_id)
    if resource is None:
        raise LookupError(f"{resource_type} {resource_id} does not exist")
    event = await db.get(Event, event_id)
    if event is None:
        raise LookupError(f"event {event_id} does not exist")
    ensure_assignable(resource, event=event, incident=incident)
    if never_binds(resource):
        raise PlanRefusedError("Verbrauchsmaterial wird nicht vorgemerkt – es kann auf mehreren Einsätzen sein.")
    holders = (await jetzt_holders(db, event_id, resource_type, [resource_id]))[resource_id]
    if any(h.holder_id in (incident_id, group_id) for h in holders):
        raise PlanRefusedError(f"«{resource.name}» ist hier schon im Einsatz.")
    already = await db.scalar(
        select(PlannedAssignment.id).where(
            PlannedAssignment.incident_id == incident_id
            if incident_id is not None
            else PlannedAssignment.incident_group_id == group_id,
            PlannedAssignment.resource_type == resource_type,
            PlannedAssignment.resource_id == resource_id,
        )
    )
    if already is not None:
        raise PlanRefusedError(f"«{resource.name}» ist hier schon vorgemerkt.")

    row = PlannedAssignment(
        event_id=event_id,
        incident_id=incident_id,
        incident_group_id=group_id,
        resource_type=resource_type,
        resource_id=resource_id,
        planned_by=current_user.id,
        # Python-side, not the server default: two plans in one transaction keep their order.
        planned_at=datetime.now(UTC),
    )
    db.add(row)
    await db.flush()
    await log_action(
        db=db,
        action_type="plan",
        resource_type=f"{resource_type}_planned_assignment",
        resource_id=row.id,
        user=current_user,
        changes={
            "incident_id": str(incident_id) if incident_id else None,
            "incident_group_id": str(group_id) if group_id else None,
            "resource_type": resource_type,
            "resource_id": str(resource_id),
        },
        request=request,
    )
    await db.refresh(row)
    return row


async def remove_plan(
    db: AsyncSession, planned_id: uuid.UUID, current_user: User, request: Request | None
) -> PlannedAssignment | None:
    """«Vormerkung löschen». Returns the deleted row (for the broadcast), None if it was gone."""
    row = await db.get(PlannedAssignment, planned_id)
    if row is None:
        return None
    await db.delete(row)
    await db.flush()
    await log_action(
        db=db,
        action_type="unplan",
        resource_type=f"{row.resource_type}_planned_assignment",
        resource_id=row.id,
        user=current_user,
        changes={"resource_id": str(row.resource_id)},
        request=request,
    )
    return row


async def set_dismissed(db: AsyncSession, planned_id: uuid.UUID, dismissed: bool) -> PlannedAssignment | None:
    """«Verwerfen» of the «Danach frei» to-do (and its undo). The plan itself stays."""
    row = await db.get(PlannedAssignment, planned_id)
    if row is None:
        return None
    row.dismissed_at = datetime.now(UTC) if dismissed else None
    await db.flush()
    return row


async def promote(
    db: AsyncSession, planned_id: uuid.UUID, current_user: User, request: Request
) -> IncidentAssignment | IncidentGroupAssignment:
    """«Zuteilen»: the plan becomes Jetzt – an exclusive assign, which fulfils the plan.

    Raises:
        LookupError: the plan is gone (somebody else answered it first).
        ResourceBusyError: the resource is still Jetzt elsewhere.
        plus whatever the assign raises.
    """
    from . import assignments, group_assignments

    row = await db.get(PlannedAssignment, planned_id)
    if row is None:
        raise LookupError(f"planned assignment {planned_id} does not exist")
    if row.incident_id is not None:
        return await assignments.assign_resource(
            db, row.incident_id, row.resource_type, row.resource_id, current_user, request, exclusive=True
        )
    assert row.incident_group_id is not None  # noqa: S101 – planned_one_holder
    return await group_assignments.assign_group_resource(
        db, row.incident_group_id, row.resource_type, row.resource_id, current_user, request, exclusive=True
    )


def _entry(row: PlannedAssignment) -> dict[str, Any]:
    return {
        "kind": "planned",
        "incident_id": str(row.incident_id) if row.incident_id else None,
        "incident_group_id": str(row.incident_group_id) if row.incident_group_id else None,
        "resource_type": row.resource_type,
        "resource_id": str(row.resource_id),
        "planned_at": row.planned_at.isoformat(),
        "planned_by": str(row.planned_by) if row.planned_by else None,
    }


async def _drop(
    db: AsyncSession, where: Any, reason: str, current_user: User | None, request: Request | None
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(PlannedAssignment).where(where))).scalars().all()
    entries = []
    for row in rows:
        entries.append(_entry(row))
        await db.delete(row)
        await log_action(
            db=db,
            action_type="unplan",
            resource_type=f"{row.resource_type}_planned_assignment",
            resource_id=row.id,
            user=current_user,
            changes={"reason": reason},
            request=request,
        )
    if rows:
        await db.flush()
    return entries


async def drop_for_incident(
    db: AsyncSession, incident_id: uuid.UUID, current_user: User | None, request: Request | None
) -> list[dict[str, Any]]:
    """The Einsatz closed: its Danach go (the queues move up). Returns undo entries."""
    return await _drop(db, PlannedAssignment.incident_id == incident_id, "incident_completed", current_user, request)


async def drop_for_group_if_last_stop(
    db: AsyncSession, incident: Incident, current_user: User | None, request: Request | None
) -> list[dict[str, Any]]:
    """The Auftrag's last open stop closed: the Auftrag is done, its Danach go. Returns undo entries.

    The caller holds the Auftrag's lock (completion takes it before the stop's).
    """
    if incident.group_id is None:
        return []
    other_open = await db.scalar(
        select(func.count())
        .select_from(Incident)
        .where(
            Incident.group_id == incident.group_id,
            Incident.id != incident.id,
            Incident.deleted_at.is_(None),
            Incident.status != "complete",
        )
    )
    if other_open:
        return []
    return await _drop(
        db, PlannedAssignment.incident_group_id == incident.group_id, "auftrag_completed", current_user, request
    )


async def restore_dropped(db: AsyncSession, entries: list[Any] | None, event_id: uuid.UUID) -> int:
    """Reopen: put back the Danach the completion dropped, at their old place in the queue.

    Tolerant like ``parse_released_entries``: an entry it cannot read is skipped, and one whose
    plan exists again (planned anew meanwhile) is not written twice.
    """
    restored = 0
    for entry in entries or []:
        if not isinstance(entry, dict) or entry.get("kind") != "planned":
            continue
        try:
            incident_id = uuid.UUID(entry["incident_id"]) if entry.get("incident_id") else None
            group_id = uuid.UUID(entry["incident_group_id"]) if entry.get("incident_group_id") else None
            resource_id = uuid.UUID(str(entry["resource_id"]))
            planned_at = datetime.fromisoformat(str(entry["planned_at"]))
            planned_by = uuid.UUID(entry["planned_by"]) if entry.get("planned_by") else None
            resource_type = str(entry["resource_type"])
        except (KeyError, TypeError, ValueError):
            continue
        if (incident_id is None) == (group_id is None):
            continue
        holder = (
            PlannedAssignment.incident_id == incident_id
            if incident_id is not None
            else PlannedAssignment.incident_group_id == group_id
        )
        exists = await db.scalar(
            select(PlannedAssignment.id).where(
                holder, PlannedAssignment.resource_type == resource_type, PlannedAssignment.resource_id == resource_id
            )
        )
        if exists is not None:
            continue
        db.add(
            PlannedAssignment(
                event_id=event_id,
                incident_id=incident_id,
                incident_group_id=group_id,
                resource_type=resource_type,
                resource_id=resource_id,
                planned_at=planned_at,
                planned_by=planned_by,
            )
        )
        restored += 1
    if restored:
        await db.flush()
    return restored


@dataclass(frozen=True)
class PlannedView:
    """A plan as the board reads it: the row, its place in the resource's queue, and whether it
    is ready (the resource is free and this is its first Danach). ``ready_since``: when it became
    ready – the resource's last release, or the planning if that came later; the bell's
    «Zu erledigen» turns red 5' after it (owner pick 24.11.2026)."""

    row: PlannedAssignment
    position: int
    ready: bool
    ready_since: datetime | None = None


async def _last_release(db: AsyncSession, resource_type: str, ids: list[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    """Each resource's most recent release, over Einsatz and Auftrag rows."""
    last: dict[uuid.UUID, datetime] = {}
    if not ids:
        return last
    for model in (IncidentAssignment, IncidentGroupAssignment):
        rows = await db.execute(
            select(model.resource_id, func.max(model.unassigned_at))
            .where(model.resource_type == resource_type, model.resource_id.in_(ids), model.unassigned_at.is_not(None))
            .group_by(model.resource_id)
        )
        for rid, at in rows.tuples():
            if at is not None and (rid not in last or at > last[rid]):
                last[rid] = at
    return last


async def list_for_event(db: AsyncSession, event_id: uuid.UUID) -> list[PlannedView]:
    """The Ereignis's plans on live holders, each resource's queue in order."""
    rows = (
        (
            await db.execute(
                select(PlannedAssignment)
                .outerjoin(Incident, Incident.id == PlannedAssignment.incident_id)
                .outerjoin(IncidentGroup, IncidentGroup.id == PlannedAssignment.incident_group_id)
                .where(
                    PlannedAssignment.event_id == event_id,
                    (Incident.id.is_(None)) | (Incident.deleted_at.is_(None) & Incident.merged_into_id.is_(None)),
                    (IncidentGroup.id.is_(None)) | IncidentGroup.deleted_at.is_(None),
                )
                .order_by(PlannedAssignment.planned_at, PlannedAssignment.id)
            )
        )
        .scalars()
        .all()
    )
    busy: dict[tuple[str, uuid.UUID], bool] = {}
    released: dict[tuple[str, uuid.UUID], datetime] = {}
    for resource_type in ("personnel", "vehicle", "material"):
        ids = sorted({r.resource_id for r in rows if r.resource_type == resource_type})
        for rid, holders in (await jetzt_holders(db, event_id, resource_type, ids)).items():
            busy[(resource_type, rid)] = bool(holders)
        free = [rid for rid in ids if not busy[(resource_type, rid)]]
        for rid, at in (await _last_release(db, resource_type, free)).items():
            released[(resource_type, rid)] = at
    seen: dict[tuple[str, uuid.UUID], int] = {}
    views = []
    for row in rows:
        key = (row.resource_type, row.resource_id)
        seen[key] = seen.get(key, 0) + 1
        ready = seen[key] == 1 and not busy.get(key, False)
        since = max(row.planned_at, released[key]) if ready and key in released else (row.planned_at if ready else None)
        views.append(PlannedView(row=row, position=seen[key], ready=ready, ready_since=since))
    return views
