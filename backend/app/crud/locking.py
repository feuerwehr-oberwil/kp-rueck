"""Row locks for writes that span an Auftrag, its stops and the resources on them.

LOCK ORDER – every writer takes row locks in this order and never backwards:

  1. ``incident_groups`` (Aufträge)            ascending id
  2. ``incidents`` (Einsätze, Auftrag stops)   ascending id
  3. the resource row (``personnel`` / ``vehicles`` / ``materials``)

Assignment rows (``incident_assignments``, ``incident_group_assignments``) are
leaves: write or lock them only while holding their parent (or, for the
lifecycle checks, the resource row they point to). An UPDATE takes the same row
lock implicitly, so writing a stop's ``group_position`` counts as locking it.

Two writers that keep this order can wait for each other but never deadlock.
Completing a stop used to lock the incident and then its Auftrag, while a stop
reorder locked the Auftrag and then its stops – a forced overlap deadlocked
(audit 2026-10, F08). Who follows it: completion and reopen
(``incidents.update_incident_status`` / ``update_incident``), stop attach,
detach and reorder and Auftrag delete (``groups``), release
(``assignments.unassign_resource``, ``group_assignments.unassign_group_resource``),
assignment (``assign_resource``, ``assign_group_resource``) and the resource
lifecycle (archive / purge / personnel delete). A merge locks only incidents,
in id order (``services/duplicates.lock_pair``).
"""

import uuid
from collections.abc import Iterable
from typing import Literal, overload

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, IncidentGroup, Material, Personnel, Vehicle

AssignableResource = Personnel | Vehicle | Material

_RESOURCE_MODELS: dict[str, type[AssignableResource]] = {
    "personnel": Personnel,
    "vehicle": Vehicle,
    "material": Material,
}

# A stop that changes Auftrag between our unlocked look and our lock makes us start
# over; each retry needs another committed move of the same stop in that instant.
_MAX_MEMBERSHIP_ATTEMPTS = 3


async def lock_groups(db: AsyncSession, group_ids: Iterable[uuid.UUID | None]) -> None:
    """Step 1: row-lock Aufträge in ascending id order (deleted ones included, ``None`` skipped)."""
    for group_id in sorted({group_id for group_id in group_ids if group_id is not None}):
        await db.execute(select(IncidentGroup.id).where(IncidentGroup.id == group_id).with_for_update())


async def lock_incidents_with_groups(
    db: AsyncSession,
    incident_ids: Iterable[uuid.UUID],
    extra_group_ids: Iterable[uuid.UUID | None] = (),
) -> dict[uuid.UUID, Incident]:
    """Lock the incidents' current Aufträge plus ``extra_group_ids``, then the incidents.

    The Auftrag an incident belongs to is only known by reading the incident, which
    must not be locked yet (step 2 before step 1). So the membership is read without
    a lock, the Aufträge and incidents are locked in order inside a savepoint, and if
    an incident moved to another Auftrag in between, the savepoint is rolled back –
    which releases its row locks – and the whole thing is taken again. Moving a stop
    always holds the Auftrag it leaves, so once our locks are held the membership
    stays put.

    Returns the locked incidents by id (refreshed, ``populate_existing``); unknown
    ids are absent. Flushes pending changes (the savepoint does).
    """
    ids = sorted(set(incident_ids))
    extra = {group_id for group_id in extra_group_ids if group_id is not None}
    for _ in range(_MAX_MEMBERSHIP_ATTEMPTS):
        rows = await db.execute(select(Incident.id, Incident.group_id).where(Incident.id.in_(ids)))
        seen = dict(rows.tuples().all())
        savepoint = await db.begin_nested()
        await lock_groups(db, {*extra, *seen.values()})
        locked: dict[uuid.UUID, Incident] = {}
        for incident_id in ids:
            incident = await db.scalar(
                select(Incident)
                .where(Incident.id == incident_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if incident is not None:
                locked[incident_id] = incident
        if all(seen.get(incident_id) == incident.group_id for incident_id, incident in locked.items()):
            await savepoint.commit()  # RELEASE SAVEPOINT – the locks stay with the transaction
            return locked
        await savepoint.rollback()
    raise RuntimeError("Auftrag membership kept changing while locking; giving up")


async def lock_incident_with_group(
    db: AsyncSession,
    incident_id: uuid.UUID,
    extra_group_ids: Iterable[uuid.UUID | None] = (),
) -> Incident | None:
    """``lock_incidents_with_groups`` for one incident: its Auftrag (if any) first, then it."""
    return (await lock_incidents_with_groups(db, [incident_id], extra_group_ids)).get(incident_id)


@overload
async def lock_resource(
    db: AsyncSession, resource_type: Literal["personnel"], resource_id: uuid.UUID
) -> Personnel | None: ...
@overload
async def lock_resource(
    db: AsyncSession, resource_type: Literal["vehicle"], resource_id: uuid.UUID
) -> Vehicle | None: ...
@overload
async def lock_resource(
    db: AsyncSession, resource_type: Literal["material"], resource_id: uuid.UUID
) -> Material | None: ...
@overload
async def lock_resource(db: AsyncSession, resource_type: str, resource_id: uuid.UUID) -> AssignableResource | None: ...
async def lock_resource(db: AsyncSession, resource_type: str, resource_id: uuid.UUID) -> AssignableResource | None:
    """Step 3: row-lock a personnel / vehicle / material row (fresh from the database).

    Every assignment writer and every lifecycle writer (archive, purge, delete) takes
    this lock, so an assignment cannot slip in between "is it in use?" and the archive
    or the delete. ``KeyError`` for a resource_type that is none of the three.
    """
    model = _RESOURCE_MODELS[resource_type]
    resource: AssignableResource | None = await db.scalar(
        select(model).where(model.id == resource_id).with_for_update().execution_options(populate_existing=True)
    )
    return resource
