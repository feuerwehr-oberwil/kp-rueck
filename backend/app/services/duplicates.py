"""Duplicate reports: the same Schadenplatz, called in twice.

On a storm night the same tree is reported by the neighbour, the Leitstelle and
the Trupp driving past it. Every door used to make a new card, so the board
filled with three cards for one address — two Trupps sent to one tree, or an
operator deleting the extra card and losing its Melder with it.

Three pieces, one module:

- **Matching** (`find_duplicate_candidates`): open incidents of the same
  Ereignis within `DUPLICATE_RADIUS_M` or at a normalised-equal address. Closed
  (`complete`), deleted and merged cards never match, nor do other Ereignisse.
- **Flagging** (`flag_possible_duplicate`): the automatic doors (webhook,
  poller, public /alarm, bulk attach) never merge on their own. They create the
  card and leave `possible_duplicate_of_id` on it; the card offers the merge.
- **Merging** (`merge_report` / `unmerge_report`): the second report is folded
  into the first card as a Nachtrag in «Notizen» (append-only, the same rule as
  the /alarm and /feld corrections), an empty Melder/Telefon on the target is
  filled, and the report's own row is soft-deleted with `merged_into_id` set.
  The row keeps its source, source_ref and text, so the merge is audited twice
  (audit log + the target's Verlauf) and «Trennen» brings the card back.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..crud import events as events_crud
from .audit import log_action
from .merge_requests import move_requests_back, move_requests_in
from .notification_service import _haversine_distance_meters

#: Two reports this close are one Schadenplatz until a human says otherwise. A
#: geocoded street address lands on the building; 50 m covers a pin dropped on
#: the road in front of it and the house next door, not the next block.
DUPLICATE_RADIUS_M = 50

#: At most this many candidates are offered. More than three "maybe the same"
#: is a street full of incidents, and the operator decides faster on the nearest.
MAX_CANDIDATES = 3

LOCAL_TZ = ZoneInfo("Europe/Zurich")

#: Audit action types. `merge` sits on the TARGET (it is the target's history);
#: `merged_into` on the report row; `unmerge` on both.
MERGE_ACTION = "merge"
MERGED_INTO_ACTION = "merged_into"
UNMERGE_ACTION = "unmerge"
DISMISS_ACTION = "duplicate_dismissed"

MatchKind = Literal["distance", "address", "both"]


# ---------------------------------------------------------------- addresses

_POSTCODE = re.compile(r"\b\d{4}\b")
# «Hauptstr.», «Hauptstr», «Hauptstraße», «Haupt-Strasse», «Haupt Strasse»
_STREET_SUFFIX = re.compile(r"(str|strasse)$")


def _fold(text: str) -> str:
    """Lower case, ß → ss, accents off — «Bahnhofstraße» and «BAHNHOFSTRASSE» are one."""
    text = text.casefold().replace("ß", "ss")
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_address(address: str | None) -> tuple[str, str | None] | None:
    """The street-and-number key of an address, plus its postcode when it has one.

    Only the first comma segment is the street: «Hauptstrasse 6, 4104 Oberwil»
    and «Hauptstr. 6» name the same door inside one Ereignis, which is one
    municipality or two. The postcode is kept apart so two equal streets in two
    different villages (both with a postcode) do NOT match.

    The street key is the name's letters run together — spaces, dots and hyphens
    are how people type «St. Jakobs-Strasse», not part of the name — with a
    trailing «str» spelled out, followed by the house number with its letter
    («6a», «6 a» and «6A» are one).

    None when there is nothing to compare: no address, or no house number. A
    street without a number is a kilometre of road, and «Hauptstrasse» alone
    matching every other «Hauptstrasse» would flag half the board.
    """
    if not address or not address.strip():
        return None
    folded = _fold(address)
    street, _, rest = folded.partition(",")
    postcode_match = _POSTCODE.search(rest)
    postcode = postcode_match.group(0) if postcode_match else None

    number_match = re.search(r"(\d+)\s*([a-z]?)\b", street)
    if not number_match:
        return None
    # «Hauptstrasse 6» names the street before the number; «12 rue de Lausanne»
    # after it. Whatever follows a German street's number is the village.
    name = re.sub(r"[^a-z]", "", street[: number_match.start()]) or re.sub(r"[^a-z]", "", street[number_match.end() :])
    if not name:
        return None
    name = _STREET_SUFFIX.sub("strasse", name)
    number = number_match.group(1).lstrip("0") + number_match.group(2)
    return f"{name}|{number}", postcode


def addresses_match(a: str | None, b: str | None) -> bool:
    """Same street, same house number, and not two different postcodes."""
    key_a = normalize_address(a)
    key_b = normalize_address(b)
    if key_a is None or key_b is None:
        return False
    if key_a[0] != key_b[0]:
        return False
    postcode_a, postcode_b = key_a[1], key_b[1]
    return postcode_a is None or postcode_b is None or postcode_a == postcode_b


# ---------------------------------------------------------------- matching


@dataclass
class DuplicateCandidate:
    incident: models.Incident
    distance_m: int | None
    match: MatchKind


def _as_float(value: Decimal | float | str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def find_duplicate_candidates(
    db: AsyncSession,
    event_id: uuid.UUID,
    *,
    lat: Decimal | float | str | None,
    lng: Decimal | float | str | None,
    address: str | None,
    exclude_ids: tuple[uuid.UUID, ...] = (),
    radius_m: int = DUPLICATE_RADIUS_M,
    limit: int = MAX_CANDIDATES,
) -> list[DuplicateCandidate]:
    """Open incidents of this Ereignis that are probably the same Schadenplatz.

    Open = not `complete`, not deleted, not merged into another card. Within
    `radius_m` (haversine on the stored coordinates) OR at a normalised-equal
    address — either is enough, because a phone call has an address and no pin,
    and a Trupp has a pin and a reverse-geocoded guess.

    Nearest first; address-only matches (no distance to sort by) after the
    measured ones; ties go to the unflagged, then the oldest card. An Ereignis has a few hundred incidents at
    the very most, so this filters in Python rather than teaching Postgres
    trigonometry.
    """
    point_lat, point_lng = _as_float(lat), _as_float(lng)
    has_point = point_lat is not None and point_lng is not None
    if not has_point and normalize_address(address) is None:
        return []

    query = select(models.Incident).where(
        models.Incident.event_id == event_id,
        models.Incident.deleted_at.is_(None),
        models.Incident.merged_into_id.is_(None),
        models.Incident.status != "complete",
    )
    if exclude_ids:
        query = query.where(models.Incident.id.notin_(exclude_ids))
    rows = (await db.execute(query)).scalars().all()

    candidates: list[DuplicateCandidate] = []
    for incident in rows:
        distance: int | None = None
        near = False
        other_lat, other_lng = _as_float(incident.location_lat), _as_float(incident.location_lng)
        if has_point and other_lat is not None and other_lng is not None:
            distance = round(_haversine_distance_meters(point_lat, point_lng, other_lat, other_lng))  # type: ignore[arg-type]
            near = distance <= radius_m
        same_address = addresses_match(address, incident.location_address)
        if not near and not same_address:
            continue
        kind: MatchKind = "both" if near and same_address else ("distance" if near else "address")
        candidates.append(DuplicateCandidate(incident=incident, distance_m=distance, match=kind))

    # Nearest first (in 10 m steps — two pins 3 m apart are a tie, not a ranking),
    # then the card that is not itself a flagged duplicate, then the OLDEST: the
    # first report is the one the others are Nachträge to, and pointing a new
    # alarm at the duplicate of a duplicate only builds a chain.
    def _sort_key(c: DuplicateCandidate) -> tuple[int, int, int, float]:
        created = c.incident.created_at.timestamp() if c.incident.created_at else 0.0
        flagged = 1 if c.incident.possible_duplicate_of_id is not None else 0
        if c.distance_m is not None and c.match != "address":
            return (0, c.distance_m // 10, flagged, created)
        return (1, 0, flagged, created)

    candidates.sort(key=_sort_key)
    return candidates[:limit]


async def flag_possible_duplicate(db: AsyncSession, incident: models.Incident) -> uuid.UUID | None:
    """Mark a freshly created card from an automatic door as «mögliches Duplikat».

    Never merges: an alarm nobody looked at must not disappear into another card.
    Sets the flag to the best candidate and flushes; the caller owns the commit.
    Returns the candidate's id, or None when nothing matched.
    """
    candidates = await find_duplicate_candidates(
        db,
        incident.event_id,
        lat=incident.location_lat,
        lng=incident.location_lng,
        address=incident.location_address,
        exclude_ids=(incident.id,),
        limit=1,
    )
    if not candidates:
        return None
    incident.possible_duplicate_of_id = candidates[0].incident.id
    await db.flush()
    return incident.possible_duplicate_of_id


# ---------------------------------------------------------------- merging


class MergeRefusedError(Exception):
    """The merge cannot be done as asked. `reason` is the German sentence for the API."""

    def __init__(self, reason: str, *, status_code: int = 409) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status_code = status_code


_SOURCE_LABELS = {
    "operator": "KP",
    "intake": "Telefon",
    "feld": "Feld",
    "divera": "Divera",
}


def _source_label(report: models.Incident, reporter_name: str | None) -> str:
    label = _SOURCE_LABELS.get(report.source, report.source)
    if reporter_name:
        label = f"{label} · {reporter_name}"
    if report.source_ref:
        label = f"{label} {report.source_ref}"
    return label


def merge_note(report: models.Incident, *, reporter_name: str | None = None, at: datetime | None = None) -> str:
    """The Nachtrag the target card's «Notizen» gets — the whole second report, one entry.

    «Weitere Meldung 14:32 (Telefon): Wasser im Keller · Hauptstr. 6 · Melder: Meier, 079 …»

    German only, like every other backend-written text (CLAUDE.md, i18n). The
    time is the report's own, in local time: an operator reads «14:32» against
    the wall clock, not UTC. The address is in it only when it differs from the
    target's, because then it is information (the pin was 40 m off).
    """
    stamp = (at or report.created_at or datetime.now(UTC)).astimezone(LOCAL_TZ).strftime("%H:%M")
    parts: list[str] = []
    # The title first: from a Leitstelle it is the Stichwort («ELEMENTAR Wasser im
    # Keller») and often the only classification there is. Only a title that
    # merely repeats the address — the board's own «Neuer Einsatz» titles a card
    # with its Einsatzort — is left out.
    title = (report.title or "").strip()
    address = (report.location_address or "").strip()
    if title and not _repeats_address(title, address):
        parts.append(title)
    for text in (report.description, report.internal_notes):
        if text and text.strip():
            parts.append(text.strip())
    if address:
        parts.append(address)
    melder = ", ".join(p.strip() for p in (report.contact, report.contact_phone) if p and p.strip())
    if melder:
        parts.append(f"Melder: {melder}")
    # ONE line: «Notizen» is a list of entries, one per line, and the undo takes
    # back exactly one whole line. A Meldung typed over two lines stays readable
    # with « / » where its line break was.
    body = " · ".join(re.sub(r"\s*\n\s*", " / ", part) for part in parts) or title
    return f"Weitere Meldung {stamp} ({_source_label(report, reporter_name)}): {body}"


def _repeats_address(title: str, address: str) -> bool:
    """Is this title just the address again (or part of it)?"""
    if not address:
        return False
    folded_title, folded_address = _fold(title), _fold(address)
    return folded_title in folded_address or addresses_match(title, address)


def _append_entry(existing: str | None, entry: str) -> str:
    return f"{existing}\n{entry}" if existing and existing.strip() else entry


def _remove_entry(existing: str | None, entry: str) -> tuple[str | None, bool]:
    """Take one appended entry back out — only if it is still there verbatim.

    Never a snapshot restore (CLAUDE.md, «Undo never restores a snapshot
    blindly»): whatever the operator typed into «Notizen» since the merge stays.
    If they edited the Nachtrag itself, it is theirs now and stays too.
    """
    if not existing:
        return existing, False
    # Whole lines only. A substring match would cut an operator's sentence that
    # happens to continue the entry («… Melder: Meier – zurückgerufen») in half,
    # or take a sibling Nachtrag that starts with the same words. The last
    # matching line goes (the newest merge of the same text).
    lines = existing.split("\n")
    for index in range(len(lines) - 1, -1, -1):
        if lines[index] == entry:
            rest = lines[:index] + lines[index + 1 :]
            return ("\n".join(rest) or None), True
    return existing, False


async def _has_active_assignments(db: AsyncSession, incident_id: uuid.UUID) -> bool:
    count = await db.scalar(
        select(func.count())
        .select_from(models.IncidentAssignment)
        .where(
            models.IncidentAssignment.incident_id == incident_id,
            models.IncidentAssignment.unassigned_at.is_(None),
        )
    )
    return bool(count)


@dataclass
class MergeResult:
    target: models.Incident
    report: models.Incident
    note: str
    #: Cards whose «mögliches Duplikat» flag now points at the target instead.
    repointed_ids: list[uuid.UUID] = field(default_factory=list)


_PRIORITY_RANK = {"low": 0, "medium": 1, "high": 2}


async def _work_on_card(db: AsyncSession, card: models.Incident) -> str | None:
    """What has already happened on this card that a merge would hide, if anything.

    The losing card disappears (soft-deleted), and with it everything hanging
    off it that cannot move: a Reko-Bericht, a Rapport and its photos, the KP's
    messages to a crew. (Requests from the field — including an Abholung — move
    with the merge instead.) A merge is for a fresh second REPORT — something
    nobody has worked on yet. Anything else is two cards that need a human to decide,
    not a Nachtrag. Returns the reason in words, or None when it is fresh.
    """
    if card.status != "incoming":
        return "nicht mehr «Eingegangen»"
    # Requests from the field (messages, Material, Verstärkung, Abholung) do NOT
    # block any more: they move to the surviving card (services/merge_requests.py,
    # owner decision 09.10.2026). «Einsatz beendet» is not a request — it is the
    # crew closing THIS card, and it would vanish with it.
    if card.field_complete_reported_at is not None:
        return "vom Feld als beendet gemeldet"
    checks: list[tuple[str, Any]] = [
        ("Reko", select(models.RekoReport.id).where(models.RekoReport.incident_id == card.id)),
        ("Rapport", select(models.SchadenplatzReport.id).where(models.SchadenplatzReport.incident_id == card.id)),
        (
            "Meldungen an den Trupp",
            select(models.IncidentFieldMessage.id).where(models.IncidentFieldMessage.incident_id == card.id),
        ),
    ]
    for reason, query in checks:
        if (await db.execute(query.limit(1))).first() is not None:
            return reason
    return None


async def merge_report(
    db: AsyncSession,
    *,
    report: models.Incident,
    target: models.Incident,
    user: models.User | None,
    request: Request | None = None,
    reporter_name: str | None = None,
) -> MergeResult:
    """Fold `report` into `target`. Flushes; the caller commits.

    `report` may be a row created a moment ago in the same transaction (the
    «Zusammenführen» before a card exists) or a card already on the board (the
    flagged duplicate). Either way it ends soft-deleted with `merged_into_id`
    set — never hard-deleted, so «Trennen» can bring it back.

    Refused (MergeRefusedError) when it would lose something without saying so:
    another Ereignis, a deleted or merged target, the card itself, or a report
    card that already has people or vehicles on it — those have to be moved or
    released by a human first, the merge does not do it silently.
    """
    if report.id == target.id:
        raise MergeRefusedError("Ein Einsatz kann nicht mit sich selbst zusammengeführt werden.", status_code=400)
    if report.event_id != target.event_id:
        raise MergeRefusedError("Nur Einsätze desselben Ereignisses können zusammengeführt werden.", status_code=400)
    if target.deleted_at is not None or target.merged_into_id is not None:
        raise MergeRefusedError("Der Ziel-Einsatz ist nicht mehr auf dem Board.")
    if target.status == "complete":
        # Same rule as /feld: a closed card is history. A new report there is a
        # new Schadenplatz until somebody reopens the old one on purpose.
        raise MergeRefusedError("Der Ziel-Einsatz ist bereits abgeschlossen. Bitte als neuen Einsatz erfassen.")
    if report.deleted_at is not None or report.merged_into_id is not None:
        raise MergeRefusedError("Diese Meldung ist bereits zusammengeführt oder gelöscht.")
    if await _has_active_assignments(db, report.id):
        raise MergeRefusedError(
            "Diesem Einsatz sind schon Mittel zugewiesen. Zuerst verschieben oder entlassen, dann zusammenführen."
        )
    worked_on = await _work_on_card(db, report)
    if worked_on:
        raise MergeRefusedError(
            f"Dieser Einsatz ist schon in Arbeit ({worked_on}) und wird nicht zusammengeführt – "
            "sonst verschwände das mit ihm."
        )

    # `created_at` is a server default: after the flush that created a fresh
    # report it is expired, and reading it lazily from async code fails.
    await db.refresh(report)
    note = merge_note(report, reporter_name=reporter_name)
    target.internal_notes = _append_entry(target.internal_notes, note)

    # An empty Melder/Telefon on the target is filled — the KP will call back
    # whoever it can reach. A filled one is never overwritten; the second Melder
    # is in the Nachtrag either way.
    filled: list[str] = []
    for name in ("contact", "contact_phone"):
        value = getattr(report, name)
        if value and value.strip() and not (getattr(target, name) or "").strip():
            setattr(target, name, value.strip())
            filled.append(name)

    # The merged card is as urgent as the more urgent of the two reports: a
    # «Person im Keller» in the second call must not drop to the first call's
    # «Niedrig». Raised only, never lowered; the undo puts it back if nobody
    # has touched it since.
    priority_from: str | None = None
    if _PRIORITY_RANK.get(report.priority, 0) > _PRIORITY_RANK.get(target.priority, 0):
        priority_from = target.priority
        target.priority = report.priority

    # Same `now` for both, the way delete_incident stamps them — that is what
    # lets the restore tell a side-effect completion from a real one.
    now = datetime.now(UTC)
    report.deleted_at = now
    if not report.completed_at:
        report.completed_at = now
    report.merged_into_id = target.id
    report.possible_duplicate_of_id = None

    # Anything that was flagged as a duplicate of the report is now a candidate
    # for the card the report went into — and those cards change on every board.
    repointed = (
        (
            await db.execute(
                update(models.Incident)
                .where(models.Incident.possible_duplicate_of_id == report.id)
                .where(models.Incident.id != target.id)
                .values(possible_duplicate_of_id=target.id)
                .returning(models.Incident.id)
            )
        )
        .scalars()
        .all()
    )
    if target.possible_duplicate_of_id == report.id:
        target.possible_duplicate_of_id = None

    # The field's requests and their bell entries go where the work now is.
    moved = await move_requests_in(db, report=report, target=target, user=user, request=request)

    # Neither the note nor the Melder values go into the audit row: they are
    # PII (a phone number), the report row keeps them, and `merge_note` is a
    # pure function of that row — the undo and the Verlauf rebuild it from there.
    changes: dict[str, Any] = {
        "merged_incident_id": str(report.id),
        "filled_fields": filled,
        "priority_from": priority_from,
        "priority_to": target.priority if priority_from else None,
        "source": report.source,
        "source_ref": report.source_ref,
        **moved,
    }
    if reporter_name:
        changes["personnel_name"] = reporter_name
    await log_action(
        db=db,
        action_type=MERGE_ACTION,
        resource_type="incident",
        resource_id=target.id,
        user=user,
        changes=changes,
        request=request,
    )
    await log_action(
        db=db,
        action_type=MERGED_INTO_ACTION,
        resource_type="incident",
        resource_id=report.id,
        user=user,
        changes={"target_incident_id": str(target.id)},
        request=request,
    )
    await events_crud.update_event_activity(db, target.event_id)
    await db.flush()
    return MergeResult(target=target, report=report, note=note, repointed_ids=list(repointed))


async def _last_merge_entry(db: AsyncSession, target_id: uuid.UUID, report_id: uuid.UUID) -> models.AuditLog | None:
    return (
        await db.execute(
            select(models.AuditLog)
            .where(
                models.AuditLog.resource_type == "incident",
                models.AuditLog.resource_id == target_id,
                models.AuditLog.action_type == MERGE_ACTION,
                models.AuditLog.changes_json["merged_incident_id"].astext == str(report_id),
            )
            .order_by(models.AuditLog.timestamp.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


@dataclass
class UnmergeResult:
    report: models.Incident
    target: models.Incident | None
    note_removed: bool


async def unmerge_report(
    db: AsyncSession,
    report: models.Incident,
    *,
    user: models.User | None,
    request: Request | None = None,
) -> UnmergeResult:
    """«Trennen»: the merged report is its own card again. Flushes; caller commits.

    Takes the Nachtrag back out of the target's «Notizen» and empties a Melder
    field the merge filled — each only if it still reads exactly what the merge
    wrote. Anything an operator changed since stays as they left it, and the
    response says whether the note came out.
    """
    if report.merged_into_id is None or report.deleted_at is None:
        raise MergeRefusedError("Diese Meldung ist nicht zusammengeführt.")
    target = await db.get(models.Incident, report.merged_into_id)

    note_removed = False
    if target is not None:
        entry = await _last_merge_entry(db, target.id, report.id)
        changes = (entry.changes_json or {}) if entry else {}
        note = merge_note(report, reporter_name=changes.get("personnel_name"))
        target.internal_notes, note_removed = _remove_entry(target.internal_notes, note)
        for name in changes.get("filled_fields") or []:
            if name in ("contact", "contact_phone") and getattr(target, name) == (getattr(report, name) or "").strip():
                setattr(target, name, None)
        # The priority the merge raised goes back — unless somebody set it since.
        if changes.get("priority_from") and target.priority == changes.get("priority_to"):
            target.priority = changes["priority_from"]
        # …and the field's requests go back to the card they were asked on.
        await move_requests_back(db, report=report, target=target, merge_changes=changes, user=user, request=request)

    # The restore half of crud.restore_incident: a side-effect completion goes,
    # a route stop goes to the end of its route (its old slot may be taken).
    if report.completed_at == report.deleted_at:
        report.completed_at = None
    if report.group_id is not None:
        max_pos = await db.scalar(
            select(func.max(models.Incident.group_position)).where(
                models.Incident.group_id == report.group_id,
                models.Incident.deleted_at.is_(None),
                models.Incident.id != report.id,
            )
        )
        report.group_position = (max_pos + 1) if max_pos is not None else 0
    report.deleted_at = None
    report.merged_into_id = None
    # Back on the board next to the card it was merged into: say so again, so
    # whoever looks at it next sees why it was merged in the first place.
    report.possible_duplicate_of_id = target.id if target is not None and target.deleted_at is None else None

    for resource_id in filter(None, (report.id, target.id if target else None)):
        await log_action(
            db=db,
            action_type=UNMERGE_ACTION,
            resource_type="incident",
            resource_id=resource_id,
            user=user,
            changes={
                "merged_incident_id": str(report.id),
                "target_incident_id": str(target.id) if target else None,
                "note_removed": note_removed,
            },
            request=request,
        )
    await events_crud.update_event_activity(db, report.event_id)
    await db.flush()
    return UnmergeResult(report=report, target=target, note_removed=note_removed)


async def dismiss_duplicate_flag(
    db: AsyncSession, incident: models.Incident, *, user: models.User | None, request: Request | None = None
) -> None:
    """«Kein Duplikat»: the flag goes, the decision is audited. Flushes."""
    if incident.possible_duplicate_of_id is None:
        return
    await log_action(
        db=db,
        action_type=DISMISS_ACTION,
        resource_type="incident",
        resource_id=incident.id,
        user=user,
        changes={"possible_duplicate_of_id": str(incident.possible_duplicate_of_id)},
        request=request,
    )
    incident.possible_duplicate_of_id = None
    await db.flush()
