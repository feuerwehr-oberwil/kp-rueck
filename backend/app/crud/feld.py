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
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, IncidentAssignment, Personnel, SchadenplatzReport
from ..services.incident_leader import effective_leader_id

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
