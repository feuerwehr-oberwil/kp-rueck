"""Row locks for writes that span an Auftrag, its stops and the resources on them.

LOCK ORDER – every writer takes row locks in this order and never backwards:

  0. alarm rows (``divera_emergencies``)       ascending id: ``crud.divera.lock_divera_emergency``
                                               (one) / ``lock_divera_emergencies`` (a bulk attach)
  0b. the Ereignis' numbering lock             a writer that creates a card: ``lock_incident_numbering``
  1. ``incident_groups`` (Aufträge)            ascending id
  2. ``incidents`` (Einsätze, Auftrag stops)   ascending id
  3. resource rows (``personnel`` / ``vehicles`` / ``materials``)
                                               by (resource_type, id)
  4. the Ereignis row (``events``)             written last: ``events.update_event_activity``

Every card INSERT takes the Ereignis' numbering lock (``lock_incident_numbering``) to the
commit, so a writer that has created a card must not wait for an alarm row after it. A single
attach holds its alarm while it waits for that lock; a bulk attach that took its alarms one by
one held the lock while it waited for such an alarm. It locks all of them before its first card.
The other way round, a writer that will create a card takes the lock before any Auftrag or card:
a bulk attach holds it while it flags (key-shares) a card as a duplicate, and a merge-report
that held that card and only then inserted its report waited for it. ``create_incident``, the
/feld takeover and every merge of a new report (``lock_merge_target``) take it first.

A status update holds its card and then stamps the Ereignis. A bulk attach stamped it with its
first card and then flagged (key-shared) another card for its second alarm: each waited for
the other. A writer of several cards stamps once, after the last
(``create_incident(touch_event=False)``).

Assignment rows (``incident_assignments``, ``incident_group_assignments``) are
leaves: write or lock them only while holding their parent (or, for the
lifecycle checks, the resource row they point to). An UPDATE takes the same row
lock implicitly, so writing a stop's ``group_position`` counts as locking it.

A writer that touches several resources (transfer, Standard-Auftrag, the field
takeover) locks all of them up front through ``lock_resources`` before any
per-resource work; one that touches a single resource uses ``lock_resource``.

Two writers that keep this order can wait for each other but never deadlock.
Completing a stop used to lock the incident and then its Auftrag, while a stop
reorder locked the Auftrag and then its stops – a forced overlap deadlocked
(audit 2026-10, F08). Who follows it: completion and reopen
(``incidents.update_incident_status`` / ``update_incident``), stop attach,
detach and reorder and Auftrag delete (``groups``), release
(``assignments.unassign_resource``, ``group_assignments.unassign_group_resource``; a Reko
replacement and handover lock the incoming person with the crew, ``lock_incident_crew``),
assignment (``assign_resource``, ``assign_group_resource``, ``transfer_assignments``,
``auftrag_templates.instantiate_auto_templates``, and ``feld/melden.create_field_report``,
which locks the reporter's Auftrag before its insert key-shares the reporter) and the
resource lifecycle (archive / purge / personnel delete, which first locks the
incidents its ``ON DELETE SET NULL`` will write), the Ereignis delete (``lock_event_for_delete``:
the alarms its cascade unlinks, its Aufträge and cards, then the Ereignis row), and the board's Reko draft (its
first save ``reko.get_or_create_kp_reko_report`` and its PATCH take the card before
the report). A Reko person's order (``reko_assignment.reorder_reko_assignments``) takes
only step 3, the person's row – the lock every writer of their Reko rows already holds –
and writes the leaf rows under it. Assigning a special function
(``special_functions.create_special_function``) takes only step 3 too, so two assigns of
the same function cannot both insert. A merge locks only incidents, in id order
(``lock_incident`` / ``lock_pair`` below).

Two writers lock the Ereignis row before its cards: a standby sync batch and the bell poll. Against
the Ereignis delete (cards, then the Ereignis row) they are kept apart by the Ereignis delete gate
(``app/ereignis_gate.py``): taken shared by them, exclusively by the delete, before any row lock.
"""

import uuid
from collections.abc import Iterable
from typing import Literal, overload

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..ereignis_gate import gate_key
from ..models import (
    DiveraEmergency,
    Event,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    Material,
    Personnel,
    Vehicle,
)

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


async def lock_incident_numbering(db: AsyncSession, event_id: uuid.UUID) -> None:
    """Take, early, the per-Ereignis lock every incident INSERT takes anyway.

    The numbering trigger (``models.INCIDENT_NUMBER_TRIGGER_SQL``) holds it to the commit. A
    writer that must see every card created before its own – the duplicate lookup of an alarm
    attach – takes it before it looks, so a concurrent attach's card is committed and visible.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('incident_number:' || :event_id))"), {"event_id": str(event_id)}
    )


async def lock_incident(db: AsyncSession, incident_id: uuid.UUID) -> Incident | None:
    """Step 2 alone: row-lock an incident (deleted ones included) for a merge or its undo.

    Two merges into the same card both append to its «Notizen»; without the
    lock the second write would carry the first one's old text and drop its
    Nachtrag.
    """
    incident: Incident | None = await db.scalar(
        select(Incident).where(Incident.id == incident_id).with_for_update().execution_options(populate_existing=True)
    )
    return incident


async def lock_merge_target(db: AsyncSession, event_id: uuid.UUID, incident_id: uuid.UUID) -> Incident | None:
    """The card a new report merges into (merge-report, an alarm attach, a /feld Meldung), locked.

    The caller is about to INSERT the report, which takes the Ereignis' numbering lock (step 0b).
    Taken here first, so it never holds the card while it waits for that lock: a bulk attach holds
    the lock and flags (key-shares) the same card as a duplicate.
    """
    await lock_incident_numbering(db, event_id)
    return await lock_incident(db, incident_id)


async def lock_pair(
    db: AsyncSession, first_id: uuid.UUID, second_id: uuid.UUID
) -> tuple[Incident | None, Incident | None]:
    """Both incidents of a merge, locked in id order so two opposite merges cannot deadlock."""
    locked = {i: await lock_incident(db, i) for i in sorted({first_id, second_id})}
    return locked.get(first_id), locked.get(second_id)


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


async def lock_resources(
    db: AsyncSession, refs: Iterable[tuple[str, uuid.UUID]]
) -> dict[tuple[str, uuid.UUID], AssignableResource]:
    """Step 3 for several resources: lock them all, sorted by (resource_type, id).

    Call it before any per-resource work so two writers sharing resources take them
    in the same order. Returns the locked rows by ``(resource_type, id)``; ids that
    no longer exist are absent.
    """
    locked: dict[tuple[str, uuid.UUID], AssignableResource] = {}
    for resource_type, resource_id in sorted(set(refs)):
        resource = await lock_resource(db, resource_type, resource_id)
        if resource is not None:
            locked[(resource_type, resource_id)] = resource
    return locked


async def lock_incident_crew(
    db: AsyncSession, incident_ids: Iterable[uuid.UUID], extra_personnel_ids: Iterable[uuid.UUID] = ()
) -> dict[tuple[str, uuid.UUID], AssignableResource]:
    """Step 3 for a writer that holds a person and releases a crew row: lock the person
    (``extra_personnel_ids``) and everyone active on the incidents, sorted, in one go.

    Releasing a crew row can hand the Einsatzleiter role on, and stamping the new leader
    key-shares their person row (``incidents.leader_personnel_id``). A Reko replacement or
    handover that held the incoming person first and only then reached the successor took
    two person rows out of order – against an incident delete that locks both sorted, a
    deadlock. Call it while holding the incidents (step 2), so their crew stays put.
    """
    crew = await db.scalars(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id.in_(list(incident_ids)),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    return await lock_resources(db, [("personnel", person_id) for person_id in {*crew, *extra_personnel_ids}])


# Every incidents column that points at a person (all ON DELETE SET NULL): deleting
# the person writes these incident rows, so they are step 2 of that delete.
_INCIDENT_PERSONNEL_COLUMNS = (
    Incident.leader_personnel_id,
    Incident.reported_by_personnel_id,
    Incident.field_complete_reported_by,
    Incident.pickup_requested_by,
)


async def lock_personnel_for_delete(db: AsyncSession, personnel_id: uuid.UUID) -> Personnel | None:
    """Lock what deleting a person writes, in order: the incidents that point at them
    (with their Aufträge), then the person.

    The ``ON DELETE SET NULL`` on ``incidents`` row-locks those incidents during the
    DELETE – after the person, the reverse of the order – so an assignment holding
    such an incident and waiting for the person deadlocked with the delete. The
    references are read unlocked, so after the person is locked they are read again;
    a new one (a Meldung committed in between) rolls the savepoint back and starts
    over. Once the person is held, a new reference has to wait for its FK check.
    Other tables with ``SET NULL`` / ``CASCADE`` to personnel are leaves nobody holds
    while waiting for a person row.
    """
    referencing = select(Incident.id).where(or_(*(column == personnel_id for column in _INCIDENT_PERSONNEL_COLUMNS)))
    for _ in range(_MAX_MEMBERSHIP_ATTEMPTS):
        before = set((await db.scalars(referencing)).all())
        savepoint = await db.begin_nested()
        await lock_incidents_with_groups(db, before)
        person = await lock_resource(db, "personnel", personnel_id)
        if person is None or set((await db.scalars(referencing)).all()) <= before:
            await savepoint.commit()
            return person
        await savepoint.rollback()
    raise RuntimeError("references to the person kept changing while locking; giving up")


async def enter_ereignis_gate(db: AsyncSession, event_id: uuid.UUID) -> None:
    """The shared side of the Ereignis delete gate (``ereignis_gate``), held to the commit.

    The first lock of a transaction that may lock the Ereignis row before its cards – each write
    phase of the bell poll. Never call it while holding a row lock.
    """
    await db.execute(text("SELECT pg_advisory_xact_lock_shared(hashtext(:key))"), {"key": gate_key(event_id)})


async def lock_event_for_delete(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    """Lock what deleting an Ereignis writes, in order: its delete gate exclusively
    (``ereignis_gate``), the alarms linked to it or its cards (step 0), its numbering lock (0b),
    its Aufträge and cards (1, 2), then the Ereignis row (4). Call it before any row lock.

    The delete cascades to every card and unlinks the alarms (``ON DELETE SET NULL``) – after the
    Ereignis row, the reverse of the order. A status update that held a card and stamped the
    Ereignis, or an attach that held its alarm and locked a card, deadlocked with it. The
    numbering lock waits out an attach that is creating cards: it holds the Ereignis row's key
    share from its first card and may flag one of ours next. What the cascade reaches is read
    unlocked, so after the Ereignis row is locked it is read again; anything new (an attach or
    an Auftrag committed in between) rolls the savepoint back and starts over. Once the Ereignis
    row is held, a new row that points at it waits for its FK check.
    """
    cards = select(Incident.id).where(Incident.event_id == event_id)
    groups = select(IncidentGroup.id).where(IncidentGroup.event_id == event_id)
    alarms = select(DiveraEmergency.id).where(
        or_(DiveraEmergency.attached_to_event_id == event_id, DiveraEmergency.created_incident_id.in_(cards))
    )

    async def reached() -> tuple[set[uuid.UUID], set[uuid.UUID], set[uuid.UUID]]:
        return (
            set((await db.scalars(alarms)).all()),
            set((await db.scalars(groups)).all()),
            set((await db.scalars(cards)).all()),
        )

    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": gate_key(event_id)})
    for _ in range(_MAX_MEMBERSHIP_ATTEMPTS):
        seen_alarms, seen_groups, seen_cards = seen = await reached()
        savepoint = await db.begin_nested()
        await db.execute(
            select(DiveraEmergency.id)
            .where(DiveraEmergency.id.in_(seen_alarms))
            .order_by(DiveraEmergency.id)
            .with_for_update()
        )
        await lock_incident_numbering(db, event_id)
        await lock_incidents_with_groups(db, seen_cards, seen_groups)
        event: Event | None = await db.scalar(
            select(Event).where(Event.id == event_id).with_for_update().execution_options(populate_existing=True)
        )
        if event is None or all(now <= then for now, then in zip(await reached(), seen, strict=True)):
            await savepoint.commit()
            return event
        await savepoint.rollback()
    raise RuntimeError("what the Ereignis delete reaches kept changing while locking; giving up")
