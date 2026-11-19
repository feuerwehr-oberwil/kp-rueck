"""Personnel check-in CRUD operations."""

import uuid
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import (
    EventAttendance,
    Personnel,
    User,
)
from ..services.audit import log_action
from .active_resources import active_resource_ids


def _response(
    person: Personnel, attendance: EventAttendance | None, *, is_assigned: bool
) -> schemas.PersonnelCheckInResponse:
    """One person's attendance at one Ereignis, as every route here answers it."""
    return schemas.PersonnelCheckInResponse(
        id=person.id,
        name=person.name,
        kennung=person.kennung,
        role=person.role,
        status=person.status,
        tags=person.tags,
        checked_in=bool(attendance is not None and attendance.checked_in),
        checked_in_at=attendance.checked_in_at if attendance else None,
        checked_out_at=attendance.checked_out_at if attendance else None,
        planned_from=attendance.planned_from if attendance else None,
        planned_until=attendance.planned_until if attendance else None,
        is_assigned=is_assigned,
    )


async def _is_personnel_assigned(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID) -> bool:
    deployed = active_resource_ids("personnel", event_id=event_id).subquery()
    return bool(
        await db.scalar(select(select(deployed.c.resource_id).where(deployed.c.resource_id == personnel_id).exists()))
    )


async def get_available_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    include_checked_out: bool = True,
    include_unavailable: bool = False,
) -> list[schemas.PersonnelCheckInResponse]:
    """
    Get personnel eligible for check-in with event-specific attendance status.

    Args:
        db: Database session
        event_id: Event ID to check attendance for
        include_checked_out: If True, returns all available personnel
                           If False, only returns checked-in personnel
        include_unavailable: If True, unavailable personnel are listed too. The phone
                           never sees them (check-in would be refused); the board's
                           roll-call shows them greyed out with their reason, so the
                           operator does not look for a name that is simply not offered.

    Returns:
        List of personnel with event-specific check-in status
    """
    # Get all available personnel
    # The roster and this Ereignis's own guests (`Personnel.in_scope`).
    query = select(Personnel).where(Personnel.in_scope(event_id)).order_by(Personnel.name.asc())
    if not include_unavailable:
        query = query.where(Personnel.status != "unavailable")

    result = await db.execute(query)
    personnel_list = list(result.scalars().all())

    # Get event-specific attendance records
    attendance_query = select(EventAttendance).where(EventAttendance.event_id == event_id)
    attendance_result = await db.execute(attendance_query)
    attendance_map = {att.personnel_id: att for att in attendance_result.scalars().all()}

    assigned_personnel_ids = set(await db.scalars(active_resource_ids("personnel", event_id=event_id)))

    # Build response with event-specific check-in status
    response_list = []
    for person in personnel_list:
        attendance = attendance_map.get(person.id)
        checked_in = attendance.checked_in if attendance else False
        is_assigned = person.id in assigned_personnel_ids

        # Filter by checked-in status if requested
        if not include_checked_out and not checked_in:
            continue

        response_list.append(_response(person, attendance, is_assigned=is_assigned))

    return response_list


async def check_in_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
) -> schemas.PersonnelCheckInResponse | None:
    """
    Check in a person for a specific event (mark as present on-site).

    Args:
        db: Database session
        event_id: Event ID to check in for
        personnel_id: ID of personnel to check in
        current_user: Optional user performing the action (for audit log)
        request: Optional request object (for audit log)

    Returns:
        Updated personnel with event-specific check-in status, or None if not found (a
        guest of another Ereignis counts as not found)

    Raises:
        ValueError: If personnel is unavailable
    """
    # Get personnel record
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    person = result.scalar_one_or_none()

    # A guest of another Ereignis is nobody this one lists (`Personnel.in_scope`).
    if not person or person.guest_event_id not in (None, event_id):
        return None

    # Can't check in if unavailable
    if person.status == "unavailable":
        raise ValueError("Cannot check in unavailable personnel")

    is_assigned = await _is_personnel_assigned(db, event_id, personnel_id)

    # Get or create event attendance record
    attendance_result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id, EventAttendance.personnel_id == personnel_id
        )
    )
    attendance = attendance_result.scalar_one_or_none()

    now = datetime.now(UTC)

    if attendance:
        # Already checked in for this event
        if attendance.checked_in:
            return _response(person, attendance, is_assigned=is_assigned)
        # Coming BACK after a departure starts a new stint: the old «kommt um» / «geht um»
        # were about the one that ended, and a spent «geht um» would ring the bell again.
        # A first arrival keeps both – «geht um» is often said before somebody is in.
        if attendance.checked_out_at is not None:
            attendance.planned_from = None
            attendance.planned_until = None
        # Update existing record
        attendance.checked_in = True
        attendance.checked_in_at = now
        attendance.checked_in_by_user_id = current_user.id if current_user else None
        attendance.updated_at = now
    else:
        # Create new attendance record
        attendance = EventAttendance(
            event_id=event_id,
            personnel_id=personnel_id,
            checked_in=True,
            checked_in_at=now,
            checked_in_by_user_id=current_user.id if current_user else None,
        )
        db.add(attendance)

    # Log action
    if current_user and request:
        await log_action(
            db=db,
            action_type="check_in",
            resource_type="personnel",
            resource_id=person.id,
            user=current_user,
            changes={"name": person.name, "event_id": str(event_id), "checked_in": True},
            request=request,
        )

    await db.flush()
    await db.refresh(attendance)

    return _response(person, attendance, is_assigned=is_assigned)


async def check_out_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
    allow_assigned: bool = False,
) -> schemas.PersonnelCheckInResponse | None:
    """
    Check out a person from a specific event (mark as left site).

    Args:
        db: Database session
        event_id: Event ID to check out from
        personnel_id: ID of personnel to check out
        current_user: Optional user performing the action (for audit log)
        request: Optional request object (for audit log)
        allow_assigned: Check out even while the person is assigned to an incident.
                      The phone says no (it cannot release the assignment either, so a
                      block is the only honest answer there); the board warns and
                      proceeds, because it is the surface that *can* release it and a
                      hard block would force a surface change to send somebody home.
                      Either way the assignment is left intact — never released silently.

    Returns:
        Updated personnel with event-specific check-in status, or None if not found (a
        guest of another Ereignis counts as not found)
    """
    # Get personnel record
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id).with_for_update())
    person = result.scalar_one_or_none()

    # A guest of another Ereignis is nobody this one lists (`Personnel.in_scope`).
    if not person or person.guest_event_id not in (None, event_id):
        return None

    is_assigned = await _is_personnel_assigned(db, event_id, personnel_id)

    # Prevent checkout if assigned to an incident
    if is_assigned and not allow_assigned:
        raise ValueError("Cannot check out personnel who are assigned to an incident")

    # Get event attendance record
    attendance_result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id, EventAttendance.personnel_id == personnel_id
        )
    )
    attendance = attendance_result.scalar_one_or_none()

    now = datetime.now(UTC)

    if attendance:
        # Already checked out for this event
        if not attendance.checked_in and attendance.checked_out_at is not None:
            return _response(person, attendance, is_assigned=is_assigned)
        # Update existing record
        attendance.checked_in = False
        attendance.checked_out_at = now
        attendance.checked_out_by_user_id = current_user.id if current_user else None
        attendance.updated_at = now
    else:
        # Create new attendance record marked as checked out
        # (This handles the case where someone was never checked in but we want to explicitly mark them as out)
        attendance = EventAttendance(
            event_id=event_id,
            personnel_id=personnel_id,
            checked_in=False,
            checked_out_at=now,
            checked_out_by_user_id=current_user.id if current_user else None,
        )
        db.add(attendance)

    # Log action
    if current_user and request:
        await log_action(
            db=db,
            action_type="check_out",
            resource_type="personnel",
            resource_id=person.id,
            user=current_user,
            changes={"name": person.name, "event_id": str(event_id), "checked_in": False},
            request=request,
        )

    await db.flush()
    await db.refresh(attendance)

    return _response(person, attendance, is_assigned=is_assigned)


async def clear_personnel_attendance(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
) -> schemas.PersonnelCheckInResponse | None:
    """Take a person back to "nicht anwesend" — as if the row had never been written.

    The third step of the board's roll-call cycle (anwesend → gegangen → nicht
    anwesend). Until now the cycle wrapped from *gegangen* straight back to
    *anwesend*, so a mis-tick could be corrected to "went home" but never to "was
    never here" — and those are not the same fact. The Ereignis report reads the
    difference, and check-out even *creates* a row for somebody who never came, so
    without this there was no way back out of one.

    Deletes the attendance row rather than blanking its timestamps: "nicht
    anwesend" is the absence of a record. A plan («kommt um», `set_attendance_plan`)
    goes with it – the correction is "this person is not part of tonight".

    Unlike check-out this does not consult the assignment: an assignment is a
    reason to warn before sending somebody home, not a reason to refuse undoing a
    typo. The caller (the board) already warns on the way *out*.

    None if not found – a guest of another Ereignis counts as not found, as in
    check-in and check-out.
    """
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    person = result.scalar_one_or_none()
    # A guest of another Ereignis is nobody this one lists (`Personnel.in_scope`).
    if not person or person.guest_event_id not in (None, event_id):
        return None

    attendance_result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id, EventAttendance.personnel_id == personnel_id
        )
    )
    attendance = attendance_result.scalar_one_or_none()

    if attendance is not None:
        await db.delete(attendance)
        if current_user and request:
            await log_action(
                db=db,
                action_type="check_in_cleared",
                resource_type="personnel",
                resource_id=person.id,
                user=current_user,
                changes={"name": person.name, "event_id": str(event_id)},
                request=request,
            )
        await db.flush()

    return _response(person, None, is_assigned=await _is_personnel_assigned(db, event_id, personnel_id))


async def set_attendance_plan(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    plan: schemas.AttendancePlanUpdate,
    current_user: User | None = None,
    request: Request | None = None,
) -> schemas.PersonnelCheckInResponse | None:
    """Set or clear «kommt um» / «geht um» for one person at one Ereignis.

    Only the fields the client sent change (`plan.model_fields_set`); an explicit null
    clears one. Somebody who has no row yet gets one for the plan alone – checked_in
    False and both stamps NULL, which reads «nicht anwesend» everywhere. The plan never
    touches the record: arriving and leaving stay the check-in/-out (KP Front's rule:
    the plan says what should happen, the attendance what did).

    Returns None when the person is not listed at this Ereignis (unknown, or a guest of
    another one). Raises ValueError for an unavailable person, like check-in, and when
    the result would end before it starts.
    """
    person = await db.scalar(select(Personnel).where(Personnel.id == personnel_id))
    if not person or person.guest_event_id not in (None, event_id):
        return None
    if person.status == "unavailable":
        raise ValueError("Cannot plan unavailable personnel")

    attendance = await db.scalar(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id, EventAttendance.personnel_id == personnel_id
        )
    )
    if attendance is None:
        attendance = EventAttendance(event_id=event_id, personnel_id=personnel_id, checked_in=False)
        db.add(attendance)

    sent = plan.model_fields_set
    planned_from = plan.planned_from if "planned_from" in sent else attendance.planned_from
    planned_until = plan.planned_until if "planned_until" in sent else attendance.planned_until
    if planned_from and planned_until and planned_until <= planned_from:
        raise ValueError("planned_until must be after planned_from")
    attendance.planned_from = planned_from
    attendance.planned_until = planned_until

    if current_user and request:
        await log_action(
            db=db,
            action_type="attendance_plan",
            resource_type="personnel",
            resource_id=person.id,
            user=current_user,
            changes={
                "name": person.name,
                "event_id": str(event_id),
                "planned_from": planned_from.isoformat() if planned_from else None,
                "planned_until": planned_until.isoformat() if planned_until else None,
            },
            request=request,
        )

    await db.flush()
    await db.refresh(attendance)
    return _response(person, attendance, is_assigned=await _is_personnel_assigned(db, event_id, personnel_id))


async def check_out_all_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    current_user: User,
    request: Request | None = None,
    at: datetime | None = None,
) -> list[schemas.PersonnelCheckInResponse]:
    """
    Send everyone who is still present at this Ereignis home ("Alle abmelden").

    The end of an Ereignis is the moment thirty-four people want to leave at once, and
    the alternative to this is thirty-four clicks. It is deliberately narrow:

    - it only touches rows that are **currently present**; somebody who already left at
      20:40 keeps their own ``checked_out_at`` rather than having it rewritten to now,
    - it never creates a row, so a person who never came does not acquire a departure,
    - it never touches another Ereignis, and
    - it never releases an assignment (plan 26 decision 16).

    A loop rather than one bulk ``UPDATE``, because every person must end up with their
    own audit entry — a single row saying "someone checked out 34 people" is not a
    roll-call. All of it lands in the caller's one commit, so the Ereignis never ends half-closed.

    ``at``: the departure clock to stamp — the archive flow passes the event's
    ``archived_at`` so «Abmeldezeit = Ereignisende» holds to the second.

    Returns:
        The people who were checked out, in name order — empty when nobody was present.
    """
    now = at or datetime.now(UTC)

    result = await db.execute(
        select(EventAttendance, Personnel)
        .join(Personnel, EventAttendance.personnel_id == Personnel.id)
        .where(EventAttendance.event_id == event_id, EventAttendance.checked_in)
        .order_by(Personnel.name.asc())
    )
    rows = list(result.all())

    checked_out: list[schemas.PersonnelCheckInResponse] = []
    for attendance, person in rows:
        attendance.checked_in = False
        attendance.checked_out_at = now
        attendance.checked_out_by_user_id = current_user.id
        attendance.updated_at = now

        if request is not None:
            await log_action(
                db=db,
                action_type="check_out",
                resource_type="personnel",
                resource_id=person.id,
                user=current_user,
                changes={
                    "name": person.name,
                    "event_id": str(event_id),
                    "checked_in": False,
                    "bulk": True,
                },
                request=request,
            )

        checked_out.append(
            _response(person, attendance, is_assigned=await _is_personnel_assigned(db, event_id, person.id))
        )

    await db.flush()
    return checked_out
