"""Locks for writes: the Ereignis lock first, then the rows (docs/BACKEND.md «Row locks»).

Rule 1 – Ereignis locks first, sorted. A transaction that writes any row of an Ereignis (the
Ereignis, its cards, Aufträge, stops, crews, alarms, bell entries, field requests, Reko, journal …)
takes the lock of every Ereignis it will touch (``lock_ereignis``, an advisory lock per Ereignis,
``app/ereignis_lock.py``) before any other lock or write, all at once. Two writers of one Ereignis
then run one after the other, so the order in which they lock its rows cannot deadlock. Where it
comes from:

- a write request: the Ereignisse its path, query or link names (``lock_request_ereignisse``,
  mounted app-wide), unless the route is marked ``locks_its_own_ereignisse``;
- the row helpers below: the Ereignisse of what they lock, before the rows;
- a writer that finds its Ereignisse in rows collects them first: alarms
  (``crud.divera.lock_divera_emergencies``), a resource delete (``lock_resource_for_delete``),
  the Divera answers; the bell poll locks per Ereignis and phase;
- the standby sync: ``standby_sync.lock_ereignis`` on the asyncpg connection, in each op's
  transaction.

``tests/ereignis_lock_check.py`` fails a test request that writes or locks a row of an Ereignis
without its lock, or that takes the lock after another lock.

Rule 2 – rows of no Ereignis, after the Ereignis locks: pool alarms by id, then resource rows
(personnel / vehicles / materials) by (resource_type, id) through ``lock_resources``
(``lock_resource`` for one). A writer of several takes them all up front. Every assignment and
lifecycle writer (archive, purge, delete) takes the resource row, so nobody is assigned between
"is it in use?" and the archive.
"""

import uuid
from collections.abc import Callable, Iterable
from typing import Annotated, Literal, get_args, overload

from fastapi import Depends, Request
from sqlalchemy import Select, SQLColumnExpression, event, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, SessionTransaction

from ..database import get_db
from ..ereignis_lock import ereignis_lock_keys
from ..models import (
    Event,
    EventConflict,
    FieldRequest,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    Material,
    Notification,
    Personnel,
    PlannedAssignment,
    RekoReport,
    Vehicle,
)
from ..services.tokens import LinkKind, link_claims, validate_feld_token
from ..utils.error_codes import DomainError, ErrorCode

AssignableResource = Personnel | Vehicle | Material

_RESOURCE_MODELS: dict[str, type[AssignableResource]] = {
    "personnel": Personnel,
    "vehicle": Vehicle,
    "material": Material,
}

# An Ereignis created between our unlocked look and our lock makes a resource delete start
# over; each retry needs another Ereignis committed in that instant.
_MAX_LOCK_ATTEMPTS = 3


# The statements `lock_ereignis` runs, one per key. Module-level so the test check
# (`tests/ereignis_lock_check.py`) recognises it.
LOCK_EREIGNIS = text("SELECT pg_advisory_xact_lock(:key)")
TRY_LOCK_EREIGNIS = text("SELECT pg_try_advisory_xact_lock(:key)")
_HELD = "kp_ereignis_locks"  # session.info: the keys this transaction took


async def lock_ereignis(db: AsyncSession, *event_ids: uuid.UUID | None) -> None:
    """Rule 1: lock every Ereignis this transaction will write a row of – first, all at once.

    Call it before any other lock or write of the transaction, with every Ereignis the writer
    will touch (``None`` is skipped). Held to the commit; calling it again is free. A lock that
    sorts before one already held (``ereignis_lock.ereignis_lock_keys``) – a request that names
    a second Ereignis only in its body – is never waited for, out of order: it is only tried,
    and taken by another writer it refuses with ``DomainError`` ``ereignis_busy`` (409, try
    again). A savepoint rolled back releases the locks taken inside it.
    """
    held: dict[int, SessionTransaction] = db.info.setdefault(_HELD, {})
    for key in ereignis_lock_keys(event_ids):
        if key not in held and held and key < max(held):
            if not await db.scalar(TRY_LOCK_EREIGNIS, {"key": key}):
                raise DomainError(
                    ErrorCode.EREIGNIS_BUSY, "Ein anderes Ereignis wird gerade geändert. Bitte nochmals versuchen."
                )
        else:
            await db.execute(LOCK_EREIGNIS, {"key": key})
        held.setdefault(key, db.sync_session.get_nested_transaction() or db.sync_session.get_transaction())  # type: ignore[arg-type]


def is_within(transaction: SessionTransaction | None, ended: SessionTransaction) -> bool:
    """Whether ``transaction`` is ``ended`` or a savepoint inside it."""
    while transaction is not None:
        if transaction is ended:
            return True
        transaction = transaction.parent
    return False


@event.listens_for(Session, "after_transaction_end")
def _forget_ereignis_locks(session: Session, transaction: SessionTransaction) -> None:
    """The transaction ended: its Ereignis locks are gone with it."""
    if transaction.parent is None:
        session.info.pop(_HELD, None)


@event.listens_for(Session, "after_soft_rollback")
def _forget_rolled_back_ereignis_locks(session: Session, previous_transaction: SessionTransaction) -> None:
    """A savepoint rolled back released the locks taken inside it (Postgres does)."""
    held: dict[int, SessionTransaction] = session.info.get(_HELD, {})
    for key in [key for key, taken_in in held.items() if is_within(taken_in, previous_transaction)]:
        del held[key]


async def ereignisse_of_incidents(db: AsyncSession, incident_ids: Iterable[uuid.UUID | None]) -> set[uuid.UUID]:
    """The Ereignisse of these cards, for ``lock_ereignis`` (a card never changes Ereignis)."""
    ids = {incident_id for incident_id in incident_ids if incident_id is not None}
    return set(await db.scalars(select(Incident.event_id).where(Incident.id.in_(ids)))) if ids else set()


async def ereignisse_of_groups(db: AsyncSession, group_ids: Iterable[uuid.UUID | None]) -> set[uuid.UUID]:
    """The Ereignisse of these Aufträge, for ``lock_ereignis`` (an Auftrag never changes Ereignis)."""
    ids = {group_id for group_id in group_ids if group_id is not None}
    return set(await db.scalars(select(IncidentGroup.event_id).where(IncidentGroup.id.in_(ids)))) if ids else set()


def _event_of_incident(incident_id: SQLColumnExpression[uuid.UUID | None]) -> Select[tuple[uuid.UUID]]:
    """The Ereignis of a card, as a subquery of a lookup below."""
    return select(Incident.event_id).where(Incident.id == incident_id)


# The path and query parameters of a write request that name a row of an Ereignis, and how to find its
# Ereignis (``event_id`` names it).
_EREIGNIS_OF_PATH_PARAM: dict[
    str, Callable[[uuid.UUID], Select[tuple[uuid.UUID]] | Select[tuple[uuid.UUID | None]]]
] = {
    "incident_id": lambda row_id: select(Incident.event_id).where(Incident.id == row_id),
    "group_id": lambda row_id: select(IncidentGroup.event_id).where(IncidentGroup.id == row_id),
    "planned_id": lambda row_id: select(PlannedAssignment.event_id).where(PlannedAssignment.id == row_id),
    "conflict_id": lambda row_id: select(EventConflict.event_id).where(EventConflict.id == row_id),
    "request_id": lambda row_id: (
        select(Incident.event_id)
        .join(FieldRequest, FieldRequest.incident_id == Incident.id)
        .where(FieldRequest.id == row_id)
    ),
    "report_id": lambda row_id: (
        select(Incident.event_id).join(RekoReport, RekoReport.incident_id == Incident.id).where(RekoReport.id == row_id)
    ),
    "notification_id": lambda row_id: select(
        func.coalesce(Notification.event_id, _event_of_incident(Notification.incident_id).scalar_subquery())
    ).where(Notification.id == row_id),
}
_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_LOCKS_ITS_OWN: set[Callable[..., object]] = set()


def locks_its_own_ereignisse[F: Callable[..., object]](endpoint: F) -> F:
    """Leave this write route out of ``lock_request_ereignisse``; put it right under ``@router.…``.

    For a route that names a second Ereignis in its body and locks both itself, sorted (a
    transfer), and for one that writes no row of an Ereignis and must not hold its lock over
    slow work (an export, a photo upload)."""
    _LOCKS_ITS_OWN.add(endpoint)
    return endpoint


def _ereignis_of_token(token: str) -> set[uuid.UUID]:
    """The Ereignis a /feld link or a share link (check-in, alarm, viewer) names – if it is one."""
    if (feld := validate_feld_token(token)) is not None:
        return {feld.event_id}
    return {claims.event_id for kind in get_args(LinkKind) if (claims := link_claims(token, kind)) is not None}


async def lock_request_ereignisse(request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    """Rule 1 for the API, mounted app-wide: a write request takes the lock of every Ereignis
    its path or query names (``/incidents/{incident_id}/…``, ``?event_id=…``, the ``token`` of a
    /feld link or a share link) before the route runs. A route whose Ereignis comes from the body or from the
    rows it finds takes ``lock_ereignis`` itself. A parameter that names no row (a material
    group's ``group_id``) locks nothing."""
    route = request.scope.get("route")
    if request.method not in _WRITE_METHODS or getattr(route, "endpoint", None) in _LOCKS_ITS_OWN:
        return
    event_ids: set[uuid.UUID] = set()
    for name, value in [*request.path_params.items(), *request.query_params.items()]:
        lookup = _EREIGNIS_OF_PATH_PARAM.get(name)
        if name == "token":
            event_ids |= _ereignis_of_token(value)
        if lookup is None and name != "event_id":
            continue
        try:
            row_id = uuid.UUID(str(value))
        except ValueError:
            continue
        event_id = row_id if lookup is None else await db.scalar(lookup(row_id))
        if event_id is not None:
            event_ids.add(event_id)
    await lock_ereignis(db, *event_ids)


async def lock_groups(db: AsyncSession, group_ids: Iterable[uuid.UUID | None]) -> None:
    """Row-lock Aufträge in ascending id order (deleted ones included, ``None`` skipped), after
    their Ereignisse (rule 1)."""
    ids = sorted({group_id for group_id in group_ids if group_id is not None})
    ereignisse = await ereignisse_of_groups(db, ids)
    await lock_ereignis(db, *ereignisse)
    for group_id in ids:
        # Not one that appeared meanwhile in an Ereignis this transaction does not hold.
        await db.execute(
            select(IncidentGroup.id)
            .where(IncidentGroup.id == group_id, IncidentGroup.event_id.in_(ereignisse))
            .with_for_update()
        )


async def lock_incidents_with_groups(
    db: AsyncSession,
    incident_ids: Iterable[uuid.UUID],
    extra_group_ids: Iterable[uuid.UUID | None] = (),
) -> dict[uuid.UUID, Incident]:
    """Lock the cards' Ereignisse (rule 1), then their Aufträge plus ``extra_group_ids``, then the
    cards – the first lock of most writers of a card.

    Under the Ereignis lock no other writer moves a stop, so the Aufträge read here stay the
    cards' own. Returns the locked cards by id (refreshed, ``populate_existing``); unknown ids
    are absent.
    """
    ids = sorted(set(incident_ids))
    extra = {group_id for group_id in extra_group_ids if group_id is not None}
    ereignisse = await ereignisse_of_incidents(db, ids)
    await lock_ereignis(db, *ereignisse, *await ereignisse_of_groups(db, extra))
    groups = await db.scalars(select(Incident.group_id).where(Incident.id.in_(ids)))
    await lock_groups(db, {*extra, *groups})
    locked: dict[uuid.UUID, Incident] = {}
    for incident_id in ids:
        # A card that appeared after the look (a synced INSERT) is in no Ereignis held: absent.
        incident = await db.scalar(
            select(Incident)
            .where(Incident.id == incident_id, Incident.event_id.in_(ereignisse))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if incident is not None:
            locked[incident_id] = incident
    return locked


async def lock_incident_with_group(
    db: AsyncSession,
    incident_id: uuid.UUID,
    extra_group_ids: Iterable[uuid.UUID | None] = (),
) -> Incident | None:
    """``lock_incidents_with_groups`` for one incident: its Auftrag (if any) first, then it."""
    return (await lock_incidents_with_groups(db, [incident_id], extra_group_ids)).get(incident_id)


async def lock_incident(db: AsyncSession, incident_id: uuid.UUID) -> Incident | None:
    """Row-lock an incident (deleted ones included) for a merge or its undo, after its Ereignis.

    Two merges into the same card both append to its «Notizen»; without the
    lock the second write would carry the first one's old text and drop its
    Nachtrag.
    """
    ereignisse = await ereignisse_of_incidents(db, [incident_id])
    await lock_ereignis(db, *ereignisse)
    incident: Incident | None = await db.scalar(
        select(Incident)
        .where(Incident.id == incident_id, Incident.event_id.in_(ereignisse))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return incident


async def lock_pair(
    db: AsyncSession, first_id: uuid.UUID, second_id: uuid.UUID
) -> tuple[Incident | None, Incident | None]:
    """Both incidents of a merge, after their Ereignisse, locked in id order."""
    await lock_ereignis(db, *await ereignisse_of_incidents(db, [first_id, second_id]))
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
    """Rule 2: row-lock a personnel / vehicle / material row (fresh from the database).

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
    """Rule 2 for several resources: lock them all, sorted by (resource_type, id).

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
    """Rule 2 for a writer that holds a person and releases a crew row: lock the person
    (``extra_personnel_ids``) and everyone active on the incidents, sorted, in one go.

    Releasing a crew row can hand the Einsatzleiter role on, and stamping the new leader
    key-shares their person row (``incidents.leader_personnel_id``). A Reko replacement or
    handover that held the incoming person first and only then reached the successor took
    two person rows out of order – against an incident delete that locks both sorted, a
    deadlock. Call it while holding the incidents, so their crew stays put.
    """
    crew = await db.scalars(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id.in_(list(incident_ids)),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    return await lock_resources(db, [("personnel", person_id) for person_id in {*crew, *extra_personnel_ids}])


@overload
async def lock_resource_for_delete(
    db: AsyncSession, resource_type: Literal["personnel"], resource_id: uuid.UUID
) -> Personnel | None: ...
@overload
async def lock_resource_for_delete(
    db: AsyncSession, resource_type: Literal["vehicle"], resource_id: uuid.UUID
) -> Vehicle | None: ...
@overload
async def lock_resource_for_delete(
    db: AsyncSession, resource_type: Literal["material"], resource_id: uuid.UUID
) -> Material | None: ...
async def lock_resource_for_delete(
    db: AsyncSession, resource_type: str, resource_id: uuid.UUID
) -> AssignableResource | None:
    """Lock what deleting or purging a resource writes: every Ereignis, then the resource row.

    Its rows may sit in any Ereignis – crew and Auftrag history, Fahrer, attendance, device
    claims, the ``ON DELETE SET NULL`` references of cards and reports – so every Ereignis is
    locked (rule 1), sorted. An Ereignis created between the look and the lock rolls the
    savepoint back – releasing its locks – and starts over. A rare, deliberate admin action:
    waiting for every board's writes is fine.
    """
    every = select(Event.id)
    for _ in range(_MAX_LOCK_ATTEMPTS):
        before = set(await db.scalars(every))
        savepoint = await db.begin_nested()
        await lock_ereignis(db, *before)
        resource = await lock_resource(db, resource_type, resource_id)
        if set(await db.scalars(every)) <= before:
            await savepoint.commit()
            return resource
        await savepoint.rollback()
    raise RuntimeError("Ereignisse kept appearing while locking; giving up")
