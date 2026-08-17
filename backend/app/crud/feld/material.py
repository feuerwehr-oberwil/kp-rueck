"""Die Restliste — what is still out there, and who takes it back.

Reads across the whole Ereignis rather than one Schadenplatz: material left on
site, return units, and the attribution that says which crew owes which item.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import false as sa_false
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import (
    Incident,
    IncidentAssignment,
    Material,
    SchadenplatzReport,
)
from ...services.incident_dispatch import dispatched_incident_ids, rapport_applies
from .rapport import _board_material_units, _is_answered, _names, normalize_extra_materials, reconcile_materials
from .visibility import _rapport_state

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


async def material_overview(db: AsyncSession, event_id: uuid.UUID) -> list[dict[str, Any]]:
    """Every material in the station, and where it is right now.

    The Magazin person's own view (plan 26). They used to be handed the list of
    *Schadenplätze* their material happened to be attached to, which answers the
    wrong question — they are looking after the material, not the incidents, and
    "wo ist die zweite Tauchpumpe?" was unanswerable from a list of addresses.

    Three states, and they come from two different authorities:

    * ``out``  — an open assignment on a Schadenplatz. The *board* says so, and
      the board is the authority on where a unit is.
    * ``left`` — the crew's rapport says it stayed behind and there is no
      assignment to cross-check against (§18.35). Their word is the only source
      there is, so it is shown as its own state rather than folded into ``out``.
    * ``in``   — neither: it is in the Magazin.

    Sorted by name, because this list is read to find one thing.
    """
    open_rows = await db.execute(
        select(Material, Incident, IncidentAssignment.assigned_at)
        .join(IncidentAssignment, IncidentAssignment.resource_id == Material.id)
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
            IncidentAssignment.resource_type == "material",
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    out_by_material: dict[uuid.UUID, tuple[Incident, datetime | None]] = {}
    for material, incident, assigned_at in open_rows.all():
        out_by_material[material.id] = (incident, assigned_at)

    all_materials = await db.execute(select(Material).order_by(Material.name))
    items: list[dict[str, Any]] = []
    for material in all_materials.scalars().all():
        placed = out_by_material.get(material.id)
        items.append(
            {
                "material_id": material.id,
                "name": material.name,
                "home_location": material.location or None,
                "incident_id": placed[0].id if placed else None,
                "at": (placed[0].location_address or placed[0].title) if placed else None,
                "since": placed[1] if placed else None,
                "state": "out" if placed else "in",
            }
        )

    # Consumables and anything else a crew wrote into "weiteres gebrauchtes
    # Material" and left behind. These have no Material row at all — that is the
    # nature of the field, and why the Restliste carries them separately too.
    restliste = await event_restliste(db, event_id)
    for row in restliste["material_on_site"]:
        if row.get("material_id") is not None:
            continue
        items.append(
            {
                "material_id": None,
                "name": row["name"],
                "home_location": None,
                "incident_id": row["incident_id"],
                "at": row.get("location_address") or row.get("incident_title"),
                "since": None,
                "state": "left",
            }
        )

    items.sort(key=lambda item: item["name"].lower())
    return items
