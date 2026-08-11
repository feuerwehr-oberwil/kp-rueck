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
    EventAttendance,
    Incident,
    IncidentAssignment,
    Material,
    Notification,
    Personnel,
    RekoReport,
    SchadenplatzReport,
    User,
    Vehicle,
)
from ..schemas.feld import RapportUpdate
from ..services.audit import log_action
from ..services.incident_dispatch import dispatched_incident_ids, rapport_applies
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

    # A Schadenplatz nobody was ever sent to owes no rapport, so it must not
    # show up in the badge that tells somebody how much work is waiting for them.
    dispatched = await dispatched_incident_ids(db, list(incidents.values()))
    owes_rapport = {
        incident_id
        for incident_id in incident_ids
        if rapport_applies(dispatched=incident_id in dispatched, has_report=incident_id in reports)
        and incident_id not in submitted
    }

    rows = [
        {
            "personnel_id": person.id,
            "name": person.name,
            "role": person.role,
            "incident_count": len(ever[person.id]),
            "open_count": len(active.get(person.id, set())),
            "missing_rapport_count": len(ever[person.id] & owes_rapport),
        }
        for person in personnel
    ]
    # Alphabetical: this is a picker people scan for their own name, not a
    # workload ranking.
    rows.sort(key=lambda row: str(row["name"]).casefold())
    return rows


async def _briefings(
    db: AsyncSession,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, Any]]:
    """What the board knows about these Schadenplätze, batched (§18.22).

    Crew, vehicles and material per incident in **three** queries for the whole
    list, not three per row: a storm night is forty Schadenplätze and this
    response is refetched on every window focus.

    Released rows are included, deliberately — see ``FeldAssignment``. The unit
    of a material line is its NAME: two identical pumps are "Tauchpumpe ×2",
    because a crew reads a slip, not an assignment table.
    """
    briefings: dict[uuid.UUID, dict[str, Any]] = {
        incident_id: {"crew": [], "vehicles": [], "materials": []} for incident_id in incident_ids
    }
    if not incident_ids:
        return briefings

    crew_result = await db.execute(
        select(IncidentAssignment.incident_id, Personnel.id, Personnel.name)
        .join(Personnel, Personnel.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
        )
        .order_by(Personnel.name)
    )
    seen_crew: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for incident_id, personnel_id, name in crew_result.all():
        # One person can hold several rows on one incident (assigned, released,
        # re-assigned) and is still one person on the slip.
        if (incident_id, personnel_id) in seen_crew:
            continue
        seen_crew.add((incident_id, personnel_id))
        briefings[incident_id]["crew"].append(name)

    vehicle_result = await db.execute(
        select(IncidentAssignment.incident_id, Vehicle.id, Vehicle.name)
        .join(Vehicle, Vehicle.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "vehicle",
        )
        .order_by(Vehicle.display_order, Vehicle.name)
    )
    seen_vehicles: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for incident_id, vehicle_id, name in vehicle_result.all():
        if (incident_id, vehicle_id) in seen_vehicles:
            continue
        seen_vehicles.add((incident_id, vehicle_id))
        briefings[incident_id]["vehicles"].append(name)

    material_result = await db.execute(
        select(IncidentAssignment.incident_id, Material.name)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "material",
        )
        .order_by(Material.location_sort_order, Material.location, Material.name)
    )
    for incident_id, name in material_result.all():
        lines: list[dict[str, Any]] = briefings[incident_id]["materials"]
        for line in lines:
            if line["name"] == name:
                line["count"] += 1
                break
        else:
            lines.append({"name": name, "count": 1})

    return briefings


#: The ``DangersAssessment`` keys, in the order the board renders its badges.
#: Kept as an explicit tuple rather than "every truthy key": ``other_notes`` is
#: free text and must never be turned into a badge label.
_DANGER_KEYS = ("fire", "fire_danger", "explosion", "collapse", "chemical", "electrical")


async def _reko_briefings(
    db: AsyncSession,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, Any]]:
    """The newest SUBMITTED Reko per incident, flattened for the field.

    Drafts are excluded: a draft Reko is somebody still typing, and quoting half
    a sentence back at the next crew as fact is worse than saying nothing. This
    is the same rule the board's ``has_completed_reko`` already uses.
    """
    if not incident_ids:
        return {}

    result = await db.execute(
        select(RekoReport, Personnel.name)
        .outerjoin(Personnel, Personnel.id == RekoReport.submitted_by_personnel_id)
        .where(
            RekoReport.incident_id.in_(incident_ids),
            RekoReport.is_draft.is_(False),
        )
        .order_by(RekoReport.submitted_at)
    )
    briefings: dict[uuid.UUID, dict[str, Any]] = {}
    for report, personnel_name in result.all():
        dangers_raw = report.dangers_json or {}
        # Newest wins: the query is ordered oldest-first, so a later row simply
        # replaces an earlier one.
        briefings[report.incident_id] = {
            "summary": report.summary_text or None,
            "notes": report.additional_notes or None,
            "dangers": [key for key in _DANGER_KEYS if dangers_raw.get(key)],
            "submitted_at": report.submitted_at,
            "submitted_by_name": personnel_name,
        }
    return briefings


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
    # No rapport before the Schadenplatz was disponiert (§18.27) — one query for
    # the whole list, so a crew with fourteen rows still costs one round trip.
    dispatched = await dispatched_incident_ids(db, [incidents[incident_id] for incident_id in mine_ids])
    leaders = await get_incident_leaders(db, mine_ids)
    briefings = await _briefings(db, mine_ids)
    rekos = await _reko_briefings(db, mine_ids)

    rows: list[dict[str, Any]] = []
    for incident_id, is_active in mine.items():
        incident = incidents[incident_id]
        report = reports.get(incident_id)
        leader = leaders.get(incident_id)
        briefing = briefings.get(incident_id, {})
        rows.append(
            {
                "incident_id": incident.id,
                "incident_title": incident.title or incident.location_address or "Unbekannt",
                "incident_type": incident.type,
                "incident_status": incident.status,
                # The briefing (§18.22): what a crew standing at the address
                # needs before it opens a form.
                "description": incident.description,
                "contact": incident.contact,
                "contact_phone": incident.contact_phone,
                "crew": briefing.get("crew", []),
                "vehicles": briefing.get("vehicles", []),
                "materials": briefing.get("materials", []),
                "reko": rekos.get(incident_id),
                "location_address": incident.location_address,
                "location_lat": str(incident.location_lat) if incident.location_lat is not None else None,
                "location_lng": str(incident.location_lng) if incident.location_lng is not None else None,
                "is_active_assignment": is_active,
                "rapport_state": _rapport_state(report),
                "has_been_dispatched": incident_id in dispatched,
                "arrived_at": report.arrived_at if report else None,
                # Who said so: the crew's own tap, or the GPS automation having
                # watched an assigned vehicle reach the address (§18.24). The
                # phone has to be able to word it — a crew that never tapped
                # "Angekommen" must not read its own name off that line.
                "arrived_by_automation": bool(
                    report and report.arrived_at and is_automation_user(report.arrived_by_user_id)
                ),
                "field_complete_reported_at": incident.field_complete_reported_at,
                # The crew must see an open pickup when it comes back to the
                # page, not only in the response of the tap that set it.
                "pickup_needed": incident.pickup_needed,
                "pickup_note": incident.pickup_note,
                "pickup_requested_at": incident.pickup_requested_at,
                "leader_personnel_id": leader[0] if leader else None,
                "leader_name": leader[1] if leader else None,
                # Sort-only, stripped below. "Owes a rapport" rather than "has
                # none": a Schadenplatz that was never disponiert owes nothing,
                # so it must not be sorted up as if it were the crew's homework.
                "_owes_rapport": _rapport_state(report) != "submitted"
                and rapport_applies(dispatched=incident_id in dispatched, has_report=report is not None),
                "_position": incident.position,
                "_created_at": incident.created_at,
            }
        )

    # Same priority order the operator arranged on the board: still-assigned
    # first, then the ones still missing a rapport, then the kanban order.
    rows.sort(
        key=lambda row: (
            not row["is_active_assignment"],
            not row["_owes_rapport"],
            row["_position"],
            row["_created_at"],
        )
    )
    for row in rows:
        row.pop("_owes_rapport", None)
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


def is_automation_user(user_id: uuid.UUID | None) -> bool:
    """Was this write made by the GPS automation rather than by a person?

    The third provenance (§18.24). ``arrived_by_user_id`` pointing at the
    ``gps-automation`` system user is not "im KP erfasst" — no operator typed
    it — and rendering it as such would attribute a machine's inference to
    whoever happened to be sitting at the board.

    The constant is imported **inside** the function on purpose:
    ``services/gps_automation`` imports ``crud.incidents``, so a module-level
    import here would close a cycle through the ``crud`` package. One lazy
    import beats a duplicated UUID literal that can drift.
    """
    if user_id is None:
        return False
    from ..services.gps_automation import GPS_SYSTEM_USER_ID

    return user_id == GPS_SYSTEM_USER_ID


@dataclass(frozen=True)
class FieldActor:
    """Who is filing — and **exactly one side of this is ever populated**.

    Provenance is never faked (decision 28). A `/feld` write carries the
    ``Personnel`` row and stamps the ``*_by`` personnel FKs; a KP write carries
    the ``User``, leaves those columns NULL, and puts the user in the audit-log
    entry instead. A ``User`` is never guessed to be a ``Personnel`` — they are
    different people often enough that a wrong attribution on a billing document
    is worse than no attribution.

    **A third kind exists since §18.24: the GPS automation.** It is a ``User``
    actor like the KP one — the ``gps-automation`` row, which is already the
    actor of the status change it makes — but it must never be *worded* as a KP
    entry, because no operator did anything. Readers tell them apart by the user
    id (``is_automation_user``), so nothing has to be stored twice; this flag
    exists only so the notification wording is right at write time, where the
    row is not loaded yet.
    """

    personnel_id: uuid.UUID | None = None
    personnel_name: str | None = None
    user: User | None = None
    automation: bool = False

    @property
    def is_field(self) -> bool:
        """True for a crew filing on `/feld`, False for a KP radio entry."""
        return self.personnel_id is not None

    @property
    def suffix(self) -> str:
        """The " · von wem" tail of every notification this module writes."""
        if self.is_field:
            return f" · {self.personnel_name}" if self.personnel_name else " · vom Feld"
        if self.automation:
            return " · automatisch (GPS)"
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

    **This payload is a NOTIFICATION, not the incident** — and it is the only
    producer of `incident_update` that is. Everywhere else (``api/intake.py``,
    ``api/reko.py``, ``api/divera.py``, the incident routes) sends a full
    ``IncidentResponse.model_dump()``. Do not build anything on the three fields
    below: the client's ``handleRemoteUpdate`` takes **no argument at all**
    (``lib/contexts/operations-context.tsx`` → ``decideRemoteUpdateAction``), it
    refetches the board, and the payload is discarded by every listener.

    It stays partial on purpose rather than being widened to match. A full
    ``IncidentResponse`` from here would mean assembling the incident's crew,
    vehicles, materials and Reko inside a CRUD module whose whole job is the
    field surface — a second, divergent serialisation of the board's central
    object, kept in step by nobody, for a payload that is thrown away on
    arrival. If a listener ever *does* need to read this event's body, widen it
    then, by reusing the incident serialiser rather than growing this dict.
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
            message=f"Meldung vom Feld ({who}) – {_location(incident)}: {text}" if who else f"Meldung vom Feld: {text}",
        )
    await _broadcast(incident)
    return notification


async def field_report_state(db: AsyncSession, incident: Incident) -> dict[str, Any]:
    """The three field reports of one incident, as both routers return them.

    ``arrived_by_*`` is the arrival's own pair, not the row's ``created_by_*`` —
    see the note in ``record_arrival``.

    Three provenances, not two (§18.24): a crew tapping on `/feld`, an operator
    taking it over the radio, and the GPS automation having watched an assigned
    vehicle reach the address. ``arrived_in_kp`` deliberately excludes the third
    — it is what the UI words as "im KP erfasst", and no operator was involved.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    by_automation = bool(report and report.arrived_at and is_automation_user(report.arrived_by_user_id))
    return {
        "incident_id": incident.id,
        "arrived_at": report.arrived_at if report else None,
        "arrived_by_personnel_id": report.arrived_by_personnel_id if report else None,
        "arrived_by_automation": by_automation,
        "arrived_in_kp": bool(
            report and report.arrived_at and report.arrived_by_personnel_id is None and not by_automation
        ),
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


def _material_used(row: Mapping[str, Any]) -> bool:
    """``used`` as a plain bool, defaulting to **true** (§18.32).

    Rows written before the reversal can still carry ``null`` in the JSONB of a
    database that skipped the normalising migration (or of a payload replayed
    from an old phone), and `null` no longer means anything: the default answer
    for a unit that was sent to this Schadenplatz is "gebraucht".
    """
    value = row.get("used")
    return True if value is None else bool(value)


def _is_answered(row: Mapping[str, Any]) -> bool:
    """Did the crew contradict the board about this unit?

    Since `used` is prefilled *ja* (§18.32) an untouched row is not "unanswered",
    it is the board's own answer — exactly as on the vehicle list. So the only
    rows carrying information the board does not already have are the ones where
    the crew unticked *gebraucht* or ticked *vor Ort verblieben*, and those are
    the only ones worth keeping when the board takes the unit away again.
    """
    return not _material_used(row) or bool(row.get("left_on_site"))


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

    * a unit the KP assigned after the draft started appears, ticked *gebraucht*
      (§18.32 — that is the default answer, not an unanswered state);
    * a unit that is still on the board keeps whatever the crew answered;
    * a unit the board no longer has keeps its row **if the crew contradicted
      the board** (unticked *gebraucht* or ticked *vor Ort verblieben*) and drops
      if it still carries nothing but the defaults. Deleting a contradicted row
      would lose exactly the information the checklist exists to capture.

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
                # Prefilled ticked: the unit was sent here, so "gebraucht" is the
                # board's own answer and the crew's job is to contradict it.
                "used": _material_used(previous),
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
                "used": _material_used(row),
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
            "used": _material_used(row),
            "left_on_site": bool(row.get("left_on_site")),
        }
        for row in rows
    ]


def normalize_extra_materials(stored: Any) -> list[dict[str, Any]]:
    """ "Weiteres gebrauchtes Material" as a list of ``{name, left_on_site}`` (§18.35).

    Defensive on the way in, because the column is JSONB written by two doors and
    read by five outputs: anything without a usable name is dropped, the name is
    trimmed, the flag is coerced to a bool, and the crew's order is kept. A
    duplicate name collapses into one entry — the same thing named twice is one
    thing standing at the address — and it keeps the *left* flag if either copy
    carried it, because the answer that sends somebody driving must not be lost
    to a merge.

    There is no ``used`` here on purpose: naming something on this list already
    means it was used.
    """
    entries: list[dict[str, Any]] = []
    seen: dict[str, dict[str, Any]] = {}
    for raw in stored or []:
        if isinstance(raw, str):
            # Tolerated for a payload replayed from a phone that still speaks the
            # old comma-separated shape; the migration handled the database.
            raw = {"name": raw}
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        left = bool(raw.get("left_on_site"))
        existing = seen.get(name.lower())
        if existing is not None:
            existing["left_on_site"] = existing["left_on_site"] or left
            continue
        entry = {"name": name, "left_on_site": left}
        seen[name.lower()] = entry
        entries.append(entry)
    return entries


async def _fleet_vehicles(
    db: AsyncSession,
    incident_id: uuid.UUID,
) -> tuple[list[dict[str, Any]], set[uuid.UUID]]:
    """The station's **whole fleet**, plus which of it this incident has (§18.33).

    Not only the assigned vehicles. On a storm night the board is routinely
    behind reality in both directions: a vehicle drives along that nobody
    assigned, and one that was assigned never leaves the ramp. A list that can
    only be *unticked* can record the second and not the first, and the crew is
    the only party that knows either.

    The assigned set includes **released** assignments: a vehicle that drove back
    early was still at the Schadenplatz, and only the crew can say otherwise.

    Ordered the way the fleet is ordered everywhere else in the app, so the crew
    reads the vehicles in the order it knows them.
    """
    result = await db.execute(select(Vehicle).order_by(Vehicle.display_order, Vehicle.name))
    ordered = [{"vehicle_id": vehicle.id, "name": vehicle.name} for vehicle in result.scalars().all()]

    assigned = await db.execute(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "vehicle",
        )
    )
    return ordered, {row[0] for row in assigned.all()}


def reconcile_vehicles(
    stored: list[Any] | None,
    fleet: list[dict[str, Any]],
    assigned_ids: set[uuid.UUID],
) -> list[dict[str, Any]]:
    """Re-reconcile the vehicle checklist against the fleet — never replace it.

    Keyed on the **vehicle** since §18.33: a vehicle that came along without ever
    being dispatched has no assignment to key on, so an assignment id cannot be
    the identity of a row that exists for every vehicle the station owns.

    Three rules:

    * every vehicle in the fleet gets a row, ticked when the board has (or had)
      it on this incident and unticked otherwise — that prefill *is* the board's
      answer, and the crew's job is to correct it in either direction;
    * a vehicle the crew already answered keeps that answer, whatever the board
      has done since;
    * a vehicle that has left the fleet entirely survives only when it was
      **ticked** — that is a correction of the board; an unticked row for a
      vehicle nobody owns any more says nothing at all.
    """
    stored_rows: dict[uuid.UUID, dict[str, Any]] = {}
    for raw in stored or []:
        if not isinstance(raw, dict):
            continue
        try:
            vehicle_id = uuid.UUID(str(raw.get("vehicle_id")))
        except (TypeError, ValueError):
            # Pre-§18.33 rows for a vanished assignment carry no vehicle_id at
            # all. There is nothing left to key them on, and the vehicle they
            # named is either in the fleet below (and therefore already covered)
            # or gone from the station.
            continue
        row = dict(raw)
        row["vehicle_id"] = vehicle_id
        stored_rows[vehicle_id] = row

    merged: list[dict[str, Any]] = []
    for unit in fleet:
        previous = stored_rows.pop(unit["vehicle_id"], {})
        merged.append(
            {
                "vehicle_id": unit["vehicle_id"],
                "name": unit["name"],
                "present": bool(previous.get("present", unit["vehicle_id"] in assigned_ids)),
                "on_board": unit["vehicle_id"] in assigned_ids,
            }
        )

    # Whatever is left was ticked for a vehicle the station no longer has.
    for row in stored_rows.values():
        if not row.get("present"):
            continue
        merged.append(
            {
                "vehicle_id": row["vehicle_id"],
                "name": row.get("name") or "Unbekannt",
                "present": True,
                "on_board": False,
            }
        )
    return merged


def _jsonable_vehicles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The vehicle checklist as it goes into JSONB: ids as strings, no ``on_board``.

    ``on_board`` is recomputed on every read from the live assignments, so
    storing it would be storing a second, staler copy of the board.

    **Only the rows that carry an answer are stored** (§18.33). Since the fleet
    row for a vehicle nobody dispatched arrives unticked, writing it down would
    mean copying the whole fleet table into every rapport — and worse, it would
    freeze a default as a decision: a vehicle the KP assigns ten minutes later
    would then stay unticked because a form that never asked about it had
    already "answered" no. So a row survives when it is ticked (the crew says it
    was there) or when the board has it (an unticked one is then a real
    contradiction). Everything else is the default, and the default is recomputed.
    """
    return [
        {
            "vehicle_id": str(row["vehicle_id"]),
            "name": row.get("name"),
            "present": bool(row.get("present")),
        }
        for row in rows
        if row.get("present") or row.get("on_board")
    ]


async def _event_personnel(
    db: AsyncSession,
    incident: Incident,
) -> tuple[list[dict[str, Any]], set[uuid.UUID]]:
    """Everyone checked in at this Ereignis, plus who the board has on THIS incident.

    The roll-call rather than the whole roster: the Appell is the list of people
    who actually turned out tonight, and offering the other forty names would make
    the crew scroll past people who are at home. Anybody the board has assigned
    here is included even when no attendance row exists — the board's own answer
    must never be missing from the list that corrects it.

    The assigned set includes **released** assignments, like the vehicles: a crew
    member who left an hour ago was still at the Schadenplatz.

    Ordered the way the roster is ordered everywhere else, so the crew reads the
    names in the order it knows them.
    """
    assigned_result = await db.execute(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "personnel",
        )
    )
    assigned_ids = {row[0] for row in assigned_result.all()}

    checked_in_result = await db.execute(
        select(EventAttendance.personnel_id).where(
            EventAttendance.event_id == incident.event_id,
            EventAttendance.checked_in.is_(True),
        )
    )
    offered_ids = {row[0] for row in checked_in_result.all()} | assigned_ids
    if not offered_ids:
        return [], assigned_ids

    roster_result = await db.execute(
        select(Personnel)
        .where(Personnel.id.in_(offered_ids))
        .order_by(Personnel.role_sort_order, Personnel.role, Personnel.name)
    )
    roster = [{"personnel_id": person.id, "name": person.name} for person in roster_result.scalars().all()]
    return roster, assigned_ids


def reconcile_personnel(
    stored: list[Any] | None,
    roster: list[dict[str, Any]],
    assigned_ids: set[uuid.UUID],
) -> list[dict[str, Any]]:
    """Re-reconcile the crew checklist against the roll-call — never replace it.

    The vehicle rules, applied to people (see :func:`reconcile_vehicles`): every
    offered name gets a row prefilled from the board, an answer the crew already
    gave survives whatever the board does next, and somebody who has since left
    the roll-call keeps their row only when they were **ticked** — that is a
    correction; an unticked row for a name nobody offered says nothing.
    """
    stored_rows: dict[uuid.UUID, dict[str, Any]] = {}
    for raw in stored or []:
        if not isinstance(raw, dict):
            continue
        try:
            personnel_id = uuid.UUID(str(raw.get("personnel_id")))
        except (TypeError, ValueError):
            continue
        row = dict(raw)
        row["personnel_id"] = personnel_id
        stored_rows[personnel_id] = row

    merged: list[dict[str, Any]] = []
    for person in roster:
        previous = stored_rows.pop(person["personnel_id"], {})
        merged.append(
            {
                "personnel_id": person["personnel_id"],
                "name": person["name"],
                "present": bool(previous.get("present", person["personnel_id"] in assigned_ids)),
                "on_board": person["personnel_id"] in assigned_ids,
            }
        )

    for row in stored_rows.values():
        if not row.get("present"):
            continue
        merged.append(
            {
                "personnel_id": row["personnel_id"],
                "name": row.get("name") or "Unbekannt",
                "present": True,
                "on_board": False,
            }
        )
    return merged


def _jsonable_personnel(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The crew checklist as it goes into JSONB — same rules as the vehicles.

    ``on_board`` is recomputed from the live assignments on every read, so it is
    not stored, and only rows that carry an answer are written: an untouched row
    for somebody nobody dispatched would freeze "nein" as a decision nobody made.
    """
    return [
        {
            "personnel_id": str(row["personnel_id"]),
            "name": row["name"],
            "present": bool(row["present"]),
        }
        for row in rows
        if row["present"] or row["on_board"]
    ]


def normalize_extra_personnel(stored: Any) -> list[dict[str, Any]]:
    """People on no roster of this station, as ``{name, note}``.

    Defensive like :func:`normalize_extra_materials`, and for the same reason —
    JSONB written by two doors and read by several outputs. A duplicate name
    collapses into one entry and keeps whichever note is non-empty: the same
    person named twice is one person standing at the address.
    """
    entries: list[dict[str, Any]] = []
    seen: dict[str, dict[str, Any]] = {}
    for raw in stored or []:
        if isinstance(raw, str):
            raw = {"name": raw}
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        note = str(raw.get("note") or "").strip()
        existing = seen.get(name.lower())
        if existing is not None:
            existing["note"] = existing["note"] or note
            continue
        entry = {"name": name, "note": note}
        seen[name.lower()] = entry
        entries.append(entry)
    return entries


def derive_personnel_count(personnel_rows: list[dict[str, Any]], extra_rows: list[dict[str, Any]]) -> int:
    """The head count, from the list rather than from a keyboard.

    Ticked names plus everybody the crew added by hand. It cannot disagree with
    what the rapport shows, which is the whole reason the number stopped being
    typed.
    """
    return sum(1 for row in personnel_rows if row.get("present")) + len(extra_rows)


async def _board_personnel_count(db: AsyncSession, incident_id: uuid.UUID) -> int:
    """The board's own head count — the number the crew confirms or corrects.

    Distinct people, not assignment rows: somebody assigned, released and
    re-assigned worked one Einsatz, not two. Released rows count — the crew that
    left an hour ago was still eingesetzt.

    The vehicles have no number of their own any more: the crew confirms the
    LIST (``_fleet_vehicles``), and the ticked rows are the count.
    """
    result = await db.execute(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "personnel",
        )
    )
    return len({row[0] for row in result.all()})


async def _material_name_suggestions(db: AsyncSession) -> list[str]:
    """Distinct catalogue names for the "Weiteres Material" autosuggest.

    A naming aid and nothing more. It deliberately carries **no ids**, precisely
    so no client can turn it into a picker: `/feld` never writes an assignment
    (decision 17), and suggesting a name is not picking a unit. Capped so a
    station with a large catalogue does not push a five-figure list to a phone.
    """
    result = await db.execute(select(Material.name).distinct().order_by(Material.name).limit(200))
    return [row[0] for row in result.all() if row[0]]


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

    fleet, assigned_vehicle_ids = await _fleet_vehicles(db, incident.id)
    vehicles = reconcile_vehicles(report.vehicles_json if report else None, fleet, assigned_vehicle_ids)

    roster, assigned_personnel_ids = await _event_personnel(db, incident)
    crew = reconcile_personnel(report.personnel_json if report else None, roster, assigned_personnel_ids)
    extra_personnel = normalize_extra_personnel(report.extra_personnel_json if report else None)

    board_personnel = await _board_personnel_count(db, incident.id)
    leaders = await get_incident_leaders(db, [incident.id])
    leader = leaders.get(incident.id)
    names = await _names(db, report)

    prefill = {
        "location_address": incident.location_address,
        # The reference the exports use. `title` is what the board shows on the
        # card and what the PDF prints, so the crew recognises the slip it is
        # filling from the row it tapped.
        "incident_ref": incident.title or incident.location_address or "Unbekannt",
        "leader_personnel_id": leader[0] if leader else None,
        "leader_name": leader[1] if leader else None,
        # "Melder übernehmen": one tap PREFILLS the two owner inputs with these.
        # The Melder is frequently not the Eigentümer, so the copy stays
        # editable and the two are never equated.
        "melder_name": incident.contact or None,
        "melder_phone": incident.contact_phone or None,
        "board_personnel_count": board_personnel,
        "material_name_suggestions": await _material_name_suggestions(db),
    }

    concurrent = _concurrent_editor(report, actor, names["updated_by_name"])

    if report is None:
        return {
            "incident_id": incident.id,
            "exists": False,
            "is_draft": True,
            "materials": materials,
            "vehicles": vehicles,
            "personnel": crew,
            "extra_personnel": extra_personnel,
            "photos": [],
            "personnel_count": board_personnel,
            "prefill": prefill,
            "concurrent_editor": None,
        }

    return {
        "incident_id": incident.id,
        "exists": True,
        "is_draft": report.is_draft,
        "submitted_at": report.submitted_at,
        "materials": materials,
        "vehicles": vehicles,
        "personnel": crew,
        "extra_personnel": extra_personnel,
        # Filenames only. They are read back through the shared
        # `GET /api/photos/{incident_id}/{filename}`, which is what the Reko
        # form already uses — the photo bytes are not per-door.
        "photos": list(report.photos_json or []),
        "extra_materials": normalize_extra_materials(report.extra_materials_json),
        "kurzbericht": report.kurzbericht,
        "handed_over_to": report.handed_over_to,
        "owner_name": report.owner_name,
        "owner_phone": report.owner_phone,
        # The stored number, which the WRITE derives from the checklist — not a
        # fresh count off the reconciled list above. The reconciled list has to
        # show people the board assigned since (so the crew can still correct it),
        # and re-counting it here would let a KP assigning two more names an hour
        # later silently raise a filed rapport's head count. Decision 6: a later
        # board edit cannot change a filed rapport.
        "personnel_count": report.personnel_count if report.personnel_count is not None else board_personnel,
        "personnel_count_corrected": report.personnel_count_corrected,
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
        "kurzbericht",
        "handed_over_to",
        "owner_name",
        "owner_phone",
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
            row["used"] = bool(tick.used)
            row["left_on_site"] = False if row["consumable"] else bool(tick.left_on_site)
        # A unit that vanished from the board but was answered in THIS payload
        # keeps that answer — the reconciliation would otherwise have dropped a
        # row the crew just filled in. "Answered" means contradicting the board
        # (§18.32): a still-ticked `gebraucht` is the default, not a report.
        answered_ids = {row["assignment_id"] for row in merged}
        for assignment_id, tick in ticks.items():
            if assignment_id in answered_ids or assignment_id in board_by_assignment:
                continue
            if tick.used and not tick.left_on_site:
                continue
            merged.append(
                {
                    "assignment_id": assignment_id,
                    "material_id": None,
                    "name": "Unbekannt",
                    "location": None,
                    "consumable": False,
                    "used": bool(tick.used),
                    "left_on_site": bool(tick.left_on_site),
                    "on_board": False,
                }
            )
        report.materials_json = _jsonable_materials(merged)

    if "vehicles" in provided and payload.vehicles is not None:
        fleet, assigned_vehicle_ids = await _fleet_vehicles(db, incident.id)
        vehicle_ticks = {tick.vehicle_id: tick for tick in payload.vehicles}
        # Reconcile FIRST, then apply the ticks — same reason as the materials: a
        # vehicle the station bought while the crew was typing has to appear, and
        # one that left the fleet must not come back through a stale form.
        merged_vehicles = reconcile_vehicles(report.vehicles_json, fleet, assigned_vehicle_ids)
        for vehicle_row in merged_vehicles:
            vehicle_tick = vehicle_ticks.get(vehicle_row["vehicle_id"])
            if vehicle_tick is None:
                continue
            vehicle_row["present"] = bool(vehicle_tick.present)
        # A vehicle that has left the fleet but was TICKED in THIS payload keeps
        # that answer; an unticked one carries nothing at all, so it is not
        # resurrected.
        known_ids = {vehicle_row["vehicle_id"] for vehicle_row in merged_vehicles}
        for vehicle_id, vehicle_tick in vehicle_ticks.items():
            if vehicle_id in known_ids or not vehicle_tick.present:
                continue
            merged_vehicles.append(
                {
                    "vehicle_id": vehicle_id,
                    "name": "Unbekannt",
                    "present": True,
                    "on_board": False,
                }
            )
        report.vehicles_json = _jsonable_vehicles(merged_vehicles)

    # "Weiteres gebrauchtes Material" (§18.35). Replaced wholesale when present:
    # the entries carry no id, so there is nothing a partial write could key on —
    # and unlike the two checklists above there is no board state to reconcile
    # against, because nothing here was ever dispatched.
    if "extra_materials" in provided:
        entries = normalize_extra_materials(
            [row.model_dump() for row in payload.extra_materials] if payload.extra_materials else []
        )
        report.extra_materials_json = entries or None

    # The crew checklist, reconciled first and then ticked — same shape and same
    # reasoning as the vehicles above. A person who has since left the roll-call
    # but is TICKED in this payload keeps that answer; an unticked one carries
    # nothing and is not resurrected.
    if "personnel" in provided and payload.personnel is not None:
        roster, assigned_personnel_ids = await _event_personnel(db, incident)
        crew_ticks = {tick.personnel_id: tick for tick in payload.personnel}
        merged_crew = reconcile_personnel(report.personnel_json, roster, assigned_personnel_ids)
        for crew_row in merged_crew:
            crew_tick = crew_ticks.get(crew_row["personnel_id"])
            if crew_tick is None:
                continue
            crew_row["present"] = bool(crew_tick.present)
        known_person_ids = {crew_row["personnel_id"] for crew_row in merged_crew}
        for personnel_id, crew_tick in crew_ticks.items():
            if personnel_id in known_person_ids or not crew_tick.present:
                continue
            merged_crew.append(
                {
                    "personnel_id": personnel_id,
                    "name": crew_tick.name or "Unbekannt",
                    "present": True,
                    "on_board": False,
                }
            )
        report.personnel_json = _jsonable_personnel(merged_crew)

    # People on no roster of this station. Replaced wholesale when present, like
    # the extra material: the entries carry no id, so a partial write has nothing
    # to key on, and there is no board state to reconcile against.
    if "extra_personnel" in provided:
        report.extra_personnel_json = (
            normalize_extra_personnel(
                [row.model_dump() for row in payload.extra_personnel] if payload.extra_personnel else []
            )
            or None
        )

    # The head count follows from the two lists above rather than from a keyboard.
    # A value that differs from the board is stored AS corrected — the divergence
    # is itself information, it says the board was behind reality — and one that
    # matches clears the flag again.
    board_personnel = await _board_personnel_count(db, incident.id)
    if report.personnel_json is not None or report.extra_personnel_json:
        counted = derive_personnel_count(
            [dict(row) for row in (report.personnel_json or [])],
            normalize_extra_personnel(report.extra_personnel_json),
        )
        report.personnel_count = counted
        report.personnel_count_corrected = counted != board_personnel
    elif "personnel_count" in provided:
        # A client that still speaks the old shape (a phone replaying a queued
        # payload, the training seeder) keeps working: the number is taken as-is.
        report.personnel_count = payload.personnel_count
        report.personnel_count_corrected = (
            payload.personnel_count is not None and payload.personnel_count != board_personnel
        )

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
        # A rapport filed without the crew touching the vehicle checklist still
        # has to record which vehicles the board had — the all-ticked prefill IS
        # the answer, so it gets frozen into the row rather than staying implicit.
        if report.vehicles_json is None:
            fleet, assigned_vehicle_ids = await _fleet_vehicles(db, incident.id)
            report.vehicles_json = _jsonable_vehicles(reconcile_vehicles(None, fleet, assigned_vehicle_ids))
        # …and the same for the crew, for the same reason: the ticked prefill IS
        # the answer of a crew that read the list and found nothing to correct.
        if report.personnel_json is None:
            roster, assigned_personnel_ids = await _event_personnel(db, incident)
            report.personnel_json = _jsonable_personnel(reconcile_personnel(None, roster, assigned_personnel_ids))
            report.personnel_count = derive_personnel_count(
                [dict(row) for row in report.personnel_json],
                normalize_extra_personnel(report.extra_personnel_json),
            )

    _stamp_updated_by(report, actor)

    await log_action(
        db=db,
        # `rapport_submitted` marks the draft→filed transition and nothing else.
        # The KP mount autosaves with `is_draft: false`, so keying the action on
        # `submitting` alone would write a "Rapport erfasst" journal entry every
        # few seconds while an operator types. Same condition as the
        # notification below, for the same reason.
        action_type="rapport_submitted" if (submitting and was_draft) else "rapport_saved",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        # Deliberately no owner_* and no free text: the audit log is read by
        # everyone with an account, and the owner block is citizen PII (§9).
        changes={
            "is_draft": report.is_draft,
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

    # A Schadenplatz that was never disponiert owes no rapport (§18.27), so it
    # is neither a missing-rapport row nor part of the denominator: "4 von 23"
    # has to count the same population on both sides of the "von", or the
    # sentence quietly lies about how much is left.
    dispatched = await dispatched_incident_ids(db, incidents)
    rapport_relevant = {
        incident.id
        for incident in incidents
        if rapport_applies(dispatched=incident.id in dispatched, has_report=incident.id in reports)
    }

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
        if (report is None or report.is_draft) and incident.id in rapport_relevant:
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

        if report is None or report.is_draft:
            continue
        for raw in report.extra_materials_json or []:
            # "Weiteres gebrauchtes Material" that stayed (§18.35). No assignment
            # exists to cross-check against the board — that is the whole nature
            # of this list — so the crew's word is the only source there is, and
            # it stands until somebody amends the rapport.
            if not isinstance(raw, dict) or not raw.get("left_on_site"):
                continue
            name = str(raw.get("name") or "").strip()
            if not name:
                continue
            material_on_site.append(
                {
                    "incident_id": incident.id,
                    "incident_title": incident.title,
                    "location_address": incident.location_address,
                    "assignment_id": None,
                    "material_id": None,
                    "name": name,
                    "location": None,
                    # There is no assignment to read "seit wann" from, so the
                    # honest answer is when the crew filed the rapport that says
                    # the thing stayed — the moment the board learned of it. The
                    # Restliste only ever reads submitted rapports, so this is
                    # never null in practice.
                    "since": report.submitted_at,
                    "tracked": False,
                }
            )
        if not report.materials_json:
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
        "incident_total": len(rapport_relevant),
        "missing_rapport": missing_rapport,
        "material_on_site": material_on_site,
        "open_pickups": open_pickups,
    }


async def material_return_units(
    db: AsyncSession,
    incident: Incident,
    *,
    include_draft: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """ "Material zurück – freigeben" (decision 17): (returned, left_on_site).

    Consumables are in neither list: a consumable that was used is gone
    (decision 26). Units the board has already released are gone too — there is
    nothing left to free.

    The board does the releasing through the existing per-assignment release.
    `/feld` never writes an assignment, and this function does not either; it
    only says which units the crew did not mark as left on site.

    Each unit carries ``answered``: did the crew settle this one, or is it merely
    in ``returned`` because *vor Ort verblieben* went unticked? The release list
    treats the two the same — a unit nobody claimed is on site is a unit that
    comes back — but the completion gate must not: it prefills from the rapport
    and has to know which questions the crew already settled and which it still
    needs to ask (§18). Since §18.32 that verdict comes from the rapport's state
    rather than from a third value in the row (see below).

    **``include_draft`` — two callers, two different actions (§18.23).** One
    function, and until the field test one rule, which was wrong for exactly one
    of them:

    * **The release list** in the incident detail stays submitted-only, the
      default. One click there *releases assignments* — it frees a pump against
      a checklist. Doing that off a half-typed draft is how a pump gets freed
      while it is still running in a cellar, so the strong action keeps the
      strict rule and cannot reach a draft by accident.
    * **The completion gate** passes ``include_draft=True``. It only *prefills*
      a dialog the operator still confirms, and the thing being fixed is that a
      crew which filled the checklist and never pressed *Rapport abschliessen*
      had its answers thrown away and its operator asked the same question from
      scratch. On `/feld` the submit is a manual tap on a phone in the rain;
      "they typed it but did not file it" is the normal case, not the edge one.
      The caller renders the attribution as *Rapport-Entwurf* so an operator can
      weigh a half-finished answer — see ``material_return_attribution``.

    Nothing is auto-applied either way. The operator's click is still what
    decides, which is what makes the looser rule safe on that call site.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    if report is None or (report.is_draft and not include_draft):
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
            # "Did the crew settle this unit?" Since §18.32 removed the
            # three-state `used`, an untouched material row is no longer
            # distinguishable from a deliberate "ja, gebraucht" — so the honest
            # answer comes from the rapport's own state instead of from the row:
            # a **filed** rapport settled every unit on its checklist (that is
            # what filing means), a **draft** settled only the ones where the
            # crew contradicted the defaults. The gate never auto-applies
            # anything either way; it only decides which rows arrive prefilled.
            "answered": not report.is_draft or _is_answered(row),
        }
        (left if row["left_on_site"] else returned).append(unit)
    return returned, left


async def material_left_on_site_named(
    db: AsyncSession,
    incident: Incident,
    *,
    include_draft: bool = False,
) -> list[str]:
    """The "Weiteres Material" the crew left at the address, by name (§18.35).

    Deliberately NOT part of ``material_return_units``: nothing here can be
    released, because nothing here is an assignment. The release list still
    *shows* these names — an operator who has just freed four pumps must not
    read the empty rest of the dialog as "the address is clear" — and the
    Abholliste is what actually sends somebody to fetch them.

    ``include_draft`` mirrors the two functions next to it so a call site cannot
    accidentally mix a filed rapport's units with a draft's names.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    if report is None or (report.is_draft and not include_draft):
        return []
    return [row["name"] for row in normalize_extra_materials(report.extra_materials_json) if row["left_on_site"]]


async def material_return_attribution(
    db: AsyncSession,
    incident: Incident,
    *,
    include_draft: bool = False,
) -> tuple[str | None, datetime | None, bool]:
    """Who filed the rapport the material answers come from, when, and whether
    it is still a draft.

    The completion gate says "Aus dem Rapport von Muster Hans" over the answers
    it prefilled. Without the name the operator sees a dialog that decided by
    itself; with it, they know whose word they are confirming — and whether to
    trust it, which is the whole reason the provenance columns exist.

    The third element is what keeps that honest once drafts prefill too
    (§18.23): a half-finished checklist must not be quoted as a filed rapport,
    so the caller says *Rapport-Entwurf* instead. ``include_draft`` mirrors
    ``material_return_units`` exactly — the two are always called as a pair, or
    the gate would show answers with no name over them.

    The *last* editor rather than the creator: several crews amend one report,
    and the material checklist is whatever the most recent one left behind.
    Falls back to the creator when nobody has amended it.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    if report is None or (report.is_draft and not include_draft):
        return None, None, False
    names = await _names(db, report)
    return names["updated_by_name"] or names["created_by_name"], report.submitted_at, report.is_draft
