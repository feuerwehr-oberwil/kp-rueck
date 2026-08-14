"""Auftrag (incident group) CRUD operations.

An Auftrag is a lightweight ordered container over real incidents. Stops are
first-class ``Incident`` rows carrying ``group_id`` / ``group_position``; the
group holds only route metadata. Progress is derived, never stored.
"""

import uuid
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..database import execute_dml
from ..models import Incident, IncidentGroup, IncidentGroupAssignment, User
from ..services.audit import log_action
from . import events as events_crud
from . import group_assignments as group_assignments_crud

# Stops in these statuses count as "erledigt" for the derived progress roll-up.
_DONE_STATUSES = ("returning", "complete")


async def _get_group(db: AsyncSession, group_id: uuid.UUID) -> IncidentGroup | None:
    """Load a non-deleted Auftrag by id."""
    result = await db.execute(
        select(IncidentGroup).where(
            IncidentGroup.id == group_id,
            IncidentGroup.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def get_group(db: AsyncSession, group_id: uuid.UUID) -> IncidentGroup | None:
    """Public accessor: load a non-deleted Auftrag by id (or None)."""
    return await _get_group(db, group_id)


async def build_group_response(db: AsyncSession, group: IncidentGroup) -> schemas.IncidentGroupResponse:
    """Build a full response (stop_ids + progress) for a single Auftrag."""
    result = await db.execute(
        select(Incident.id, Incident.status)
        .where(Incident.group_id == group.id, Incident.deleted_at.is_(None))
        .order_by(Incident.group_position.asc(), Incident.created_at.asc())
    )
    rows = result.all()
    stop_ids = [row.id for row in rows]
    done = sum(1 for row in rows if row.status in _DONE_STATUSES)
    assignments_by_group = await group_assignments_crud.get_active_assignments_by_groups(db, [group.id])
    response = schemas.IncidentGroupResponse.model_validate(group)
    response.stop_ids = stop_ids
    response.progress = schemas.GroupProgress(total=len(rows), done=done)
    response.assignments = assignments_by_group.get(group.id, [])
    return response


async def list_groups_by_event(db: AsyncSession, event_id: uuid.UUID) -> list[schemas.IncidentGroupResponse]:
    """List an event's Aufträge (excluding soft-deleted), ordered by ``position``.

    Batch-loads member incidents in ``group_position`` order and computes the
    derived ``stop_ids`` + ``progress`` roll-up for each group.
    """
    result = await db.execute(
        select(IncidentGroup)
        .where(IncidentGroup.event_id == event_id, IncidentGroup.deleted_at.is_(None))
        .order_by(IncidentGroup.position.asc(), IncidentGroup.created_at.asc())
    )
    groups = list(result.scalars().all())
    if not groups:
        return []

    group_ids = [group.id for group in groups]

    # Batch-load member stops (non-deleted) for all groups in one query.
    stops_result = await db.execute(
        select(Incident.id, Incident.group_id, Incident.status)
        .where(Incident.group_id.in_(group_ids), Incident.deleted_at.is_(None))
        .order_by(Incident.group_position.asc(), Incident.created_at.asc())
    )
    stops_by_group: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = {}
    for row in stops_result:
        stops_by_group.setdefault(row.group_id, []).append((row.id, row.status))

    # Batch-load active route-level assignments for all groups in one query.
    assignments_by_group = await group_assignments_crud.get_active_assignments_by_groups(db, group_ids)

    responses: list[schemas.IncidentGroupResponse] = []
    for group in groups:
        stops = stops_by_group.get(group.id, [])
        done = sum(1 for _, status in stops if status in _DONE_STATUSES)
        response = schemas.IncidentGroupResponse.model_validate(group)
        response.stop_ids = [stop_id for stop_id, _ in stops]
        response.progress = schemas.GroupProgress(total=len(stops), done=done)
        response.assignments = assignments_by_group.get(group.id, [])
        responses.append(response)
    return responses


async def create_group(
    db: AsyncSession,
    group: schemas.IncidentGroupCreate,
    current_user: User,
    request: Request,
) -> IncidentGroup:
    """Create a new Auftrag, appended to the end of the event's route list."""
    max_pos = await db.scalar(
        select(func.max(IncidentGroup.position)).where(
            IncidentGroup.event_id == group.event_id,
            IncidentGroup.deleted_at.is_(None),
        )
    )
    db_group = IncidentGroup(
        **group.model_dump(),
        created_by=current_user.id,
        position=(max_pos + 1) if max_pos is not None else 0,
    )
    db.add(db_group)
    await db.flush()

    await log_action(
        db=db,
        action_type="create",
        resource_type="incident_group",
        resource_id=db_group.id,
        user=current_user,
        changes={"created": group.model_dump(mode="json")},
        request=request,
    )
    await events_crud.update_event_activity(db, db_group.event_id)

    await db.commit()
    await db.refresh(db_group)
    return db_group


async def update_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    group_update: schemas.IncidentGroupUpdate,
    current_user: User,
    request: Request,
) -> IncidentGroup | None:
    """Update an Auftrag's rename/color/notes (partial PATCH)."""
    group = await _get_group(db, group_id)
    if group is None:
        return None

    changes = group_update.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(group, field, value)
    group.updated_at = datetime.now(UTC)

    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="incident_group",
            resource_id=group.id,
            user=current_user,
            changes={"updated": group_update.model_dump(mode="json", exclude_unset=True)},
            request=request,
        )
    await events_crud.update_event_activity(db, group.event_id)

    await db.commit()
    await db.refresh(group)
    return group


async def record_announcement(
    db: AsyncSession,
    group_id: uuid.UUID,
    announcement: schemas.GroupAnnouncementRequest,
) -> IncidentGroup | None:
    """Remember that a Funkdurchsage was made for this Auftrag.

    Stores the resource fingerprint the client announced with, which stop it was
    about and whether it was the full form, so the NEXT stop can decide between
    the full announcement and the short «weiter mit Stop N» continuation.

    Deliberately not audit-logged: this is a note about what was said on the
    radio, written on every dispatch, not a change to the Auftrag itself.
    """
    group = await _get_group(db, group_id)
    if group is None:
        return None

    group.last_announced_at = datetime.now(UTC)
    group.last_announced_fingerprint = announcement.fingerprint
    group.last_announced_stop_id = announcement.stop_id
    group.last_announced_full = announcement.full

    await db.commit()
    await db.refresh(group)
    return group


async def soft_delete_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> IncidentGroup | None:
    """Soft-delete an Auftrag and detach its stops in the same transaction.

    Sets ``deleted_at`` and nulls ``group_id`` on member incidents so they stay
    on the board, ungrouped (the incidents themselves are never deleted).
    """
    group = await _get_group(db, group_id)
    if group is None:
        return None

    group.deleted_at = datetime.now(UTC)

    assignments_result = await db.execute(
        select(IncidentGroupAssignment).where(
            IncidentGroupAssignment.incident_group_id == group_id,
            IncidentGroupAssignment.unassigned_at.is_(None),
        )
    )
    active_assignments = list(assignments_result.scalars().all())
    for assignment in active_assignments:
        assignment.unassigned_at = group.deleted_at

    # Null out group_id on member incidents so they remain on the board.
    detach_result = await execute_dml(db, update(Incident).where(Incident.group_id == group_id).values(group_id=None))
    detached = detach_result.rowcount or 0

    await log_action(
        db=db,
        action_type="archive",
        resource_type="incident_group",
        resource_id=group.id,
        user=current_user,
        changes={
            "deleted": True,
            "detached_stops": detached,
            "released_assignments": len(active_assignments),
        },
        request=request,
    )
    await events_crud.update_event_activity(db, group.event_id)

    await db.commit()
    return group


async def reorder_groups(
    db: AsyncSession,
    event_id: uuid.UUID,
    ordered_ids: list[uuid.UUID],
) -> int:
    """Persist a manual order for an event's Aufträge.

    Clones ``reorder_incidents``: each group's ``position`` is set to its index
    in ``ordered_ids``. Only non-deleted groups belonging to ``event_id`` are
    touched — unknown/stale ids are ignored. Returns the number repositioned.
    """
    if not ordered_ids:
        return 0

    result = await db.execute(
        select(IncidentGroup).where(
            IncidentGroup.event_id == event_id,
            IncidentGroup.id.in_(ordered_ids),
            IncidentGroup.deleted_at.is_(None),
        )
    )
    groups_by_id = {group.id: group for group in result.scalars().all()}

    updated = 0
    for index, group_id in enumerate(ordered_ids):
        group = groups_by_id.get(group_id)
        if group is None:
            continue
        if group.position != index:
            group.position = index
        updated += 1

    if updated:
        await events_crud.update_event_activity(db, event_id)
        await db.commit()

    return updated


async def reorder_group_stops(
    db: AsyncSession,
    group_id: uuid.UUID,
    ordered_ids: list[uuid.UUID],
) -> int:
    """Persist a manual order for the stops within one Auftrag.

    Same pattern as ``reorder_groups`` but on ``Incident.group_position``, scoped
    to ``group_id``. Unknown/stale ids are ignored. Returns the number reordered.
    """
    if not ordered_ids:
        return 0

    await db.execute(select(IncidentGroup.id).where(IncidentGroup.id == group_id).with_for_update())
    result = await db.execute(
        select(Incident)
        .where(
            Incident.group_id == group_id,
            Incident.deleted_at.is_(None),
        )
        .order_by(Incident.group_position.asc(), Incident.created_at.asc())
    )
    incidents_by_id = {incident.id: incident for incident in result.scalars().all()}

    temporary_base = -(len(ordered_ids) + 1)
    for offset, incident in enumerate(incidents_by_id.values()):
        incident.group_position = temporary_base - offset
    await db.flush()

    updated = 0
    positioned_ids: set[uuid.UUID] = set()
    for index, incident_id in enumerate(ordered_ids):
        ordered_incident = incidents_by_id.get(incident_id)
        if ordered_incident is None:
            continue
        positioned_ids.add(incident_id)
        if ordered_incident.group_position != index:
            ordered_incident.group_position = index
        updated += 1

    next_position = len(ordered_ids)
    for incident in incidents_by_id.values():
        if incident.id not in positioned_ids:
            incident.group_position = next_position
            next_position += 1

    if updated:
        await db.commit()

    return updated


async def add_stops_to_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    incident_ids: list[uuid.UUID],
    current_user: User,
    request: Request,
) -> list[uuid.UUID] | None:
    """Attach existing incidents to an Auftrag, appended at the end of the route.

    Returns the list of newly-attached incident ids, or ``None`` if the group
    does not exist. Unknown ids are skipped; already-member ids are skipped.

    Raises:
        ValueError: if any provided incident belongs to a different event.
    """
    group = await db.scalar(
        select(IncidentGroup).where(IncidentGroup.id == group_id, IncidentGroup.deleted_at.is_(None)).with_for_update()
    )
    if group is None:
        return None

    if not incident_ids:
        return []

    result = await db.execute(
        select(Incident).where(
            Incident.id.in_(incident_ids),
            Incident.deleted_at.is_(None),
        )
    )
    incidents_by_id = {incident.id: incident for incident in result.scalars().all()}

    # Verify same event: reject cross-event incidents outright.
    for incident_id in incident_ids:
        incident = incidents_by_id.get(incident_id)
        if incident is not None and incident.event_id != group.event_id:
            raise ValueError("Incident belongs to a different event")

    # Append at the end of the current route.
    max_pos = await db.scalar(
        select(func.max(Incident.group_position)).where(
            Incident.group_id == group_id,
            Incident.deleted_at.is_(None),
        )
    )
    next_pos = (max_pos + 1) if max_pos is not None else 0

    attached: list[uuid.UUID] = []
    for incident_id in incident_ids:
        incident = incidents_by_id.get(incident_id)
        if incident is None or incident.group_id == group_id:
            continue
        incident.group_id = group_id
        incident.group_position = next_pos
        next_pos += 1
        attached.append(incident_id)

    if attached:
        await log_action(
            db=db,
            action_type="update",
            resource_type="incident_group",
            resource_id=group_id,
            user=current_user,
            changes={"stops_added": [str(i) for i in attached]},
            request=request,
        )
        await events_crud.update_event_activity(db, group.event_id)
        await db.commit()

    return attached


async def remove_stop_from_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    incident_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """Detach a stop from an Auftrag (null ``group_id``, leave status/board alone)."""
    result = await db.execute(
        select(Incident).where(
            Incident.id == incident_id,
            Incident.group_id == group_id,
            Incident.deleted_at.is_(None),
        )
    )
    incident = result.scalar_one_or_none()
    if incident is None:
        return False

    incident.group_id = None

    await log_action(
        db=db,
        action_type="update",
        resource_type="incident_group",
        resource_id=group_id,
        user=current_user,
        changes={"stop_removed": str(incident_id)},
        request=request,
    )
    await events_crud.update_event_activity(db, incident.event_id)

    await db.commit()
    return True
