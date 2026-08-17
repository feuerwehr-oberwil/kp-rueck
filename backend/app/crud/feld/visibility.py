"""Who may see which Schadenplatz — step 2 of the `/feld` authorization.

The event token (step 1) only says *which Ereignis*; it never says *who*.
Visibility is "only mine" (decision 4) and it is enforced here, server-side,
never in the UI.

**"Mine" is a union of four sources** (plan 26 §2.2), because the original rule —
"you hold a personnel row on this incident" — could not see the people this
surface now exists for. A driver holds no such row: the *vehicle* is assigned and
``event_special_functions`` says who drives it. A Magazin person is assigned to
nothing at all.

    crew     a personal assignment with purpose='crew', active **or released**
    reko     a personal assignment with purpose='reko', active **or released**
    driver   a vehicle this person drives, **while** it is assigned
    magazin  any Schadenplatz with material still out, read-only

Released rows count for crew and reko on purpose, because the rapport is filed
*after* the crew leaves; requiring ``unassigned_at IS NULL`` would lock out
exactly the moment the form is for. Driver rows are the opposite: the row exists
because the vehicle is there, and when the vehicle is released the driver owes
nothing and the row goes (decision 11).

A resource can also be assigned to a whole **Auftrag** instead of to each stop,
and those rows are released only when its last stop closes. ``is_active`` there
is per stop and reads the incident's own status — see the route block below.

**Only `crew` can owe a Schadenplatz-Rapport.** Not the driver who parked
outside, not the trupp that only recced the place. That is why ``purpose`` exists
on the assignment at all, and it is enforced here rather than hidden in the UI.

Every endpoint mounts on ``person_has_event_access`` / ``get_authorized_incident``;
adding one without either is the hole this module exists to prevent.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import (
    EventAttendance,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    Personnel,
    RekoReport,
    SchadenplatzReport,
    Vehicle,
)
from ...services.incident_dispatch import dispatched_incident_ids, rapport_applies
from ...services.incident_leader import effective_leader_id
from .reports import is_automation_user

# ============================================
# Authorization — step 2
# ============================================

#: The four ways a Schadenplatz can be "mine", strongest claim first. Order is
#: load-bearing: when one person reaches the same incident through several
#: sources, the strongest wins, so somebody who is crew *and* drives the TLF is
#: crew — and still owes the Rapport.
SOURCE_CREW = "crew"
SOURCE_REKO = "reko"
SOURCE_DRIVER = "driver"
SOURCE_MAGAZIN = "magazin"
SOURCE_PRECEDENCE = (SOURCE_CREW, SOURCE_REKO, SOURCE_DRIVER, SOURCE_MAGAZIN)

#: Sources whose holder is expected to file the Schadenplatz-Rapport. Exactly
#: one, and it is a tuple rather than an ``== SOURCE_CREW`` so that the day a
#: second one qualifies, there is one place to add it.
RAPPORT_SOURCES = (SOURCE_CREW,)

#: Who may stamp "Angekommen": whoever actually drives out to the place. A Reko
#: trupp arrives at a Schadenplatz exactly like a crew does.
ARRIVAL_SOURCES = (SOURCE_CREW, SOURCE_REKO)

#: Who may end the Einsatz or ask for an Abholung — the people doing the work.
#: A Reko trupp reports what it saw and leaves; it does not close the job, and
#: it has no material to be collected.
WORK_SOURCES = (SOURCE_CREW,)


@dataclass(frozen=True, slots=True)
class FeldSource:
    """Why this person may see this Schadenplatz, and whether it is still live.

    ``vehicle_name`` is set only for ``driver`` rows — it is what lets the field
    surface say *"Als Fahrer · TLF 1"* instead of leaving somebody to wonder why
    an incident they were never assigned to is in their list.
    """

    kind: str
    is_active: bool
    vehicle_name: str | None = None

    @property
    def owes_rapport(self) -> bool:
        return self.kind in RAPPORT_SOURCES


async def visible_by_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
) -> dict[uuid.UUID, dict[uuid.UUID, FeldSource]]:
    """The union rule for the whole event: person → {incident: why}.

    **The single place the four sources are resolved.** Every read and every
    authorization check goes through it — the picker needs it for everybody at
    once, and a second, single-person implementation is exactly how two copies
    of an authorization rule drift apart until one of them leaks.

    Five queries for the entire Ereignis regardless of how many people are in
    it, which is why the single-person helper below can afford to call this and
    index into the result rather than keeping its own narrower query.
    """
    incidents = await _event_incidents(db, event_id)
    if not incidents:
        return {}
    incident_ids = list(incidents)
    out: dict[uuid.UUID, dict[uuid.UUID, FeldSource]] = {}

    def offer(
        person_id: uuid.UUID,
        incident_id: uuid.UUID,
        kind: str,
        is_active: bool,
        vehicle_name: str | None = None,
    ) -> None:
        """Record a claim, keeping the strongest one per (person, incident)."""
        if incident_id not in incidents:
            return
        mine = out.setdefault(person_id, {})
        current = mine.get(incident_id)
        if current is None or SOURCE_PRECEDENCE.index(kind) < SOURCE_PRECEDENCE.index(current.kind):
            mine[incident_id] = FeldSource(kind, is_active, vehicle_name)
        elif current.kind == kind and is_active and not current.is_active:
            # Same source twice — assigned, released, re-assigned. Active wins.
            mine[incident_id] = FeldSource(kind, True, vehicle_name or current.vehicle_name)

    # Who is a Reko person in this Ereignis at all. Needed as a *fallback* below,
    # not as the rule — see the loop.
    reko_people = await db.execute(
        select(EventSpecialFunction.personnel_id).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    reko_person_ids = {row[0] for row in reko_people.all()}

    # ── crew + reko: personal assignments, active or released ──────────────
    personal = await db.execute(
        select(
            IncidentAssignment.resource_id,
            IncidentAssignment.incident_id,
            IncidentAssignment.unassigned_at,
            IncidentAssignment.purpose,
        ).where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
        )
    )
    for person_id, incident_id, unassigned_at, purpose in personal.all():
        # `purpose` is the authoritative signal — it says why THIS row exists.
        #
        # The fallback matters because the board has a second, older signal: the
        # event-wide `reko` function. Rows written before `purpose` existed (and
        # any written by a path that forgets to set it) carry the default 'crew'
        # while the board still draws that person as the Reko — two rules for one
        # question, and the field surface losing the argument means a Reko trupp
        # is handed the working crew's page.
        #
        # Reading the function as reko closes that. The cost is that a Reko
        # person's *crew* work elsewhere in the same Ereignis also reads as reko
        # and is never asked for a Rapport — accepted deliberately, because a
        # person doing both in one Ereignis is vanishingly rare and the board
        # already treats the two as separate roles.
        is_reko = purpose == SOURCE_REKO or person_id in reko_person_ids
        offer(person_id, incident_id, SOURCE_REKO if is_reko else SOURCE_CREW, unassigned_at is None)

    # ── crew via the ROUTE: an Auftrag owns its resources ──────────────────
    #
    # `IncidentGroupAssignment` says resources belong to the Auftrag and are
    # shared across all of its stops, which is how a storm night is actually
    # run — the KP assigns the squad to the route, not to each tree. Until this
    # existed here, every one of those crews was invisible on `/feld`: they hold
    # no personnel row on any stop, exactly like a driver holds none at all.
    route_rows = await db.execute(
        select(
            IncidentGroupAssignment.resource_id,
            IncidentGroupAssignment.resource_type,
            IncidentGroupAssignment.unassigned_at,
            Incident.id,
        )
        .join(Incident, Incident.group_id == IncidentGroupAssignment.incident_group_id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    driven_by_route: dict[uuid.UUID, list[tuple[uuid.UUID, bool]]] = {}
    for resource_id, resource_type, unassigned_at, incident_id in route_rows.all():
        incident = incidents.get(incident_id)
        if incident is None:
            continue
        # **A closed stop is not live work, even while the route still is.**
        #
        # Route resources are released only when the Auftrag's LAST stop
        # completes (`auto_release_group_resources_if_last_stop`) — correctly,
        # the squad is still driving. But `is_active` answers a different
        # question, "is this Schadenplatz still mine to work", and reading it
        # off the route assignment alone froze every closed stop as the job in
        # hand: the KP set it to «beendet» and the crew's and the driver's
        # phones went on showing it at the top of the feed, indefinitely. The
        # field surface shows no Schadenplatz-Status by design, so this flag is
        # the whole of what tells them — it is what moves the row under
        # «Früher» with «Nicht mehr zugeteilt».
        #
        # The row itself STAYS: the crew still owes it a Rapport, which is
        # filed after they leave, and the per-incident path keeps released crew
        # rows for exactly that reason.
        still_live = unassigned_at is None and incident.status != "complete"
        if resource_type == "personnel":
            offer(resource_id, incident_id, SOURCE_CREW, still_live)
        elif resource_type == "vehicle" and unassigned_at is None:
            driven_by_route.setdefault(resource_id, []).append((incident_id, still_live))

    # ── driver: vehicles they drive, only while those are assigned ─────────
    driven = await db.execute(
        select(EventSpecialFunction.personnel_id, EventSpecialFunction.vehicle_id).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "driver",
            EventSpecialFunction.vehicle_id.is_not(None),
        )
    )
    drivers_of: dict[uuid.UUID, list[uuid.UUID]] = {}
    for person_id, vehicle_id in driven.all():
        drivers_of.setdefault(vehicle_id, []).append(person_id)

    if drivers_of:
        vehicle_rows = await db.execute(
            select(IncidentAssignment.incident_id, IncidentAssignment.resource_id, Vehicle.name)
            .join(Vehicle, Vehicle.id == IncidentAssignment.resource_id)
            .where(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.resource_type == "vehicle",
                IncidentAssignment.resource_id.in_(list(drivers_of)),
                # Active only — decision 11. A released vehicle takes its
                # driver's row with it, because the driver owes nothing after.
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        for incident_id, vehicle_id, vehicle_name in vehicle_rows.all():
            for person_id in drivers_of.get(vehicle_id, []):
                offer(person_id, incident_id, SOURCE_DRIVER, True, vehicle_name)

        # ...and a vehicle assigned to the ROUTE drives every stop on it.
        names = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(list(drivers_of))))
        vehicle_names = {row[0]: row[1] for row in names.all()}
        for vehicle_id, stops in driven_by_route.items():
            for person_id in drivers_of.get(vehicle_id, []):
                for incident_id, still_live in stops:
                    offer(person_id, incident_id, SOURCE_DRIVER, still_live, vehicle_names.get(vehicle_id))

    # ── magazin: wherever material is still out ────────────────────────────
    magazin_rows = await db.execute(
        select(EventSpecialFunction.personnel_id).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "magazin",
        )
    )
    magazin_ids = [row[0] for row in magazin_rows.all()]
    if magazin_ids:
        material_rows = await db.execute(
            select(IncidentAssignment.incident_id)
            .where(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.resource_type == "material",
                IncidentAssignment.unassigned_at.is_(None),
            )
            .distinct()
        )
        material_incidents = [row[0] for row in material_rows.all()]
        for person_id in magazin_ids:
            for incident_id in material_incidents:
                offer(person_id, incident_id, SOURCE_MAGAZIN, True)

    return out


async def functions_for_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[str]:
    """Which roles this person holds in this Ereignis.

    The field page shows a section per role (plan 26, decision 5: the roles are
    data, the sections are code), so it has to know which ones apply before it
    can decide what to render. Names only — this grants nothing on its own, and
    every actual permission still goes through the visibility union.
    """
    result = await db.execute(
        select(EventSpecialFunction.function_type).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == personnel_id,
        )
    )
    return sorted({row[0] for row in result.all()})


async def driver_vehicle_names(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[str]:
    """The vehicles this person drives in this Ereignis, by name.

    `functions_for_personnel` answers "is this person a driver" and that is not
    enough for the page to say anything useful: a driver whose vehicle has not
    been disponiert yet has an EMPTY list of Schadenplätze, and the generic
    "melde dich beim KP" underneath it reads as "we have no idea who you are" to
    the one person who was given a specific job an hour ago. Naming the vehicle
    turns that screen into "du fährst das TLF 1 — sobald es losgeht, steht es
    hier", which is the truth.
    """
    result = await db.execute(
        select(Vehicle.name)
        .join(EventSpecialFunction, EventSpecialFunction.vehicle_id == Vehicle.id)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == personnel_id,
            EventSpecialFunction.function_type == "driver",
        )
        .order_by(Vehicle.display_order, Vehicle.name)
    )
    return [row[0] for row in result.all()]


async def visible_incidents_for_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> dict[uuid.UUID, FeldSource]:
    """Every Schadenplatz of this event that is this person's, and why."""
    return (await visible_by_personnel(db, event_id)).get(personnel_id, {})


async def person_has_event_access(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> bool:
    """Can this person see ANYTHING in this event?

    The incident-less form of step 2, for endpoints scoped to a person rather
    than to one Schadenplatz. Any of the four sources counts.
    """
    return bool(await visible_incidents_for_personnel(db, event_id, personnel_id))


async def get_authorized_incident(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    incident_id: uuid.UUID,
    *,
    sources: tuple[str, ...] | None = None,
) -> Incident | None:
    """The incident, if this person may reach it through a `/feld` token.

    Returns None when the incident is not in this event, is deleted, or none of
    the four sources gives this person a claim on it. The caller turns None into
    a 403 — never into an empty 200, which would leak that the incident exists.

    ``sources`` narrows the door for writes that only one kind of holder may
    make: the Schadenplatz-Rapport passes ``RAPPORT_SOURCES`` so that a driver
    or a Reko trupp cannot file one even by calling the endpoint directly.
    Hiding the section in the UI is presentation; this is the rule.
    """
    visible = await visible_incidents_for_personnel(db, event_id, personnel_id)
    source = visible.get(incident_id)
    if source is None or (sources is not None and source.kind not in sources):
        return None
    return await db.get(Incident, incident_id)


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

    The Auftrag's leader leads every stop on it. A squad the KP put on the route
    holds no row on any stop, so their Einsatzleiter was nowhere to be found and
    each stop read "kein EL erfasst" — to the crew he was standing with.
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

    # The Auftrag's leader, read in as each stop's own.
    group_of = dict(
        (
            await db.execute(
                select(Incident.id, Incident.group_id).where(
                    Incident.id.in_(incident_ids), Incident.group_id.is_not(None)
                )
            )
        ).all()
    )
    if group_of:
        route_leaders = await db.execute(
            select(
                IncidentGroupAssignment.incident_group_id,
                IncidentGroupAssignment.resource_id,
            ).where(
                IncidentGroupAssignment.incident_group_id.in_(set(group_of.values())),
                IncidentGroupAssignment.resource_type == "personnel",
                IncidentGroupAssignment.unassigned_at.is_(None),
                IncidentGroupAssignment.is_leader.is_(True),
            )
        )
        by_group: dict[uuid.UUID, set[uuid.UUID]] = {}
        for group_id, personnel_id in route_leaders.all():
            by_group.setdefault(group_id, set()).add(personnel_id)
        for incident_id, group_id in group_of.items():
            if group_id in by_group:
                active.setdefault(incident_id, set()).update(by_group[group_id])

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
    """The `/feld` person picker: everyone this event has something for.

    Deliberately NOT the roster. Someone the event holds nothing for has nothing
    to do here, and putting them in the list would hand them an empty page
    instead of the sentence that explains why (§5.2).

    Since plan 26 that is broader than "has an assignment": drivers and Magazin
    people belong in the picker too, and neither holds a personnel row. They
    were precisely the people the old query could not see.
    """
    incidents = await _event_incidents(db, event_id)
    incident_ids = list(incidents)
    if not incident_ids:
        return []

    visible = await visible_by_personnel(db, event_id)

    # The roster, not just the people with work (plan 26, decision 10).
    #
    # This used to be "everyone with an assignment", on the grounds that handing
    # somebody an empty page was worse than leaving them out of the list. That
    # held while the page could only show Schadenplätze. It stopped holding when
    # attendance moved in: a person the Ereignis holds nothing for now gets
    # "eingecheckt · noch kein Auftrag", which answers the most common question
    # in the field — do they even know I am here — instead of nothing at all.
    personnel_result = await db.execute(select(Personnel))
    personnel = list(personnel_result.scalars().all())

    attendance_result = await db.execute(
        select(EventAttendance.personnel_id, EventAttendance.checked_in).where(EventAttendance.event_id == event_id)
    )
    attendance = {row[0]: bool(row[1]) for row in attendance_result.all()}

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

    rows = []
    for person in personnel:
        sources = visible.get(person.id, {})
        # Only crew rows can owe a Rapport (decision 11). Counting a driver's or
        # a Reko trupp's Schadenplätze here would put a number on the picker
        # that the person cannot act on when they open it.
        rapport_candidates = {incident_id for incident_id, source in sources.items() if source.owes_rapport}
        rows.append(
            {
                "personnel_id": person.id,
                "name": person.name,
                "role": person.role,
                "incident_count": len(sources),
                "open_count": sum(1 for source in sources.values() if source.is_active),
                "missing_rapport_count": len(rapport_candidates & owes_rapport),
                "checked_in": attendance.get(person.id, False),
            }
        )
    # Alphabetical: this is a picker people scan for their own name, not a
    # workload ranking.
    rows.sort(key=lambda row: str(row["name"]).casefold())
    return rows


async def _briefings(
    db: AsyncSession,
    event_id: uuid.UUID,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, Any]]:
    """What the board knows about these Schadenplätze, batched (§18.22).

    Crew, vehicles and material per incident in **four** queries for the whole
    list, not four per row: a storm night is forty Schadenplätze and this
    response is refetched on every window focus.

    Released rows are included, deliberately — see ``FeldAssignment``. The unit
    of a material line is its NAME: two identical pumps are "Tauchpumpe ×2",
    because a crew reads a slip, not an assignment table.

    **Route-level resources count as this stop's.** An Auftrag owns its
    resources and shares them across every stop, so a squad the KP put on the
    route holds no row on any of them — and a briefing built from per-incident
    rows alone showed those crews an empty one: no colleagues, no vehicle, on
    the very Schadenplatz they were standing on. The fourth query folds the
    Auftrag's resources into each of its stops, which is what the Auftrag says
    they are.
    """
    briefings: dict[uuid.UUID, dict[str, Any]] = {
        incident_id: {"crew": [], "vehicles": [], "materials": []} for incident_id in incident_ids
    }
    if not incident_ids:
        return briefings

    # Which of these stops belong to an Auftrag, so its resources can be read
    # in as theirs. Only active route rows: a released one is a resource the
    # board has taken off the whole route.
    group_of = dict(
        (
            await db.execute(
                select(Incident.id, Incident.group_id).where(
                    Incident.id.in_(incident_ids), Incident.group_id.is_not(None)
                )
            )
        ).all()
    )
    # Who drives what, for this Ereignis. One query for the whole fleet: the
    # driver is set per event (`EventSpecialFunction`), not per Schadenplatz.
    driver_rows = await db.execute(
        select(EventSpecialFunction.vehicle_id, Personnel.name)
        .join(Personnel, Personnel.id == EventSpecialFunction.personnel_id)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "driver",
            EventSpecialFunction.vehicle_id.is_not(None),
        )
    )
    drivers: dict[uuid.UUID, str] = dict(driver_rows.all())

    route: dict[uuid.UUID, dict[str, list[Any]]] = {}
    if group_of:
        route_result = await db.execute(
            select(
                IncidentGroupAssignment.incident_group_id,
                IncidentGroupAssignment.resource_type,
                IncidentGroupAssignment.resource_id,
                Personnel.name,
                Vehicle.name,
                Material.name,
            )
            .outerjoin(
                Personnel,
                and_(
                    Personnel.id == IncidentGroupAssignment.resource_id,
                    IncidentGroupAssignment.resource_type == "personnel",
                ),
            )
            .outerjoin(
                Vehicle,
                and_(
                    Vehicle.id == IncidentGroupAssignment.resource_id,
                    IncidentGroupAssignment.resource_type == "vehicle",
                ),
            )
            .outerjoin(
                Material,
                and_(
                    Material.id == IncidentGroupAssignment.resource_id,
                    IncidentGroupAssignment.resource_type == "material",
                ),
            )
            .where(
                IncidentGroupAssignment.incident_group_id.in_(set(group_of.values())),
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
        for (
            group_id,
            resource_type,
            resource_id,
            person_name,
            vehicle_name,
            material_name,
        ) in route_result.all():
            bucket = route.setdefault(group_id, {"crew": [], "vehicles": [], "materials": []})
            name = {"personnel": person_name, "vehicle": vehicle_name, "material": material_name}.get(resource_type)
            if not name:
                continue
            key = {"personnel": "crew", "vehicle": "vehicles", "material": "materials"}[resource_type]
            bucket[key].append(
                # `via_auftrag` is what makes "kommt das mit?" answerable: this
                # row belongs to the ROUTE and is therefore on every stop of it.
                #
                # `stays` stays None: an Auftrag has no driver-stay toggle
                # (`GroupAssignmentUpdate` is `is_leader` and nothing else), so
                # the column here is a copy nobody can correct. Saying «fährt
                # zurück» on that basis would be the board answering a question
                # it was never asked — see `FeldVehicleLine`.
                {
                    "name": name,
                    "driver": drivers.get(resource_id),
                    "stays": None,
                    "via_auftrag": True,
                }
                if resource_type == "vehicle"
                else name
            )

    crew_result = await db.execute(
        select(IncidentAssignment.incident_id, Personnel.id, Personnel.name)
        .join(Personnel, Personnel.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
        )
        .order_by(Personnel.name)
    )
    for incident_id, group_id in group_of.items():
        shared = route.get(group_id)
        if not shared:
            continue
        briefings[incident_id]["crew"].extend(shared["crew"])
        briefings[incident_id]["vehicles"].extend(shared["vehicles"])

    seen_crew: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for incident_id, personnel_id, name in crew_result.all():
        # One person can hold several rows on one incident (assigned, released,
        # re-assigned) and is still one person on the slip.
        if (incident_id, personnel_id) in seen_crew:
            continue
        seen_crew.add((incident_id, personnel_id))
        # A resource can sit at both levels — `_mirror` puts it there on purpose
        # (crud/feld/melden.py). One person is one line on the slip either way.
        if name not in briefings[incident_id]["crew"]:
            briefings[incident_id]["crew"].append(name)

    vehicle_result = await db.execute(
        select(IncidentAssignment.incident_id, Vehicle.id, Vehicle.name, IncidentAssignment.driver_stay)
        .join(Vehicle, Vehicle.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "vehicle",
        )
        .order_by(Vehicle.display_order, Vehicle.name)
    )
    seen_vehicles: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for incident_id, vehicle_id, name, driver_stay in vehicle_result.all():
        if (incident_id, vehicle_id) in seen_vehicles:
            continue
        seen_vehicles.add((incident_id, vehicle_id))
        # A resource can sit at both levels (`_mirror`); one vehicle is one line.
        # The route's copy wins when there is one — it is the truthful answer to
        # "does this come with us to the next stop".
        if not any(line["name"] == name for line in briefings[incident_id]["vehicles"]):
            briefings[incident_id]["vehicles"].append(
                {
                    "name": name,
                    "driver": drivers.get(vehicle_id),
                    "stays": bool(driver_stay),
                    "via_auftrag": False,
                }
            )

    material_result = await db.execute(
        select(IncidentAssignment.incident_id, Material.name)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "material",
        )
        .order_by(Material.location_sort_order, Material.location, Material.name)
    )
    material_pairs = [(incident_id, name) for incident_id, name in material_result.all()]
    for incident_id, group_id in group_of.items():
        for name in route.get(group_id, {}).get("materials", []):
            material_pairs.append((incident_id, name))
    for incident_id, name in material_pairs:
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
    """ "Meine Einsatzstellen" — every Schadenplatz this event holds for them.

    Released crew and Reko assignments stay in the list (decision 4 / §2): the
    rapport is filed after the crew leaves, so dropping them would hide exactly
    the rows the page exists for. Driver rows behave the other way round and
    disappear with their vehicle — see the module docstring.

    Each row carries the ``source`` that put it there, because the field surface
    has to be able to say *why* an incident nobody assigned you to is in your
    list, and because only a ``crew`` row may be asked for a Rapport.
    """
    incidents = await _event_incidents(db, event_id)
    incident_ids = list(incidents)
    if not incident_ids:
        return []

    mine_sources = await visible_incidents_for_personnel(db, event_id, personnel_id)
    if not mine_sources:
        return []
    mine = {incident_id: source.is_active for incident_id, source in mine_sources.items()}

    mine_ids = list(mine)
    reports = await _rapport_states(db, mine_ids)
    # No rapport before the Schadenplatz was disponiert (§18.27) — one query for
    # the whole list, so a crew with fourteen rows still costs one round trip.
    dispatched = await dispatched_incident_ids(db, [incidents[incident_id] for incident_id in mine_ids])
    leaders = await get_incident_leaders(db, mine_ids)
    # The Auftrag each stop belongs to. A route-assigned crew holds no row on
    # any stop, so without the name their Schadenplätze look like unrelated
    # jobs — and the order is the whole point of grouping them.
    group_rows = await db.execute(
        select(IncidentGroup.id, IncidentGroup.name).where(
            IncidentGroup.id.in_({incidents[i].group_id for i in mine_ids if incidents[i].group_id})
        )
    )
    group_names = {row[0]: row[1] for row in group_rows.all()}
    briefings = await _briefings(db, event_id, mine_ids)
    rekos = await _reko_briefings(db, mine_ids)

    rows: list[dict[str, Any]] = []
    for incident_id, is_active in mine.items():
        incident = incidents[incident_id]
        report = reports.get(incident_id)
        leader = leaders.get(incident_id)
        briefing = briefings.get(incident_id, {})
        source = mine_sources[incident_id]
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
                # Why this row is here: "crew" | "reko" | "driver" | "magazin".
                # The phone labels only the unusual ones — an own assignment
                # needs no explanation, its absence is the explanation.
                "source": source.kind,
                "source_vehicle": source.vehicle_name,
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
                "group_id": incident.group_id,
                "group_name": group_names.get(incident.group_id) if incident.group_id else None,
                "group_position": incident.group_position if incident.group_id else None,
                # Sort-only, stripped below. "Owes a rapport" rather than "has
                # none": a Schadenplatz that was never disponiert owes nothing,
                # so it must not be sorted up as if it were the crew's homework.
                # Nor does one somebody only drove to or recced — that is what
                # `source.owes_rapport` is guarding (decision 11).
                "_owes_rapport": source.owes_rapport
                and _rapport_state(report) != "submitted"
                and rapport_applies(dispatched=incident_id in dispatched, has_report=report is not None),
                "_position": incident.position,
                "_created_at": incident.created_at,
            }
        )

    # Where each Auftrag sits in the list: at its earliest stop.
    #
    # Without this, the stops of one route sorted by their own kanban position —
    # which is where the operator happened to drop each card in its status
    # column, and has nothing to do with the order they are to be driven in.
    # A crew read «Stopp 2» above «Stopp 1» and the numbers were the only thing
    # saying otherwise. The route order IS the reason the KP grouped them.
    group_rank: dict[uuid.UUID, int] = {}
    for row in rows:
        group_id = row["group_id"]
        if group_id is None:
            continue
        group_rank[group_id] = min(group_rank.get(group_id, row["_position"]), row["_position"])

    # Same priority order the operator arranged on the board: still-assigned
    # first, then the ones still missing a rapport, then the kanban order — with
    # a whole Auftrag travelling as one block, internally in route order.
    rows.sort(
        key=lambda row: (
            not row["is_active_assignment"],
            not row["_owes_rapport"],
            group_rank[row["group_id"]] if row["group_id"] in group_rank else row["_position"],
            row["group_position"] if row["group_id"] else 0,
            row["_position"],
            row["_created_at"],
        )
    )
    for row in rows:
        row.pop("_owes_rapport", None)
        row.pop("_position", None)
        row.pop("_created_at", None)

    return rows
