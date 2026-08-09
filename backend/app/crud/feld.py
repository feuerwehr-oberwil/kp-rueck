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
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request, UploadFile
from sqlalchemy import false as sa_false
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Incident,
    IncidentAssignment,
    Material,
    Notification,
    Personnel,
    SchadenplatzReport,
    StatusTransition,
    User,
    Vehicle,
)
from ..schemas.feld import RapportUpdate
from ..services.audit import log_action
from ..services.incident_leader import effective_leader_id
from ..services.notification_service import create_field_notification
from ..services.photo_storage import photo_storage
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

    The arrival carries its **own** ``arrived_by_*`` pair rather than borrowing
    the row's ``created_by_*``. That shortcut was exact only while an arrival was
    the only thing that could create the row; since the KP can create a rapport
    first (decision 28), a crew arriving afterwards would otherwise have its
    arrival rendered "im KP erfasst". Exactly one side is written, and clearing
    the arrival clears both — "nobody has reported it" is not a KP report.
    """
    report = await _get_or_create_report(db, incident.id, actor)
    if only_if_unset and report.arrived_at is not None:
        return False
    if report.arrived_at == at:
        return False

    report.arrived_at = at
    _stamp_updated_by(report, actor)
    if at is not None:
        report.arrived_by_personnel_id = actor.personnel_id
        report.arrived_by_user_id = actor.user.id if actor.user and not actor.is_field else None
    else:
        report.arrived_by_personnel_id = None
        report.arrived_by_user_id = None

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

    ``arrived_by_*`` is the arrival's own pair, not the row's ``created_by_*`` —
    see the note in ``record_arrival``.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    return {
        "incident_id": incident.id,
        "arrived_at": report.arrived_at if report else None,
        "arrived_by_personnel_id": report.arrived_by_personnel_id if report else None,
        "arrived_in_kp": bool(report and report.arrived_at and report.arrived_by_personnel_id is None),
        "field_complete_reported_at": incident.field_complete_reported_at,
        "field_complete_reported_by": incident.field_complete_reported_by,
        "pickup_needed": incident.pickup_needed,
        "pickup_note": incident.pickup_note,
        "pickup_requested_at": incident.pickup_requested_at,
        "pickup_requested_by": incident.pickup_requested_by,
    }


# ============================================
# The Schadenplatz-Rapport (phase 2)
# ============================================
#
# The paper replacement. Same rule as everything above it: ONE implementation,
# two thin routers over it (decision 28). The GET computes a prefill and
# deliberately does not write; only the PUT creates a row.
#
# And, still: nothing here touches `incident_assignments`. The material
# checklist READS the assignments and records two ticks against them; releasing
# what came back is a board action offered by "Material zurück – freigeben"
# (decision 17), never a side effect of filing.

# How long another person's save is shown as "bearbeitet gerade" (§3).
CONCURRENT_EDITOR_WINDOW = timedelta(minutes=5)


def _is_answered(row: Mapping[str, Any]) -> bool:
    """Did the crew say anything about this unit?

    Both ticks count. An unanswered row is one nobody looked at, and it is the
    only kind the reconciliation is allowed to drop when the board takes the
    unit away again.
    """
    return row.get("used") is not None or bool(row.get("left_on_site"))


async def _board_material_units(
    db: AsyncSession,
    incident_id: uuid.UUID,
) -> tuple[list[dict[str, Any]], dict[uuid.UUID, dict[str, Any]]]:
    """Every material unit the board has (or had) on this incident.

    **Including already-released ones** (§4): a pump that came back early still
    belongs in the record, and the crew that used it is the only one who can say
    so. Ordered by depot, then name, so a crew with fourteen units reads them in
    the order it knows from the shelf.
    """
    result = await db.execute(
        select(IncidentAssignment, Material)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "material",
        )
        .order_by(Material.location_sort_order, Material.location, Material.name, IncidentAssignment.assigned_at)
    )
    ordered: list[dict[str, Any]] = []
    by_assignment: dict[uuid.UUID, dict[str, Any]] = {}
    for assignment, material in result.all():
        unit = {
            "assignment_id": assignment.id,
            "material_id": material.id,
            "name": material.name,
            "location": material.location or None,
            "consumable": material.consumable,
        }
        ordered.append(unit)
        by_assignment[assignment.id] = unit
    return ordered, by_assignment


def reconcile_materials(
    stored: list[Any] | None,
    board_units: list[dict[str, Any]],
    board_by_assignment: dict[uuid.UUID, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Re-reconcile the checklist against the board — **never replace it** (§4).

    Three rules, and the third is the one that matters:

    * a unit the KP assigned after the draft started appears, unticked;
    * a unit that is still on the board keeps whatever the crew answered;
    * a unit the board no longer has keeps its row **if it was already
      answered** (they saw it, they used it) and drops if it was not. Deleting an
      answered row would lose exactly the information the checklist exists to
      capture.

    Consumables can never carry *vor Ort verblieben* (decision 26): a consumable
    that was used is gone. Enforced here rather than only in the UI, so neither
    door and no later caller can write the impossible state.
    """
    stored_rows: dict[uuid.UUID, dict[str, Any]] = {}
    orphans: list[dict[str, Any]] = []
    for raw in stored or []:
        if not isinstance(raw, dict):
            continue
        try:
            assignment_id = uuid.UUID(str(raw.get("assignment_id")))
        except (TypeError, ValueError):
            continue
        row = dict(raw)
        row["assignment_id"] = assignment_id
        if assignment_id in board_by_assignment:
            stored_rows[assignment_id] = row
        elif _is_answered(row):
            row["on_board"] = False
            orphans.append(row)

    merged: list[dict[str, Any]] = []
    for unit in board_units:
        previous = stored_rows.get(unit["assignment_id"], {})
        consumable = bool(unit["consumable"])
        merged.append(
            {
                "assignment_id": unit["assignment_id"],
                "material_id": unit["material_id"],
                "name": unit["name"],
                "location": unit["location"],
                "consumable": consumable,
                "used": previous.get("used"),
                "left_on_site": False if consumable else bool(previous.get("left_on_site")),
                "on_board": True,
            }
        )

    # The answered orphans go last: they are history, not a to-do.
    for row in orphans:
        consumable = bool(row.get("consumable"))
        merged.append(
            {
                "assignment_id": row["assignment_id"],
                "material_id": row.get("material_id"),
                "name": row.get("name") or "Unbekannt",
                "location": row.get("location"),
                "consumable": consumable,
                "used": row.get("used"),
                "left_on_site": False if consumable else bool(row.get("left_on_site")),
                "on_board": False,
            }
        )
    return merged


def _jsonable_materials(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The checklist as it goes into JSONB: ids as strings, no derived flags.

    ``location`` and ``on_board`` are recomputed on every read from the live
    catalogue and the live assignments, so storing them would be storing a
    second, staler copy of the board.
    """
    return [
        {
            "assignment_id": str(row["assignment_id"]),
            "material_id": str(row["material_id"]) if row.get("material_id") else None,
            "name": row.get("name"),
            "consumable": bool(row.get("consumable")),
            "used": row.get("used"),
            "left_on_site": bool(row.get("left_on_site")),
        }
        for row in rows
    ]


async def _resource_counts(db: AsyncSession, incident_id: uuid.UUID) -> tuple[int, int]:
    """The board's own personnel and vehicle counts for the Kostenpflicht block.

    Distinct resources, not assignment rows: somebody assigned, released and
    re-assigned worked one Einsatz, not two. Released rows count — the crew that
    left an hour ago was still eingesetzt.
    """
    result = await db.execute(
        select(IncidentAssignment.resource_type, IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type.in_(["personnel", "vehicle"]),
        )
    )
    personnel_ids: set[uuid.UUID] = set()
    vehicle_ids: set[uuid.UUID] = set()
    for resource_type, resource_id in result.all():
        (personnel_ids if resource_type == "personnel" else vehicle_ids).add(resource_id)
    return len(personnel_ids), len(vehicle_ids)


async def _default_work_started_at(
    db: AsyncSession, incident: Incident, report: SchadenplatzReport | None
) -> datetime | None:
    """Beginn Tätigkeit: the arrival, else the first `active`, else the earliest assignment (§4)."""
    if report is not None and report.arrived_at is not None:
        return report.arrived_at

    transition = await db.execute(
        select(StatusTransition.timestamp)
        .where(StatusTransition.incident_id == incident.id, StatusTransition.to_status == "active")
        .order_by(StatusTransition.timestamp.asc())
        .limit(1)
    )
    first_active = transition.scalar_one_or_none()
    if first_active is not None:
        return first_active

    assigned = await db.execute(
        select(IncidentAssignment.assigned_at)
        .where(IncidentAssignment.incident_id == incident.id)
        .order_by(IncidentAssignment.assigned_at.asc())
        .limit(1)
    )
    return assigned.scalar_one_or_none()


async def _default_work_ended_at(db: AsyncSession, incident: Incident) -> datetime | None:
    """Ende Tätigkeit: the field report, else the first `returning`/`complete`, else empty (§4)."""
    if incident.field_complete_reported_at is not None:
        return incident.field_complete_reported_at

    transition = await db.execute(
        select(StatusTransition.timestamp)
        .where(StatusTransition.incident_id == incident.id, StatusTransition.to_status.in_(["returning", "complete"]))
        .order_by(StatusTransition.timestamp.asc())
        .limit(1)
    )
    return transition.scalar_one_or_none()


async def _names(db: AsyncSession, report: SchadenplatzReport | None) -> dict[str, str | None]:
    """The four provenance names, resolved in one round trip each side."""
    if report is None:
        return {"created_by_name": None, "updated_by_name": None}

    personnel_ids = {i for i in (report.created_by_personnel_id, report.updated_by_personnel_id) if i}
    user_ids = {i for i in (report.created_by_user_id, report.updated_by_user_id) if i}

    personnel_names: dict[uuid.UUID, str] = {}
    if personnel_ids:
        rows = await db.execute(select(Personnel.id, Personnel.name).where(Personnel.id.in_(personnel_ids)))
        personnel_names = {row[0]: row[1] for row in rows.all()}

    user_names: dict[uuid.UUID, str] = {}
    if user_ids:
        rows = await db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
        user_names = {row[0]: row[1] for row in rows.all()}

    def resolve(personnel_id: uuid.UUID | None, user_id: uuid.UUID | None) -> str | None:
        if personnel_id is not None:
            return personnel_names.get(personnel_id)
        if user_id is not None:
            return user_names.get(user_id)
        return None

    return {
        "created_by_name": resolve(report.created_by_personnel_id, report.created_by_user_id),
        "updated_by_name": resolve(report.updated_by_personnel_id, report.updated_by_user_id),
    }


def _concurrent_editor(
    report: SchadenplatzReport | None,
    actor: FieldActor,
    updated_by_name: str | None,
) -> dict[str, Any] | None:
    """ "Frey Marc bearbeitet diesen Rapport gerade" — or nothing (§3).

    Only when the last save was **somebody else** inside the window. Visibility,
    not a lock: two crews on one Schadenplatz overwriting each other's
    Kurzbericht is an accepted cost (§12), and a lock in the field is worse than
    the problem it solves.
    """
    if report is None or report.updated_at is None or not updated_by_name:
        return None

    same_person = (
        actor.is_field
        and report.updated_by_personnel_id is not None
        and report.updated_by_personnel_id == actor.personnel_id
    ) or (
        not actor.is_field
        and actor.user is not None
        and report.updated_by_user_id is not None
        and report.updated_by_user_id == actor.user.id
    )
    if same_person:
        return None

    updated_at = report.updated_at
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=UTC)
    if datetime.now(UTC) - updated_at > CONCURRENT_EDITOR_WINDOW:
        return None

    return {
        "name": updated_by_name,
        "at": report.updated_at,
        "in_kp": report.updated_by_personnel_id is None and report.updated_by_user_id is not None,
    }


async def get_rapport(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
) -> dict[str, Any]:
    """The Schadenplatz-Rapport — **prefilled if it does not exist yet** (§4).

    A GET that computes and does **not** write. The prefill is defaults and
    orientation, never authoritative once the crew has touched the form, and it
    stays on the response afterwards so both the form and the export can show
    "vom Board: 6" next to a corrected 8.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()

    board_units, board_by_assignment = await _board_material_units(db, incident.id)
    materials = reconcile_materials(report.materials_json if report else None, board_units, board_by_assignment)

    board_personnel, board_vehicles = await _resource_counts(db, incident.id)
    leaders = await get_incident_leaders(db, [incident.id])
    leader = leaders.get(incident.id)
    names = await _names(db, report)

    default_started = await _default_work_started_at(db, incident, report)
    default_ended = await _default_work_ended_at(db, incident)

    prefill = {
        "location_address": incident.location_address,
        # The reference the exports use. `title` is what the board shows on the
        # card and what the PDF prints, so the crew recognises the slip it is
        # filling from the row it tapped.
        "incident_ref": incident.title or incident.location_address or "Unbekannt",
        "leader_personnel_id": leader[0] if leader else None,
        "leader_name": leader[1] if leader else None,
        # "Melder übernehmen": one tap COPIES these into the owner block. The
        # Melder is frequently not the Eigentümer, so the copy stays editable
        # and the two are never equated.
        "melder_name": incident.contact or None,
        "melder_street": incident.location_address or None,
        "melder_city": None,
        "board_personnel_count": board_personnel,
        "board_vehicle_count": board_vehicles,
        "default_work_started_at": default_started,
        "default_work_ended_at": default_ended,
    }

    concurrent = _concurrent_editor(report, actor, names["updated_by_name"])

    if report is None:
        return {
            "incident_id": incident.id,
            "exists": False,
            "is_draft": True,
            "materials": materials,
            "photos": [],
            "personnel_count": board_personnel,
            "vehicle_count": board_vehicles,
            "work_started_at": default_started,
            "work_ended_at": default_ended,
            "prefill": prefill,
            "concurrent_editor": None,
        }

    return {
        "incident_id": incident.id,
        "exists": True,
        "is_draft": report.is_draft,
        "submitted_at": report.submitted_at,
        "damage_type": report.damage_type,
        "damage_type_other": report.damage_type_other,
        # A stored value wins; the derived default fills the blank the first time.
        "work_started_at": report.work_started_at or default_started,
        "work_ended_at": report.work_ended_at or default_ended,
        "materials": materials,
        # Filenames only. They are read back through the shared
        # `GET /api/photos/{incident_id}/{filename}`, which is what the Reko
        # form already uses — the photo bytes are not per-door.
        "photos": list(report.photos_json or []),
        "extra_material_note": report.extra_material_note,
        "kurzbericht": report.kurzbericht,
        "handed_over_to": report.handed_over_to,
        "owner_name": report.owner_name,
        "owner_street": report.owner_street,
        "owner_city": report.owner_city,
        "vehicle_plate": report.vehicle_plate,
        "vehicle_model": report.vehicle_model,
        "personnel_count": report.personnel_count if report.personnel_count is not None else board_personnel,
        "personnel_count_corrected": report.personnel_count_corrected,
        "vehicle_count": report.vehicle_count if report.vehicle_count is not None else board_vehicles,
        "vehicle_count_corrected": report.vehicle_count_corrected,
        "cost_snapshot_json": report.cost_snapshot_json,
        "arrived_at": report.arrived_at,
        "created_by_name": names["created_by_name"],
        "created_in_kp": report.created_by_personnel_id is None and report.created_by_user_id is not None,
        "updated_by_name": names["updated_by_name"],
        "updated_in_kp": report.updated_by_personnel_id is None and report.updated_by_user_id is not None,
        "updated_at": report.updated_at,
        "concurrent_editor": concurrent,
        "prefill": prefill,
    }


async def _build_cost_snapshot(db: AsyncSession, incident_id: uuid.UUID) -> list[dict[str, str | None]]:
    """Freeze who and which vehicles, with from/to, at the moment of submission.

    Decision 6: a later board edit cannot silently change a filed rapport. The
    per-person from/to is kept even though no output derives person-hours from
    it today — the snapshot is the thing that has to survive, and recomputing it
    later is exactly what it exists to prevent.
    """
    result = await db.execute(
        select(IncidentAssignment).where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type.in_(["personnel", "vehicle"]),
        )
    )
    assignments = list(result.scalars().all())
    if not assignments:
        return []

    personnel_ids = [a.resource_id for a in assignments if a.resource_type == "personnel"]
    vehicle_ids = [a.resource_id for a in assignments if a.resource_type == "vehicle"]

    personnel_names: dict[uuid.UUID, str] = {}
    if personnel_ids:
        rows = await db.execute(select(Personnel.id, Personnel.name).where(Personnel.id.in_(personnel_ids)))
        personnel_names = {row[0]: row[1] for row in rows.all()}
    vehicle_names: dict[uuid.UUID, str] = {}
    if vehicle_ids:
        rows = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vehicle_ids)))
        vehicle_names = {row[0]: row[1] for row in rows.all()}

    snapshot: list[dict[str, str | None]] = []
    for assignment in sorted(assignments, key=lambda a: (a.resource_type, a.assigned_at)):
        names = personnel_names if assignment.resource_type == "personnel" else vehicle_names
        snapshot.append(
            {
                "kind": assignment.resource_type,
                "name": names.get(assignment.resource_id, "Unbekannt"),
                "from": assignment.assigned_at.isoformat() if assignment.assigned_at else None,
                "to": assignment.unassigned_at.isoformat() if assignment.unassigned_at else None,
            }
        )
    return snapshot


async def save_rapport(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    payload: RapportUpdate,
    request: Request | None = None,
) -> dict[str, Any]:
    """Upsert the Schadenplatz-Rapport. ``is_draft=False`` files it.

    One row per incident (decision 3): whoever files first creates it, anyone
    else assigned amends the same row, and "zuletzt bearbeitet von X" is how the
    next person knows. Only the fields actually present in the payload are
    written — an autosave that carries half the form must not blank the rest.

    Submitting stamps ``submitted_at``, freezes ``cost_snapshot_json`` and emits
    ``rapport_submitted``. **A later board edit cannot change a filed rapport**
    (decision 6), which is the entire reason the snapshot exists.
    """
    report = await _get_or_create_report(db, incident.id, actor)
    provided = payload.model_fields_set
    was_draft = report.is_draft

    for field in (
        "damage_type",
        "damage_type_other",
        "work_started_at",
        "work_ended_at",
        "extra_material_note",
        "kurzbericht",
        "handed_over_to",
        "owner_name",
        "owner_street",
        "owner_city",
        "vehicle_plate",
        "vehicle_model",
    ):
        if field in provided:
            setattr(report, field, getattr(payload, field))

    if "materials" in provided and payload.materials is not None:
        board_units, board_by_assignment = await _board_material_units(db, incident.id)
        ticks = {row.assignment_id: row for row in payload.materials}
        # Reconcile FIRST, then apply the ticks: a unit the KP added while the
        # crew was typing has to appear even though the payload knows nothing
        # about it, and one the board took away must not come back through a
        # stale form.
        merged = reconcile_materials(report.materials_json, board_units, board_by_assignment)
        for row in merged:
            tick = ticks.get(row["assignment_id"])
            if tick is None:
                continue
            row["used"] = tick.used
            row["left_on_site"] = False if row["consumable"] else bool(tick.left_on_site)
        # A unit that vanished from the board but was answered in THIS payload
        # keeps that answer — the reconciliation would otherwise have dropped a
        # row the crew just filled in.
        answered_ids = {row["assignment_id"] for row in merged}
        for assignment_id, tick in ticks.items():
            if assignment_id in answered_ids or assignment_id in board_by_assignment:
                continue
            if tick.used is None and not tick.left_on_site:
                continue
            merged.append(
                {
                    "assignment_id": assignment_id,
                    "material_id": None,
                    "name": "Unbekannt",
                    "location": None,
                    "consumable": False,
                    "used": tick.used,
                    "left_on_site": bool(tick.left_on_site),
                    "on_board": False,
                }
            )
        report.materials_json = _jsonable_materials(merged)

    # The Kostenpflicht counts. A corrected value is stored AS corrected — the
    # divergence is itself information, it says the board was behind reality —
    # and a value that matches the board clears the flag again.
    board_personnel, board_vehicles = await _resource_counts(db, incident.id)
    if "personnel_count" in provided:
        report.personnel_count = payload.personnel_count
        report.personnel_count_corrected = (
            payload.personnel_count is not None and payload.personnel_count != board_personnel
        )
    if "vehicle_count" in provided:
        report.vehicle_count = payload.vehicle_count
        report.vehicle_count_corrected = payload.vehicle_count is not None and payload.vehicle_count != board_vehicles

    submitting = payload.is_draft is False
    if submitting:
        report.is_draft = False
        if report.submitted_at is None:
            report.submitted_at = datetime.now(UTC)
        # Frozen once. Re-submitting an amended rapport must not silently
        # re-derive the counts from a board that has moved on since.
        if report.cost_snapshot_json is None:
            report.cost_snapshot_json = await _build_cost_snapshot(db, incident.id)
        if report.personnel_count is None:
            report.personnel_count = board_personnel
        if report.vehicle_count is None:
            report.vehicle_count = board_vehicles

    _stamp_updated_by(report, actor)

    await log_action(
        db=db,
        action_type="rapport_submitted" if submitting else "rapport_saved",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        # Deliberately no owner_* and no free text: the audit log is read by
        # everyone with an account, and the owner block is citizen PII (§9).
        changes={
            "is_draft": report.is_draft,
            "damage_type": report.damage_type,
            "source": "feld" if actor.is_field else "kp",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(report)

    if submitting and was_draft and incident.event_id:
        await create_field_notification(
            db,
            notification_type="rapport_submitted",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=f"Rapport erfasst: {_location(incident)}{actor.suffix}",
        )
    await _broadcast(incident)

    return await get_rapport(db, incident, actor=actor)


# ============================================
# Fotos (phase 3) — one implementation, two doors
# ============================================
#
# The crew photographs the cellar; the KP attaches the photo that arrived by
# WhatsApp (§6.1). Same storage as the Reko form (`services/photo_storage.py`),
# same files on disk, same `GET /api/photos/{incident_id}/{filename}` to read
# them back — only the door differs, and the two doors stay separate: a feld
# token does not open the Reko photo endpoints and a Reko form token does not
# open these (that is asserted in the tests, not left to review).


async def add_photo(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    file: UploadFile,
    request: Request | None = None,
) -> list[str]:
    """Attach a photo to the Schadenplatz-Rapport; returns the new list.

    Creates the report row if there is none — a photo is field contact, the same
    way "Angekommen" is, and it must not need a form to exist first. The row is
    created as a draft (``is_draft`` defaults True), so an incident that only has
    photos still counts as "kein Rapport" in the Restliste.
    """
    report = await _get_or_create_report(db, incident.id, actor)
    filename = await photo_storage.save_photo(
        incident_id=incident.id,
        file=file,
        current_photos=report.photos_json,
    )
    report.photos_json = [*(report.photos_json or []), filename]
    _stamp_updated_by(report, actor)

    await log_action(
        db=db,
        action_type="rapport_photo_added",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "filename": filename,
            "source": "feld" if actor.is_field else "kp",
            "personnel_name": actor.personnel_name,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(report)
    await _broadcast(incident)
    return list(report.photos_json or [])


async def remove_photo(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    filename: str,
    request: Request | None = None,
) -> list[str]:
    """Detach a photo; returns the remaining list. 404 if it was never on it.

    The row is dropped from ``photos_json`` even when the file has already gone
    from disk — a record pointing at a missing file is worse than no record.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    current = list(report.photos_json or []) if report else []
    if report is None or filename not in current:
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")

    photo_storage.delete_photo(incident.id, filename)
    report.photos_json = [name for name in current if name != filename]
    _stamp_updated_by(report, actor)

    await log_action(
        db=db,
        action_type="rapport_photo_removed",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "filename": filename,
            "source": "feld" if actor.is_field else "kp",
            "personnel_name": actor.personnel_name,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(report)
    await _broadcast(incident)
    return list(report.photos_json or [])


# ============================================
# Die Restliste (phase 3, §6 / V-8)
# ============================================
#
# Three counts on the events page, all clickable through to the incidents:
# Schadenplätze without a rapport, units still on site, Trupps waiting for a
# pickup. This is where somebody at 02:00 finds the gaps, because nobody clicks
# twenty-three cards individually — it is the operational counterpart of there
# being no acceptance step (decision 10).
#
# The material half is deliberately a *different day's* job (decision 25) and
# stays separate from the Trupp-Abholung flag: a pump running in a cellar and
# three people standing in the rain are not the same problem and must never be
# merged into one number.


async def event_restliste(db: AsyncSession, event_id: uuid.UUID) -> dict[str, Any]:
    """What is still open in this Ereignis, in three lists.

    The Ereignis stays open until the material list is empty; that is a feature,
    not an oversight, and it is why the list is printable as the Abholliste.
    """
    incidents_result = await db.execute(
        select(Incident)
        .where(Incident.event_id == event_id, Incident.deleted_at.is_(None))
        .order_by(Incident.created_at)
    )
    incidents = list(incidents_result.scalars().all())

    reports_result = await db.execute(
        select(SchadenplatzReport).where(SchadenplatzReport.incident_id.in_([i.id for i in incidents]))
        if incidents
        else select(SchadenplatzReport).where(sa_false())
    )
    reports = {report.incident_id: report for report in reports_result.scalars().all()}

    # Every material assignment in the event that is STILL open, in one query.
    # An assignment the board has already released is not "vor Ort" any more, no
    # matter what the checklist says — the board is the authority on where a
    # unit is, the rapport only on what the crew did with it.
    active_result = await db.execute(
        select(IncidentAssignment, Material)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
            IncidentAssignment.resource_type == "material",
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    active_units: dict[uuid.UUID, tuple[IncidentAssignment, Material]] = {
        assignment.id: (assignment, material) for assignment, material in active_result.all()
    }

    missing_rapport: list[dict[str, Any]] = []
    open_pickups: list[dict[str, Any]] = []
    material_on_site: list[dict[str, Any]] = []

    for incident in incidents:
        report = reports.get(incident.id)
        if report is None or report.is_draft:
            missing_rapport.append(
                {
                    "incident_id": incident.id,
                    "title": incident.title,
                    "location_address": incident.location_address,
                    "status": incident.status,
                    # 'draft' reads differently from 'none' at 02:00: somebody
                    # started and walked away, versus nobody has touched it.
                    "rapport_state": _rapport_state(report),
                }
            )

        if incident.pickup_needed:
            open_pickups.append(
                {
                    "incident_id": incident.id,
                    "title": incident.title,
                    "location_address": incident.location_address,
                    "status": incident.status,
                    "pickup_note": incident.pickup_note,
                    "since": incident.pickup_requested_at,
                }
            )

        if report is None or report.is_draft or not report.materials_json:
            continue
        for raw in report.materials_json:
            if not isinstance(raw, dict) or not raw.get("left_on_site"):
                continue
            try:
                assignment_id = uuid.UUID(str(raw.get("assignment_id")))
            except (TypeError, ValueError):
                continue
            unit = active_units.get(assignment_id)
            if unit is None:
                continue
            assignment, material = unit
            if material.consumable:
                # A consumable that was used is gone (decision 26); nobody drives
                # out to collect it.
                continue
            material_on_site.append(
                {
                    "incident_id": incident.id,
                    "incident_title": incident.title,
                    "location_address": incident.location_address,
                    "assignment_id": assignment.id,
                    "material_id": material.id,
                    "name": material.name,
                    "location": material.location or None,
                    # When the unit went to that address — the honest answer to
                    # "seit wann steht das dort", and the column the Abholliste
                    # prints. The submit time would only say when somebody got
                    # round to writing it down.
                    "since": assignment.assigned_at,
                }
            )

    return {
        "event_id": event_id,
        "incident_total": len(incidents),
        "missing_rapport": missing_rapport,
        "material_on_site": material_on_site,
        "open_pickups": open_pickups,
    }


async def material_return_units(
    db: AsyncSession,
    incident: Incident,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """ "Material zurück – freigeben" (decision 17): (returned, left_on_site).

    Only for a **submitted** rapport — a draft is a crew still typing, and
    offering a half-answered checklist as a release list is how a pump gets
    freed while it is still running in a cellar.

    Consumables are in neither list: a consumable that was used is gone
    (decision 26). Units the board has already released are gone too — there is
    nothing left to free.

    The board does the releasing through the existing per-assignment release.
    `/feld` never writes an assignment, and this function does not either; it
    only says which units the crew did not mark as left on site.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    if report is None or report.is_draft:
        return [], []

    active = await db.execute(
        select(IncidentAssignment.id).where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "material",
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    still_assigned = {row[0] for row in active.all()}

    board_units, board_by_assignment = await _board_material_units(db, incident.id)
    rows = reconcile_materials(report.materials_json, board_units, board_by_assignment)

    returned: list[dict[str, Any]] = []
    left: list[dict[str, Any]] = []
    for row in rows:
        if row["consumable"] or row["assignment_id"] not in still_assigned:
            continue
        unit = {
            "assignment_id": row["assignment_id"],
            "material_id": row["material_id"],
            "name": row["name"],
            "location": row["location"],
            "used": row["used"],
        }
        (left if row["left_on_site"] else returned).append(unit)
    return returned, left
