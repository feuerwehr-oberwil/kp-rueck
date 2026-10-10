"""A merge takes the losing card's WORK along (owner decision 10.10.2026).

Until now only a fresh report («Eingegangen», nobody on it) could be merged. The
owner's call: ANY OPEN card can be merged; what was done on it moves to the card
that stays, and «Trennen» moves it back. Closed cards stay out of it, on both
sides.

What moves (requests from the field and their bells: ``merge_requests``):

* **Assignments** — crew, vehicles, material, Reko trupps; active and released
  rows alike, so «Bisher im Einsatz» and the Rapport's checklists see the whole
  history. A resource ACTIVE ON BOTH cards keeps the surviving card's row; the
  losing card's row is released by the merge (audited) and stays on its own
  card, where «Trennen» reopens it if the resource is still on the surviving
  card. Einsatzleiter: the surviving card's leader stays; the losing card's
  leader carries the role over only when the surviving card had none.
* **Reko reports** — all of them, with their photos (files are COPIED into the
  surviving card's folder; nothing is deleted).
* **Schadenplatz-Rapport** — one per Einsatz (database constraint). If the
  surviving card has none, the losing card's moves (with its photos). If both
  have one, the losing card's stays attached to its own (hidden) row and the
  event report prints it under the surviving card as «Rapport von #7
  (zusammengeführt)» — nothing is dropped, nothing is overwritten.
* **KP messages to the crew** (``incident_field_messages``).
* **Flags** — Nachbarhilfe, Am Warten, Zu Fuss: set on the surviving card when
  the losing card had them; two notes are joined («… + …»).
* **Status** — the surviving card keeps its status unless the losing card is
  further along (incoming → reko → reko_done → enroute → active → returning):
  when crew that is already on site moves over, the card it moves to must not
  claim nobody has been sent. Raised only, written as a status transition, and
  put back by «Trennen» if nobody changed it since.
* **Einsatz number** — the losing card keeps its number on its hidden row:
  retired while merged (never reused, per the numbering trigger), back on the
  board with «Trennen».

«Einsatz beendet» from the field (``field_complete_reported_at``) does not
move: it is the crew closing THAT card, not a fact about the surviving one.

The merge audit row records ids and which branch applied — no names, notes or
phone numbers; «Trennen» reads the rest off the two cards.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from .audit import log_action
from .photo_storage import photo_storage

#: The order an Einsatz goes through. A merge never lowers the surviving card's
#: place in it; «complete» is not here because closed cards cannot be merged.
STATUS_ORDER: tuple[str, ...] = ("incoming", "reko", "reko_done", "enroute", "active", "returning")

ITEMS_MOVED_ACTION = "merge_items_moved"

#: Flag + note pairs that travel with a merge.
FLAG_NOTES: tuple[tuple[str, str | None], ...] = (
    ("nachbarhilfe", "nachbarhilfe_note"),
    ("am_warten", "am_warten_note"),
    ("zu_fuss", None),
)
NOTE_JOIN = " + "


def _rank(status: str) -> int:
    return STATUS_ORDER.index(status) if status in STATUS_ORDER else -1


async def _names(db: AsyncSession, rows: list[models.IncidentAssignment]) -> list[str]:
    """Readable names for the journal line («TLF 1, Meier Hans, Tauchpumpe»)."""
    out: list[str] = []
    for resource_type, model in (
        ("vehicle", models.Vehicle),
        ("personnel", models.Personnel),
        ("material", models.Material),
    ):
        ids = [r.resource_id for r in rows if r.resource_type == resource_type]
        if not ids:
            continue
        result = await db.execute(select(model.name).where(model.id.in_(ids)).order_by(model.name))
        out.extend(name for (name,) in result.all())
    return out


async def move_work_in(
    db: AsyncSession,
    *,
    report: models.Incident,
    target: models.Incident,
    user: models.User | None,
    request: Request | None = None,
) -> dict[str, Any]:
    """Move the losing card's work onto the surviving card. Flushes; caller commits.

    Both rows are locked by the caller. Returns what «Trennen» needs (ids and
    branches only) for the merge audit row.
    """
    now = datetime.now(UTC)
    items: list[str] = []

    # ── assignments ─────────────────────────────────────────────────────────
    loser_rows = list(
        (
            await db.execute(
                select(models.IncidentAssignment)
                .where(models.IncidentAssignment.incident_id == report.id)
                .order_by(models.IncidentAssignment.assigned_at)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    target_active = {
        (r.resource_type, r.resource_id): r
        for r in (
            await db.execute(
                select(models.IncidentAssignment).where(
                    models.IncidentAssignment.incident_id == target.id,
                    models.IncidentAssignment.unassigned_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    }
    target_has_leader = any(r.is_leader for r in target_active.values())
    moved_assignments: list[str] = []
    deduped: list[dict[str, Any]] = []
    leader_dropped: list[str] = []
    moved_active: list[models.IncidentAssignment] = []
    for row in loser_rows:
        active = row.unassigned_at is None
        if active and (row.resource_type, row.resource_id) in target_active:
            # On both cards: ONE assignment. The surviving card's row stays; this
            # one is released by the merge and stays on its own card.
            deduped.append({"id": str(row.id), "was_leader": row.is_leader})
            row.is_leader = False
            row.unassigned_at = now
            continue
        if active and row.is_leader:
            if target_has_leader:
                row.is_leader = False
                leader_dropped.append(str(row.id))
            else:
                target_has_leader = True
        row.incident_id = target.id
        moved_assignments.append(str(row.id))
        if active:
            moved_active.append(row)
    items.extend(await _names(db, moved_active))
    await db.flush()

    # ── Reko reports (+ photos) ─────────────────────────────────────────────
    rekos = list(
        (await db.execute(select(models.RekoReport).where(models.RekoReport.incident_id == report.id))).scalars().all()
    )
    for reko in rekos:
        photo_storage.copy_photos(report.id, target.id, list(reko.photos_json or []))
        reko.incident_id = target.id
    if rekos:
        items.append("Reko-Bericht" if len(rekos) == 1 else f"{len(rekos)} Reko-Berichte")

    # ── Schadenplatz-Rapport (one per Einsatz) ──────────────────────────────
    loser_rapport = (
        await db.execute(select(models.SchadenplatzReport).where(models.SchadenplatzReport.incident_id == report.id))
    ).scalar_one_or_none()
    rapport_moved: str | None = None
    rapport_kept = False
    if loser_rapport is not None:
        target_rapport = (
            await db.execute(
                select(models.SchadenplatzReport.id).where(models.SchadenplatzReport.incident_id == target.id)
            )
        ).scalar_one_or_none()
        if target_rapport is None:
            photo_storage.copy_photos(report.id, target.id, list(loser_rapport.photos_json or []))
            loser_rapport.incident_id = target.id
            rapport_moved = str(loser_rapport.id)
            items.append("Rapport")
        else:
            # Both filed one: keep both. This one stays on its own (hidden) row and
            # the event report prints it under the surviving card.
            rapport_kept = True
            items.append(f"Rapport (bleibt bei #{report.number})" if report.number else "Rapport (bleibt erhalten)")

    # ── KP messages to the crew ─────────────────────────────────────────────
    kp_message_ids = (
        (
            await db.execute(
                update(models.IncidentFieldMessage)
                .where(models.IncidentFieldMessage.incident_id == report.id)
                .values(incident_id=target.id)
                .returning(models.IncidentFieldMessage.id)
            )
        )
        .scalars()
        .all()
    )
    if kp_message_ids:
        items.append("Meldungen an den Trupp")

    # ── flags ───────────────────────────────────────────────────────────────
    flags: dict[str, str] = {}
    for flag, note_field in FLAG_NOTES:
        if not getattr(report, flag):
            continue
        if not getattr(target, flag):
            setattr(target, flag, True)
            if note_field:
                setattr(target, note_field, getattr(report, note_field))
            flags[flag] = "set"
        elif note_field and getattr(report, note_field):
            own = getattr(target, note_field)
            setattr(
                target,
                note_field,
                f"{own}{NOTE_JOIN}{getattr(report, note_field)}" if own else getattr(report, note_field),
            )
            flags[flag] = "joined" if own else "noted"

    # ── status: never behind the card that moved in ─────────────────────────
    status_from: str | None = None
    if _rank(report.status) > _rank(target.status):
        status_from = target.status
        target.status = report.status
        db.add(
            models.StatusTransition(
                incident_id=target.id,
                from_status=status_from,
                to_status=target.status,
                user_id=user.id if user else None,
                notes=f"Zusammenführung mit #{report.number}" if report.number else "Zusammenführung",
            )
        )

    if items:
        await log_action(
            db=db,
            action_type=ITEMS_MOVED_ACTION,
            resource_type="incident",
            resource_id=target.id,
            user=user,
            changes={
                "from_incident_id": str(report.id),
                "to_incident_id": str(target.id),
                "items": items,
                "reason": "merge",
            },
            request=request,
        )
    await db.flush()
    return {
        "moved_assignment_ids": moved_assignments,
        "deduped_assignments": deduped,
        "leader_dropped_ids": leader_dropped,
        "moved_reko_ids": [str(r.id) for r in rekos],
        "moved_rapport_id": rapport_moved,
        "rapport_kept": rapport_kept,
        "moved_kp_message_ids": [str(i) for i in kp_message_ids],
        "flags": flags,
        "status_from": status_from,
        "status_to": target.status if status_from else None,
    }


async def move_work_back(
    db: AsyncSession,
    *,
    report: models.Incident,
    target: models.Incident,
    merge_changes: dict[str, Any],
    user: models.User | None,
    request: Request | None = None,
) -> None:
    """«Trennen»: what the merge moved goes back — what is still there, as it is now.

    Rows an operator moved on by hand since stay where they are; a value an
    operator changed since (status, a joined note) is left as they set it.
    Flushes; the caller commits.
    """
    items: list[str] = []

    def ids(key: str) -> list[uuid.UUID]:
        return [uuid.UUID(i) for i in merge_changes.get(key) or []]

    # ── assignments ─────────────────────────────────────────────────────────
    moved = ids("moved_assignment_ids")
    back: list[models.IncidentAssignment] = []
    if moved:
        back = list(
            (
                await db.execute(
                    select(models.IncidentAssignment)
                    .where(
                        models.IncidentAssignment.id.in_(moved),
                        models.IncidentAssignment.incident_id == target.id,
                    )
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        for row in back:
            # A row that led the surviving card (it had nobody) leads its own again.
            row.incident_id = report.id
        await db.flush()
        items.extend(await _names(db, [r for r in back if r.unassigned_at is None]))

    loser_has_leader = any(r.is_leader and r.unassigned_at is None for r in back)
    for raw in merge_changes.get("leader_dropped_ids") or []:
        dropped = await db.get(models.IncidentAssignment, uuid.UUID(raw))
        if (
            dropped is not None
            and dropped.incident_id == report.id
            and dropped.unassigned_at is None
            and not loser_has_leader
        ):
            dropped.is_leader = True
            loser_has_leader = True

    # A resource that was on BOTH cards goes back onto the losing card too — if it
    # is still on the surviving one (it was on both before the merge).
    for entry in merge_changes.get("deduped_assignments") or []:
        doubled = await db.get(models.IncidentAssignment, uuid.UUID(entry["id"]))
        if doubled is None or doubled.incident_id != report.id or doubled.unassigned_at is None:
            continue
        still_on_target = (
            await db.execute(
                select(models.IncidentAssignment.id).where(
                    models.IncidentAssignment.incident_id == target.id,
                    models.IncidentAssignment.resource_type == doubled.resource_type,
                    models.IncidentAssignment.resource_id == doubled.resource_id,
                    models.IncidentAssignment.unassigned_at.is_(None),
                )
            )
        ).first()
        if still_on_target:
            doubled.unassigned_at = None
            if entry.get("was_leader") and not loser_has_leader:
                doubled.is_leader = True
                loser_has_leader = True

    # ── Reko reports ────────────────────────────────────────────────────────
    reko_ids = ids("moved_reko_ids")
    if reko_ids:
        rekos = list(
            (
                await db.execute(
                    select(models.RekoReport).where(
                        models.RekoReport.id.in_(reko_ids), models.RekoReport.incident_id == target.id
                    )
                )
            )
            .scalars()
            .all()
        )
        for reko in rekos:
            # Photos added while merged were stored under the surviving card.
            photo_storage.copy_photos(target.id, report.id, list(reko.photos_json or []))
            reko.incident_id = report.id
        if rekos:
            items.append("Reko-Bericht" if len(rekos) == 1 else f"{len(rekos)} Reko-Berichte")

    # ── Rapport ─────────────────────────────────────────────────────────────
    if merge_changes.get("moved_rapport_id"):
        rapport = await db.get(models.SchadenplatzReport, uuid.UUID(merge_changes["moved_rapport_id"]))
        if rapport is not None and rapport.incident_id == target.id:
            photo_storage.copy_photos(target.id, report.id, list(rapport.photos_json or []))
            rapport.incident_id = report.id
            items.append("Rapport")

    # ── KP messages ─────────────────────────────────────────────────────────
    kp_ids = ids("moved_kp_message_ids")
    if kp_ids:
        await db.execute(
            update(models.IncidentFieldMessage)
            .where(models.IncidentFieldMessage.id.in_(kp_ids), models.IncidentFieldMessage.incident_id == target.id)
            .values(incident_id=report.id)
        )
        items.append("Meldungen an den Trupp")

    # ── flags ───────────────────────────────────────────────────────────────
    for flag, note_field in FLAG_NOTES:
        how = (merge_changes.get("flags") or {}).get(flag)
        if how == "set":
            own_note = getattr(report, note_field) if note_field else None
            if getattr(target, flag) and (not note_field or getattr(target, note_field) == own_note):
                setattr(target, flag, False)
                if note_field:
                    setattr(target, note_field, None)
        elif how in ("joined", "noted") and note_field:
            own = getattr(report, note_field) or ""
            current = getattr(target, note_field) or ""
            if how == "joined" and current.endswith(f"{NOTE_JOIN}{own}"):
                setattr(target, note_field, current[: -len(f"{NOTE_JOIN}{own}")])
            elif how == "noted" and current == own:
                setattr(target, note_field, None)

    # ── status ──────────────────────────────────────────────────────────────
    status_from, status_to = merge_changes.get("status_from"), merge_changes.get("status_to")
    if status_from and target.status == status_to:
        target.status = status_from
        db.add(
            models.StatusTransition(
                incident_id=target.id,
                from_status=status_to,
                to_status=status_from,
                user_id=user.id if user else None,
                notes=f"Zusammenführung mit #{report.number} getrennt" if report.number else "Zusammenführung getrennt",
            )
        )

    if items:
        await log_action(
            db=db,
            action_type=ITEMS_MOVED_ACTION,
            resource_type="incident",
            resource_id=report.id,
            user=user,
            changes={
                "from_incident_id": str(target.id),
                "to_incident_id": str(report.id),
                "items": items,
                "reason": "unmerge",
            },
            request=request,
        )
    await db.flush()
