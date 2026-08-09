"""CRUD for the `/feld` field surface (plan 25).

Two things live here, and the second one is the load-bearing part:

1. The read queries behind the person picker and "meine Einsatzstellen".
2. **Step 2 of the `/feld` authorization.** The event token (step 1) only says
   *which Ereignis*; it never says *who*. Visibility is "only mine" (decision 4)
   and it is enforced here, server-side, never in the UI: a person sees exactly
   the incidents they are — or **were** — assigned to. Released rows count on
   purpose, because a crew files the rapport *after* being released; requiring
   ``unassigned_at IS NULL`` would lock out exactly the moment the form is for.

Every later phase of plan 25 mounts on ``person_has_event_assignment`` /
``get_authorized_incident``; adding an endpoint without one of them is the hole
this module exists to prevent.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, IncidentAssignment, Notification, Personnel, SchadenplatzReport, User
from ..services.audit import log_action
from ..services.incident_leader import effective_leader_id
from ..services.notification_service import create_field_notification
from ..websocket_manager import broadcast_incident_update

# ============================================
# Authorization — step 2
# ============================================


async def person_has_event_assignment(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> bool:
    """Does this person have ANY assignment on an incident in this event?

    The incident-less form of step 2, for the endpoints that are scoped to a
    person rather than to one Schadenplatz. Active or released — see the module
    docstring.
    """
    stmt = (
        select(IncidentAssignment.id)
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.first() is not None


async def get_authorized_incident(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    incident_id: uuid.UUID,
) -> Incident | None:
    """The incident, if this person may see it through a `/feld` token.

    Returns None when the incident is not in this event, is deleted, or the
    (personnel_id, incident_id) pair has no row in ``incident_assignments``.
    The caller turns None into a 403 — never into an empty 200, which would
    leak that the incident exists.
    """
    stmt = (
        select(Incident)
        .join(
            IncidentAssignment,
            IncidentAssignment.incident_id == Incident.id,
        )
        .where(
            Incident.id == incident_id,
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalars().first()


# ============================================
# Reads
# ============================================


async def _event_incidents(db: AsyncSession, event_id: uuid.UUID) -> dict[uuid.UUID, Incident]:
    """Every live incident of this event, keyed by id."""
    result = await db.execute(
        select(Incident).where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    return {incident.id: incident for incident in result.scalars().all()}


async def _rapport_states(
    db: AsyncSession,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, SchadenplatzReport]:
    """The Schadenplatz-Rapport row per incident, where one exists."""
    if not incident_ids:
        return {}
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id.in_(incident_ids)))
    return {report.incident_id: report for report in result.scalars().all()}


def _rapport_state(report: SchadenplatzReport | None) -> str:
    """'none' | 'draft' | 'submitted' for one incident."""
    if report is None:
        return "none"
    return "draft" if report.is_draft else "submitted"


async def get_incident_leaders(
    db: AsyncSession,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, tuple[uuid.UUID, str]]:
    """The Einsatzleiter per incident: {incident_id: (personnel_id, name)}.

    ``is_leader`` belongs to ONE assignment, so this is keyed per incident and
    must never be flattened across them.

    The active flag first, ``Incident.leader_personnel_id`` behind it
    (``services.incident_leader``). The fallback is the whole reason this page
    works: completing an incident releases the crew and clears the flag from
    every row, so *every* finished Schadenplatz — exactly the ones a crew opens
    to file its rapport — would otherwise read "kein EL erfasst".

    Incidents nobody ever led stay absent from the mapping; the caller renders
    "kein EL erfasst" for them, never a blank line (decision 22).
    """
    if not incident_ids:
        return {}

    active_result = await db.execute(
        select(IncidentAssignment.incident_id, IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.unassigned_at.is_(None),
            IncidentAssignment.is_leader.is_(True),
        )
    )
    active: dict[uuid.UUID, set[uuid.UUID]] = {}
    for incident_id, personnel_id in active_result.all():
        active.setdefault(incident_id, set()).add(personnel_id)

    incidents_result = await db.execute(select(Incident).where(Incident.id.in_(incident_ids)))
    resolved: dict[uuid.UUID, uuid.UUID] = {}
    for incident in incidents_result.scalars().all():
        leader_id = effective_leader_id(incident, active.get(incident.id, set()))
        if leader_id is not None:
            resolved[incident.id] = leader_id

    if not resolved:
        return {}

    names_result = await db.execute(
        select(Personnel.id, Personnel.name).where(Personnel.id.in_(set(resolved.values())))
    )
    names = {row[0]: row[1] for row in names_result.all()}

    return {
        incident_id: (personnel_id, names[personnel_id])
        for incident_id, personnel_id in resolved.items()
        if personnel_id in names
    }


async def get_feld_personnel_for_event(
    db: AsyncSession,
    event_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """The `/feld` person picker: everyone with an assignment in this event.

    Deliberately NOT the roster. Someone who was never assigned has nothing to
    file, and putting them in the list would hand them an empty page instead of
    the sentence that explains why (§5.2).
    """
    incidents = await _event_incidents(db, event_id)
    incident_ids = list(incidents)
    if not incident_ids:
        return []

    assignments_result = await db.execute(
        select(
            IncidentAssignment.resource_id,
            IncidentAssignment.incident_id,
            IncidentAssignment.unassigned_at,
        ).where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
        )
    )
    ever: dict[uuid.UUID, set[uuid.UUID]] = {}
    active: dict[uuid.UUID, set[uuid.UUID]] = {}
    for resource_id, incident_id, unassigned_at in assignments_result.all():
        ever.setdefault(resource_id, set()).add(incident_id)
        if unassigned_at is None:
            active.setdefault(resource_id, set()).add(incident_id)

    if not ever:
        return []

    personnel_result = await db.execute(select(Personnel).where(Personnel.id.in_(list(ever))))
    personnel = list(personnel_result.scalars().all())

    reports = await _rapport_states(db, incident_ids)
    submitted = {incident_id for incident_id, report in reports.items() if not report.is_draft}

    rows = [
        {
            "personnel_id": person.id,
            "name": person.name,
            "role": person.role,
            "incident_count": len(ever[person.id]),
            "open_count": len(active.get(person.id, set())),
            "missing_rapport_count": len([i for i in ever[person.id] if i not in submitted]),
        }
        for person in personnel
    ]
    # Alphabetical: this is a picker people scan for their own name, not a
    # workload ranking.
    rows.sort(key=lambda row: str(row["name"]).casefold())
    return rows


async def get_feld_assignments_for_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """ "Meine Einsatzstellen" — every incident this person is or was on.

    Released assignments stay in the list (decision 4 / §2): the rapport is
    filed after the crew leaves, so dropping them would hide exactly the rows
    the page exists for.
    """
    incidents = await _event_incidents(db, event_id)
    incident_ids = list(incidents)
    if not incident_ids:
        return []

    assignments_result = await db.execute(
        select(
            IncidentAssignment.incident_id,
            IncidentAssignment.unassigned_at,
        ).where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
        )
    )
    mine: dict[uuid.UUID, bool] = {}
    for incident_id, unassigned_at in assignments_result.all():
        # One person can hold several rows on one incident (assigned, released,
        # re-assigned). Active wins.
        mine[incident_id] = mine.get(incident_id, False) or unassigned_at is None

    if not mine:
        return []

    mine_ids = list(mine)
    reports = await _rapport_states(db, mine_ids)
    leaders = await get_incident_leaders(db, mine_ids)

    rows: list[dict[str, Any]] = []
    for incident_id, is_active in mine.items():
        incident = incidents[incident_id]
        report = reports.get(incident_id)
        leader = leaders.get(incident_id)
        rows.append(
            {
                "incident_id": incident.id,
                "incident_title": incident.title or incident.location_address or "Unbekannt",
                "incident_type": incident.type,
                "incident_status": incident.status,
                "location_address": incident.location_address,
                "location_lat": str(incident.location_lat) if incident.location_lat is not None else None,
                "location_lng": str(incident.location_lng) if incident.location_lng is not None else None,
                "is_active_assignment": is_active,
                "rapport_state": _rapport_state(report),
                "arrived_at": report.arrived_at if report else None,
                "field_complete_reported_at": incident.field_complete_reported_at,
                # The crew must see an open pickup when it comes back to the
                # page, not only in the response of the tap that set it.
                "pickup_needed": incident.pickup_needed,
                "pickup_note": incident.pickup_note,
                "pickup_requested_at": incident.pickup_requested_at,
                "leader_personnel_id": leader[0] if leader else None,
                "leader_name": leader[1] if leader else None,
                # Sort-only, stripped below.
                "_position": incident.position,
                "_created_at": incident.created_at,
            }
        )

    # Same priority order the operator arranged on the board: still-assigned
    # first, then the ones still missing a rapport, then the kanban order.
    rows.sort(
        key=lambda row: (
            not row["is_active_assignment"],
            row["rapport_state"] == "submitted",
            row["_position"],
            row["_created_at"],
        )
    )
    for row in rows:
        row.pop("_position", None)
        row.pop("_created_at", None)

    return rows


# ============================================
# Field reports — the writes (phase 1)
# ============================================
#
# Everything below is called from BOTH doors: token-gated on `/api/feld/...` for
# the crew, editor-gated on `/api/incidents/{id}/field-report` for the KP taking
# the same thing over the radio (decision 28). Two thin routers over one module —
# a second implementation is how the KP path silently loses a field.
#
# None of it touches ``incident_assignments``. That boundary (decisions 17/18) is
# what keeps this surface out of the board's conflict model, and it is asserted
# in the tests rather than left to review.


@dataclass(frozen=True)
class FieldActor:
    """Who is filing — and **exactly one side of this is ever populated**.

    Provenance is never faked (decision 28). A `/feld` write carries the
    ``Personnel`` row and stamps the ``*_by`` personnel FKs; a KP write carries
    the ``User``, leaves those columns NULL, and puts the user in the audit-log
    entry instead. A ``User`` is never guessed to be a ``Personnel`` — they are
    different people often enough that a wrong attribution on a billing document
    is worse than no attribution.
    """

    personnel_id: uuid.UUID | None = None
    personnel_name: str | None = None
    user: User | None = None

    @property
    def is_field(self) -> bool:
        """True for a crew filing on `/feld`, False for a KP radio entry."""
        return self.personnel_id is not None

    @property
    def suffix(self) -> str:
        """The " · von wem" tail of every notification this module writes."""
        if self.is_field:
            return f" · {self.personnel_name}" if self.personnel_name else " · vom Feld"
        return " · im KP erfasst"


def _location(incident: Incident) -> str:
    """How a Schadenplatz is named in a notification: address first."""
    return incident.location_address or incident.title or "Unbekannt"


async def _get_or_create_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    actor: FieldActor,
) -> SchadenplatzReport:
    """The one Schadenplatz-Rapport row for this incident, created if absent.

    ``UNIQUE(incident_id)`` (decision 3): whoever files first creates it, anyone
    else assigned amends the same row. Created with ``is_draft=True`` — a row
    appears the moment someone taps "Angekommen", long before any form exists,
    so its default state must be "not yet filed".
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident_id))
    report = result.scalar_one_or_none()
    if report is not None:
        return report

    report = SchadenplatzReport(
        incident_id=incident_id,
        is_draft=True,
        created_by_personnel_id=actor.personnel_id,
        created_by_user_id=actor.user.id if actor.user and not actor.is_field else None,
    )
    db.add(report)
    await db.flush()
    return report


def _stamp_updated_by(report: SchadenplatzReport, actor: FieldActor) -> None:
    """Record who last touched the report — one side only, never both."""
    if actor.is_field:
        report.updated_by_personnel_id = actor.personnel_id
        report.updated_by_user_id = None
    else:
        report.updated_by_personnel_id = None
        report.updated_by_user_id = actor.user.id if actor.user else None


async def _broadcast(incident: Incident) -> None:
    """Push the field state to the board without waiting for the 5 s poll.

    Deliberately ``broadcast_incident_update`` only: `/feld` never writes an
    assignment, so ``broadcast_assignment_update`` has no business here.
    """
    await broadcast_incident_update(
        {
            "id": str(incident.id),
            "field_complete_reported_at": (
                incident.field_complete_reported_at.isoformat() if incident.field_complete_reported_at else None
            ),
            "pickup_needed": incident.pickup_needed,
        },
        "update",
    )


async def record_arrival(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    at: datetime | None,
    only_if_unset: bool = False,
    request: Request | None = None,
) -> bool:
    """ "Angekommen" — set or clear the arrival on the Schadenplatz-Rapport row.

    ``only_if_unset`` is what the field tap passes: a second tap does nothing,
    because a crew re-opening the page and hitting the big button again must not
    move a timestamp the KP has already acted on. The KP path leaves it False so
    an operator can correct or clear the time (``at=None``).

    Returns whether anything changed — the caller only notifies when it did.

    Note the arrival's own provenance is read back off the report's
    ``created_by_*`` pair (``field_report_state``). In phase 1 that is exact: the
    arrival is the only thing that creates the row. Phase 2 lets the KP create a
    rapport first, at which point the arrival needs its own pair of columns.
    """
    report = await _get_or_create_report(db, incident.id, actor)
    if only_if_unset and report.arrived_at is not None:
        return False
    if report.arrived_at == at:
        return False

    report.arrived_at = at
    _stamp_updated_by(report, actor)
    # A brand-new row created BY the arrival carries the arrival's author, so the
    # "vom Feld / im KP erfasst" line stays honest for the row it describes.
    if at is not None and report.created_by_personnel_id is None and report.created_by_user_id is None:
        report.created_by_personnel_id = actor.personnel_id
        report.created_by_user_id = actor.user.id if actor.user and not actor.is_field else None

    await log_action(
        db=db,
        action_type="field_arrived" if at is not None else "field_arrived_cleared",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={"arrived_at": at.isoformat() if at else None, "source": "feld" if actor.is_field else "kp"},
        request=request,
    )
    await db.commit()
    await db.refresh(report)

    if at is not None and incident.event_id:
        await create_field_notification(
            db,
            notification_type="field_arrived",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=f"Angekommen: {_location(incident)}{actor.suffix}",
        )
    await _broadcast(incident)
    return True


async def record_field_complete(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    at: datetime | None,
    only_if_unset: bool = False,
    request: Request | None = None,
) -> bool:
    """ "Einsatz beendet" — the field reports it, the operator decides to close.

    **Does not change ``Incident.status``**, which is the rule the column's own
    comment states: a Schadenplatz is finished when the KP says so, and a crew
    that has packed up is not the same fact as a card in `complete`. This is the
    first real writer of ``field_complete_reported_at`` — until now only the
    training simulator could set it.

    ``field_complete_reported_by`` stays NULL for a KP write (decision 28); the
    audit-log entry carries the user instead.
    """
    if only_if_unset and incident.field_complete_reported_at is not None:
        return False
    if incident.field_complete_reported_at == at and (
        at is None or incident.field_complete_reported_by == actor.personnel_id
    ):
        return False

    incident.field_complete_reported_at = at
    incident.field_complete_reported_by = actor.personnel_id if at is not None else None

    await log_action(
        db=db,
        action_type="field_complete" if at is not None else "field_complete_cleared",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "field_complete_reported_at": at.isoformat() if at else None,
            "source": "feld" if actor.is_field else "kp",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(incident)

    if at is not None and incident.event_id:
        await create_field_notification(
            db,
            notification_type="field_complete",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=f"Einsatz beendet gemeldet: {_location(incident)}{actor.suffix}",
        )
    await _broadcast(incident)
    return True


async def record_pickup(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    needed: bool,
    note: str | None = None,
    at: datetime | None = None,
    request: Request | None = None,
) -> bool:
    """ "Abholung nötig" / "abgeholt" (decision 24).

    Not a status: a Schadenplatz can be finished and still have three people
    standing in the rain. Deliberately **not** cleared by completing the
    incident — ``crud/incidents.auto_release_incident_resources`` releases the
    crew on `complete` while they are physically still at the address, which is
    exactly the moment this flag has to survive.

    Clearing wipes the note and both provenance columns: "abgeholt" is the end of
    the fact, not a historical record, and the audit log keeps the history.
    """
    if incident.pickup_needed == needed and (not needed or (incident.pickup_note or None) == (note or None)):
        return False

    incident.pickup_needed = needed
    if needed:
        incident.pickup_note = note or None
        # Keep the ORIGINAL request time when only the note is edited — the
        # operationally decisive fact at 02:00 is how long they have been waiting.
        incident.pickup_requested_at = at or incident.pickup_requested_at or datetime.now(UTC)
        incident.pickup_requested_by = actor.personnel_id
    else:
        incident.pickup_note = None
        incident.pickup_requested_at = None
        incident.pickup_requested_by = None

    await log_action(
        db=db,
        action_type="field_pickup_requested" if needed else "field_pickup_cleared",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={"pickup_needed": needed, "pickup_note": note, "source": "feld" if actor.is_field else "kp"},
        request=request,
    )
    await db.commit()
    await db.refresh(incident)

    if incident.event_id:
        if needed:
            detail = f" ({note})" if note else ""
            await create_field_notification(
                db,
                notification_type="field_pickup",
                incident_id=incident.id,
                event_id=incident.event_id,
                message=f"Abholung nötig: {_location(incident)}{detail}{actor.suffix}",
                # The only warning of the five. A waiting crew is the one field
                # event that is time-critical for the KP.
                severity="warning",
            )
        else:
            await create_field_notification(
                db,
                notification_type="field_pickup",
                incident_id=incident.id,
                event_id=incident.event_id,
                message=f"Abholung erledigt: {_location(incident)}{actor.suffix}",
            )
    await _broadcast(incident)
    return True


async def record_field_message(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    message: str,
    request: Request | None = None,
) -> Notification | None:
    """Freitext-Meldung an den KP — a bell entry **and** a Journal entry.

    Both on purpose: the notification is how the KP sees it now, the audit-log
    entry is how it survives into the Einsatztagebuch after somebody dismisses
    the bell. Append-only and attributed, which is also the mitigation for two
    crews overwriting one another's Kurzbericht (§12).
    """
    text = message.strip()
    if not text:
        return None

    await log_action(
        db=db,
        action_type="field_message",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "message": text,
            "personnel_id": str(actor.personnel_id) if actor.personnel_id else None,
            "personnel_name": actor.personnel_name,
            "source": "feld" if actor.is_field else "kp",
        },
        request=request,
    )
    await db.commit()

    notification: Notification | None = None
    if incident.event_id:
        who = actor.personnel_name if actor.is_field else "im KP erfasst"
        notification = await create_field_notification(
            db,
            notification_type="field_message",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=f"Meldung vom Feld ({who}) — {_location(incident)}: {text}" if who else f"Meldung vom Feld: {text}",
        )
    await _broadcast(incident)
    return notification


async def field_report_state(db: AsyncSession, incident: Incident) -> dict[str, Any]:
    """The three field reports of one incident, as both routers return them.

    ``arrived_by_*`` comes off the report's ``created_by_*`` pair — see the note
    in ``record_arrival``.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    return {
        "incident_id": incident.id,
        "arrived_at": report.arrived_at if report else None,
        "arrived_by_personnel_id": report.created_by_personnel_id if report else None,
        "arrived_in_kp": bool(report and report.arrived_at and report.created_by_personnel_id is None),
        "field_complete_reported_at": incident.field_complete_reported_at,
        "field_complete_reported_by": incident.field_complete_reported_by,
        "pickup_needed": incident.pickup_needed,
        "pickup_note": incident.pickup_note,
        "pickup_requested_at": incident.pickup_requested_at,
        "pickup_requested_by": incident.pickup_requested_by,
    }
