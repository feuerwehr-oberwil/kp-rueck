"""Auftrag (incident group)-level resource assignment CRUD operations.

Resources assigned here belong to the Auftrag itself and are shared across all of
its stops — including when the Auftrag currently has zero stops. Mirrors the
per-incident ``assignments`` CRUD: cross-incident/cross-group conflicts are
allowed (warned in the UI, never hard-blocked); only an exact duplicate ACTIVE
row on the same Auftrag is rejected.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import and_, func, select
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Incident, IncidentGroup, IncidentGroupAssignment, Material, Personnel, User, Vehicle
from ..services.audit import log_action
from .assignments import _reko_personnel_ids, leader_rank


class ResourceNotFoundError(ValueError):
    """Requested resource id does not exist."""


class ResourceTypeMismatchError(ValueError):
    """Requested id exists, but not as the declared resource type."""


async def assign_group_resource(
    db: AsyncSession,
    group_id: uuid.UUID,
    resource_type: str,  # 'personnel', 'vehicle', 'material'
    resource_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> IncidentGroupAssignment:
    """Assign a resource to an Auftrag with transaction isolation.

    Uses SELECT FOR UPDATE to prevent race conditions when concurrent requests
    try to assign the same resource to the same Auftrag. Cross-incident /
    cross-group conflicts are allowed (the UI warns first); only an exact active
    duplicate on THIS Auftrag is rejected.

    Raises:
        ValueError: If the resource is already actively assigned to this Auftrag.
    """
    model_by_type: dict[str, type[Any]] = {"personnel": Personnel, "vehicle": Vehicle, "material": Material}
    resource_model = model_by_type[resource_type]
    if await db.scalar(select(resource_model.id).where(resource_model.id == resource_id)) is None:
        exists_as_other_type = False
        for candidate_type, model in model_by_type.items():
            if (
                candidate_type != resource_type
                and await db.scalar(select(model.id).where(model.id == resource_id)) is not None
            ):
                exists_as_other_type = True
                break
        if exists_as_other_type:
            raise ResourceTypeMismatchError("Resource id does not match resource_type")
        raise ResourceNotFoundError("Resource not found")

    # Lock the parent because there may be no existing assignment row to lock.
    await db.execute(select(IncidentGroup.id).where(IncidentGroup.id == group_id).with_for_update())
    existing = await db.execute(
        select(IncidentGroupAssignment)
        .where(
            and_(
                IncidentGroupAssignment.incident_group_id == group_id,
                IncidentGroupAssignment.resource_type == resource_type,
                IncidentGroupAssignment.resource_id == resource_id,
                IncidentGroupAssignment.unassigned_at.is_(None),  # Active assignment
            )
        )
        .with_for_update()  # Row-level locking for transaction isolation
    )
    if existing.scalar_one_or_none() is not None:
        raise ValueError("Resource already assigned to this Auftrag")

    assignment = IncidentGroupAssignment(
        incident_group_id=group_id,
        resource_type=resource_type,
        resource_id=resource_id,
        assigned_by=current_user.id,
    )
    db.add(assignment)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ValueError("Resource already assigned to this Auftrag") from exc

    await log_action(
        db=db,
        action_type="assign",
        resource_type=f"{resource_type}_group_assignment",
        resource_id=assignment.id,
        user=current_user,
        changes={
            "incident_group_id": str(group_id),
            "resource_type": resource_type,
            "resource_id": str(resource_id),
        },
        request=request,
    )

    if resource_type == "personnel":
        await sync_auto_group_leader(db, group_id)

    await db.commit()
    await db.refresh(assignment)
    return assignment


async def unassign_group_resource(
    db: AsyncSession,
    group_id: uuid.UUID,
    assignment_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """Soft-release a resource from an Auftrag (set ``unassigned_at``).

    Scoped to ``group_id`` so a stale/mismatched assignment id cannot release a
    row on a different Auftrag. Commits the release. Returns False if no active
    matching assignment exists.
    """
    result = await db.execute(
        select(IncidentGroupAssignment).where(
            and_(
                IncidentGroupAssignment.id == assignment_id,
                IncidentGroupAssignment.incident_group_id == group_id,
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        return False

    # The Einsatzleiter flag does not travel on a released row — see
    # `crud.assignments.unassign_resource` for why.
    assignment.unassigned_at = datetime.now(UTC)
    assignment.is_leader = False

    await log_action(
        db=db,
        action_type="unassign",
        resource_type=f"{assignment.resource_type}_group_assignment",
        resource_id=assignment.id,
        user=current_user,
        request=request,
    )

    # Releasing the leader hands the role on rather than leaving the route
    # without one.
    if assignment.resource_type == "personnel":
        await sync_auto_group_leader(db, assignment.incident_group_id)

    await db.commit()
    return True


async def auto_release_group_resources_if_last_stop(
    db: AsyncSession,
    incident: Incident,
    current_user: User | None,
    request: Request | None,
) -> tuple[bool, list[dict[str, Any]]]:
    """Release an Auftrag's shared resources once its LAST stop is completed.

    Route resources belong to the whole Auftrag, so they must not be released
    when a single stop closes — only when the incident just moved to ``complete``
    is the last still-open stop of its group. Mirrors the per-incident auto-release
    (``exclude_materials``): vehicles + personnel are released, materials stay on
    site for manual return. Flushes only — the caller owns the commit.

    Returns ``(released, entries)``: whether this was the last stop, and the rows
    it closed in ``StatusTransition.released_assignments_json`` shape so reopening
    the stop can put the route's squad back (see ``restore_released_assignments``).
    """
    if incident.group_id is None:
        return False, []

    # Serialize competing final-stop transitions before checking route state.
    group = await db.scalar(
        select(IncidentGroup)
        .where(IncidentGroup.id == incident.group_id, IncidentGroup.deleted_at.is_(None))
        .with_for_update()
    )
    if group is None:
        return False, []

    # Any other stop of this group still open (not completed, not deleted)?
    other_open = await db.execute(
        select(func.count())
        .select_from(Incident)
        .where(
            Incident.group_id == incident.group_id,
            Incident.id != incident.id,
            Incident.deleted_at.is_(None),
            Incident.status != "complete",
        )
    )
    if (other_open.scalar() or 0) > 0:
        return False, []  # not the last stop — keep the route's resources

    # Last stop: soft-release the group's active vehicle + personnel assignments.
    result = await db.execute(
        select(IncidentGroupAssignment).where(
            and_(
                IncidentGroupAssignment.incident_group_id == incident.group_id,
                IncidentGroupAssignment.unassigned_at.is_(None),
                IncidentGroupAssignment.resource_type != "material",
            )
        )
    )
    entries: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for assignment in result.scalars().all():
        assignment.unassigned_at = now
        entries.append({"kind": "group", "id": str(assignment.id), "was_leader": assignment.is_leader})
        await log_action(
            db=db,
            action_type="unassign",
            resource_type=f"{assignment.resource_type}_group_assignment",
            resource_id=assignment.id,
            user=current_user,
            request=request,
            changes={"reason": "auftrag_last_stop_completed"},
        )
    if entries:
        await db.flush()
    return bool(entries), entries


async def restore_released_group_resources(
    db: AsyncSession,
    entries: list[Any] | None,
    current_user: User | None,
    request: Request | None,
) -> int:
    """Undo the last-stop release when the stop is reopened — the group twin of
    ``assignments.restore_released_assignments``.

    Simpler than the per-incident one: the release here only stamps
    ``unassigned_at`` and never touches ``is_leader``, so putting the row back is
    literally clearing the stamp. Rows whose resource is active somewhere else are
    skipped for the same reason as there. Flushes only.
    """
    from .assignments import parse_released_entries

    wanted = parse_released_entries(entries, "group")
    if not wanted:
        return 0

    result = await db.execute(select(IncidentGroupAssignment).where(IncidentGroupAssignment.id.in_(wanted)))

    restored = 0
    for assignment in result.scalars().all():
        if assignment.unassigned_at is None:
            continue
        conflict = await db.scalar(
            select(IncidentGroupAssignment.id).where(
                IncidentGroupAssignment.incident_group_id == assignment.incident_group_id,
                IncidentGroupAssignment.resource_type == assignment.resource_type,
                IncidentGroupAssignment.resource_id == assignment.resource_id,
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
        if conflict is not None:
            continue
        assignment.unassigned_at = None
        restored += 1
        await log_action(
            db=db,
            action_type="assign",
            resource_type=f"{assignment.resource_type}_group_assignment",
            resource_id=assignment.id,
            user=current_user,
            request=request,
            changes={"reason": "completion_undone"},
        )

    if restored:
        await db.flush()
    return restored


async def get_group_assignments(db: AsyncSession, group_id: uuid.UUID) -> list[IncidentGroupAssignment]:
    """Get all active assignments for an Auftrag, in assignment order."""
    result = await db.execute(
        select(IncidentGroupAssignment)
        .where(
            and_(
                IncidentGroupAssignment.incident_group_id == group_id,
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentGroupAssignment.assigned_at.asc())
    )
    return list(result.scalars().all())


async def get_active_assignments_by_groups(
    db: AsyncSession, group_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[schemas.GroupAssignmentResponse]]:
    """Batch-load active assignments for several Aufträge, grouped by group id.

    Used by ``list_groups_by_event`` / ``build_group_response`` so each group
    response carries its route-level assignments without N+1 queries.
    """
    if not group_ids:
        return {}

    result = await db.execute(
        select(IncidentGroupAssignment)
        .where(
            and_(
                IncidentGroupAssignment.incident_group_id.in_(group_ids),
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentGroupAssignment.assigned_at.asc())
    )
    by_group: dict[uuid.UUID, list[schemas.GroupAssignmentResponse]] = {}
    for assignment in result.scalars().all():
        by_group.setdefault(assignment.incident_group_id, []).append(
            schemas.GroupAssignmentResponse.model_validate(assignment)
        )
    return by_group


async def update_group_assignment(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    update: schemas.GroupAssignmentUpdate,
) -> schemas.GroupAssignmentResponse | None:
    """Update a route-level assignment (currently: the Einsatzleiter flag).

    Mirrors ``crud.assignments.update_assignment``. The role is single-holder and
    guarded by a partial unique index, so the previous holder is demoted in the
    same transaction — writing the new one first would collide with the index
    rather than replace the role.
    """
    result = await db.execute(select(IncidentGroupAssignment).where(IncidentGroupAssignment.id == assignment_id))
    assignment = result.scalar_one_or_none()
    if not assignment:
        return None

    update_data = update.model_dump(exclude_unset=True)

    if "is_leader" in update_data:
        # Only a person can lead a route — see `crud.assignments.update_assignment`.
        if assignment.resource_type != "personnel":
            raise ValueError("Only personnel assignments can be marked as Einsatzleiter")

        group = (
            await db.execute(select(IncidentGroup).where(IncidentGroup.id == assignment.incident_group_id))
        ).scalar_one_or_none()

        if not update_data["is_leader"]:
            # Explicit demote hands the choice back to the board.
            if group is not None:
                group.leader_manual = False
        else:
            if group is not None:
                group.leader_manual = True
            await db.execute(
                sa_update(IncidentGroupAssignment)
                .where(
                    IncidentGroupAssignment.incident_group_id == assignment.incident_group_id,
                    IncidentGroupAssignment.id != assignment.id,
                    IncidentGroupAssignment.unassigned_at.is_(None),
                    IncidentGroupAssignment.is_leader.is_(True),
                )
                .values(is_leader=False)
            )

    for key, value in update_data.items():
        setattr(assignment, key, value)

    # Un-pinning has to re-derive before the transaction closes.
    if update_data.get("is_leader") is False:
        await db.flush()
        await sync_auto_group_leader(db, assignment.incident_group_id)

    await db.commit()
    await db.refresh(assignment)
    return schemas.GroupAssignmentResponse.model_validate(assignment)


async def sync_auto_group_leader(db: AsyncSession, group_id: uuid.UUID) -> None:
    """`sync_auto_leader` for a route — see there for the reasoning.

    One level up because the route owns the people: a stop has none of its own,
    so an Auftrag with no EL means every one of its stops has no EL.
    """
    group = (await db.execute(select(IncidentGroup).where(IncidentGroup.id == group_id))).scalar_one_or_none()
    if group is None or group.leader_manual:
        return

    # Reko personnel excluded — see `sync_auto_leader` for why.
    reko_ids = await _reko_personnel_ids(db, group.event_id)

    rows = [
        row
        for row in (
            await db.execute(
                select(IncidentGroupAssignment, Personnel)
                .join(Personnel, Personnel.id == IncidentGroupAssignment.resource_id)
                .where(
                    IncidentGroupAssignment.incident_group_id == group_id,
                    IncidentGroupAssignment.resource_type == "personnel",
                    IncidentGroupAssignment.unassigned_at.is_(None),
                )
                .order_by(IncidentGroupAssignment.assigned_at.asc())
            )
        ).all()
        if row[1].id not in reko_ids
    ]

    rows.sort(key=lambda row: (leader_rank(row[1]), row[0].assigned_at))
    winner = rows[0][0] if rows else None

    await db.execute(
        sa_update(IncidentGroupAssignment)
        .where(
            IncidentGroupAssignment.incident_group_id == group_id,
            IncidentGroupAssignment.resource_type == "personnel",
            IncidentGroupAssignment.unassigned_at.is_(None),
        )
        .values(is_leader=False)
    )
    if winner is not None:
        winner.is_leader = True

    await db.flush()
