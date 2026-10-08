"""Divera Rückmeldungen: who answered «Komme» / «Komme nicht» on an alarm.

Read-only towards Divera and **no new Divera endpoint**: every alarm in the `/alarms` answer
the poller already fetches (`services/divera_poller.py`) carries

- ``ucr_addressed`` (Divera's own spec also spells it ``ucr_adressed``): the alarmed UCR ids,
- ``ucr_answered``: ``{"<status_id>": {"<ucr_id>": {"ts": <unix s>, "note": "…"}}}`` – the
  Swagger schema says ``int[]``, every real client agrees on the dict, and an empty answer set
  arrives as ``[]``,
- ``ucr_read``: who opened it.

An answer is filed under the status id the member pressed, and every Einheit names its own
statuses, so «kommt nicht» is not a flag: the id is resolved through the status catalogue
(``/pull/all`` → ``cluster.status``), which is fetched RARELY – reused from the Mannschaft sync
when that runs, otherwise at most once per 6 h and only when an alarm with answers needs it.

The rules are shared with KP Front (same semantics, implemented twice, no shared package):
classification precedence = station override by status id, then by status name, then the name
heuristic (not-coming first – «Komme nicht» contains «komme»), then ``time > 0``, else other.
ETA = answer time + status time, an ESTIMATE. Several alarms on one incident/Ereignis merge,
the latest answer per person wins.

A Divera answer NEVER marks anybody present. Presence stays one explicit tap on the board.
"""

from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..config import settings
from ..crud import external_identities as identities_crud

logger = logging.getLogger(__name__)

Kind = Literal["coming", "not_coming", "other"]
KINDS: tuple[Kind, ...] = ("coming", "not_coming", "other")

# Station override, a JSON object in the settings table: {"<status id>" | "<status name>": kind}.
# Empty = the built-in heuristic. Documented in docs/ALARM-INTEGRATIONS.md.
RESPONSE_CLASSIFICATION_KEY = "divera.response_classification"

SNAPSHOT_VERSION = 1
NOTE_MAX_CHARS = 80

# The status catalogue changes when somebody renames a status in Divera's admin – rarely.
CATALOGUE_TTL_SECONDS = 6 * 3600
# A failed fetch is not retried on every 30-s poll either.
CATALOGUE_RETRY_SECONDS = 15 * 60

# Lowercased, diacritics folded (see `fold`). NOT-coming is checked first.
_NOT_COMING = re.compile(
    r"\b(nicht|not|no|nein|kein\w*|pas|non)\b|abwesend|verhindert|absent|indisponible|unavailable|ferien|urlaub|krank"
)
_COMING = re.compile(
    r"komm|unterwegs|anfahrt|auf dem weg|einsatzbereit|verfugbar|\bja\b|coming|on my way|\byes\b"
    r"|viens|j'arrive|arrive|en route|disponible|\d+\s*min"
)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def fold(text: str) -> str:
    """Lowercase, diacritics stripped, whitespace collapsed, typographic apostrophes straightened."""
    text = unicodedata.normalize("NFD", text.lower().replace("’", "'"))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " ".join(text.split())


@dataclass(frozen=True)
class Overrides:
    """The station's classification override, split by what a key addresses."""

    by_id: Mapping[str, Kind]
    by_name: Mapping[str, Kind]


NO_OVERRIDES = Overrides(by_id={}, by_name={})


def parse_overrides(raw: str | None) -> Overrides:
    """`divera.response_classification` → Overrides. Tolerant: a broken value means none.

    Read while an alarm is running, so a hand-edited typo must not take the block down. A
    key of digits only addresses a status id; anything else a status name.
    """
    if not raw or not raw.strip():
        return NO_OVERRIDES
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("%s is not valid JSON – using the built-in classification", RESPONSE_CLASSIFICATION_KEY)
        return NO_OVERRIDES
    if not isinstance(data, dict):
        return NO_OVERRIDES
    by_id: dict[str, Kind] = {}
    by_name: dict[str, Kind] = {}
    for key, value in data.items():
        if not isinstance(key, str) or value not in KINDS:
            continue
        stripped = key.strip()
        if stripped.isdigit():
            by_id[str(int(stripped))] = value
        elif stripped:
            by_name[fold(stripped)] = value
    return Overrides(by_id=by_id, by_name=by_name)


def classify(status_id: int, name: str | None, minutes: int, overrides: Overrides = NO_OVERRIDES) -> Kind:
    """coming / not_coming / other for one status. Id override beats name override."""
    by_id = overrides.by_id.get(str(status_id))
    if by_id:
        return by_id
    folded = fold(name) if name else ""
    if folded:
        by_name = overrides.by_name.get(folded)
        if by_name:
            return by_name
        if _NOT_COMING.search(folded):
            return "not_coming"
        if _COMING.search(folded):
            return "coming"
    if minutes > 0:
        return "coming"
    return "other"


# ---------------------------------------------------------------------------
# Parsing the Divera payloads
# ---------------------------------------------------------------------------


def as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    return sorted({i for i in (as_int(v) for v in value) if i is not None})


def alarm_items(data: Any) -> list[dict[str, Any]]:
    """The alarm dicts of an `/alarms` answer. `data.items` is a dict (id → alarm) or a list."""
    if not isinstance(data, dict) or not data.get("success"):
        return []
    inner = data.get("data")
    items = inner.get("items") if isinstance(inner, dict) else None
    if isinstance(items, dict):
        items = list(items.values())
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def _answer_buckets(item: Mapping[str, Any]) -> dict[str, Any]:
    """`ucr_answered` as a dict; `[]` (Divera's «nothing yet») or anything else → {}."""
    answered = item.get("ucr_answered")
    return answered if isinstance(answered, dict) else {}


def answered_status_ids(item: Mapping[str, Any]) -> set[int]:
    """Status ids that actually carry at least one answer on this alarm."""
    ids: set[int] = set()
    for status_key, bucket in _answer_buckets(item).items():
        status_id = as_int(status_key)
        if status_id is not None and isinstance(bucket, dict) and bucket:
            ids.add(status_id)
    return ids


def parse_status_catalogue(cluster: Any) -> dict[str, dict[str, Any]]:
    """`/pull/all` `data.cluster` → {"<id>": {"name", "time", "sorting"}}.

    `sorting` is the position in `statussorting_alarm` (the statuses offered as
    Einsatz-Rückmeldung, in Divera's order), then `statussorting`, then the status's own
    `sorting`, so the per-status counts read in the order the member saw the buttons.
    """
    if not isinstance(cluster, dict):
        return {}
    statuses = cluster.get("status")
    if isinstance(statuses, list):
        statuses = {str(s.get("id")): s for s in statuses if isinstance(s, dict)}
    if not isinstance(statuses, dict):
        return {}
    alarm_order = [str(i) for i in _int_list_ordered(cluster.get("statussorting_alarm"))]
    general_order = [str(i) for i in _int_list_ordered(cluster.get("statussorting"))]

    catalogue: dict[str, dict[str, Any]] = {}
    for key, info in statuses.items():
        status_id = as_int(key)
        if status_id is None or not isinstance(info, dict):
            continue
        sid = str(status_id)
        if sid in alarm_order:
            sorting = alarm_order.index(sid)
        elif sid in general_order:
            sorting = 100 + general_order.index(sid)
        else:
            sorting = 1000 + (as_int(info.get("sorting")) or status_id)
        catalogue[sid] = {
            "name": str(info.get("name") or "").strip(),
            "time": max(0, as_int(info.get("time")) or 0),
            "sorting": sorting,
        }
    return catalogue


def _int_list_ordered(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    return [i for i in (as_int(v) for v in value) if i is not None]


def snapshot_from_alarm(
    item: Mapping[str, Any], catalogue: Mapping[str, Mapping[str, Any]] | None = None
) -> dict[str, Any] | None:
    """The stored, normalised form of one alarm's Rückmeldungen. None = the alarm says nothing.

    Within one alarm a person who changed their mind sits under two statuses; the latest
    answer (max `ts`) wins. The statuses the answers refer to are copied in from the
    catalogue, so the stored row reads on its own after a restart.
    """
    keys = ("ucr_addressed", "ucr_adressed", "ucr_answered", "ucr_read")
    if not any(key in item for key in keys):
        return None
    addressed = item.get("ucr_addressed")
    if addressed is None:
        addressed = item.get("ucr_adressed")

    answers: dict[str, dict[str, Any]] = {}
    for status_key, bucket in _answer_buckets(item).items():
        status_id = as_int(status_key)
        if status_id is None or not isinstance(bucket, dict):
            continue
        for ucr_key, answer in bucket.items():
            ucr_id = as_int(ucr_key)
            if ucr_id is None:
                continue
            answer = answer if isinstance(answer, dict) else {}
            ts = as_int(answer.get("ts")) or 0
            note = str(answer.get("note") or "").strip()[:NOTE_MAX_CHARS]
            current = answers.get(str(ucr_id))
            if current is None or ts > current["ts"]:
                answers[str(ucr_id)] = {"status_id": status_id, "ts": ts, "note": note}

    referenced = sorted({a["status_id"] for a in answers.values()})
    statuses = {
        str(sid): dict(catalogue[str(sid)]) for sid in referenced if catalogue is not None and str(sid) in catalogue
    }
    return {
        "v": SNAPSHOT_VERSION,
        "addressed": _int_list(addressed),
        "read": _int_list(item.get("ucr_read")),
        "answers": dict(sorted(answers.items(), key=lambda kv: int(kv[0]))),
        "statuses": statuses,
    }


# ---------------------------------------------------------------------------
# Status catalogue cache
# ---------------------------------------------------------------------------


class StatusCatalogueCache:
    """The unit's status catalogue, per process. Never fetched per device or per request."""

    def __init__(self) -> None:
        self._entries: dict[str, dict[str, Any]] | None = None
        self._fetched_at: float | None = None
        self._attempted_at: float | None = None

    def remember(self, cluster: Any) -> None:
        """Keep the catalogue out of a `/pull/all` somebody else already fetched (Mannschaft sync)."""
        entries = parse_status_catalogue(cluster)
        if entries:
            self._entries = entries
            self._fetched_at = time.monotonic()

    def get(self) -> dict[str, dict[str, Any]] | None:
        return self._entries

    def clear(self) -> None:
        self._entries = None
        self._fetched_at = None
        self._attempted_at = None

    def _due(self, now: float) -> bool:
        if (
            self._entries is not None
            and self._fetched_at is not None
            and now - self._fetched_at < CATALOGUE_TTL_SECONDS
        ):
            return False
        return not (self._attempted_at is not None and now - self._attempted_at < CATALOGUE_RETRY_SECONDS)

    async def ensure(self, client: httpx.AsyncClient, needed: Iterable[int]) -> dict[str, dict[str, Any]] | None:
        """The catalogue, fetching `/pull/all` only if an answer needs it and the copy is stale."""
        if not set(needed) or not self._due(time.monotonic()):
            return self._entries
        self._attempted_at = time.monotonic()
        url = f"{settings.divera_api_url}/pull/all"
        try:
            # No raise_for_status: its message carries the URL, and the URL carries the key.
            response = await client.get(url, params={"accesskey": settings.divera_access_key})
        except httpx.RequestError as e:
            logger.warning("Divera status catalogue: request failed (%s, %s)", type(e).__name__, httpx.URL(url).host)
            return self._entries
        if response.status_code != 200:
            logger.warning("Divera status catalogue: HTTP %s", response.status_code)
            return self._entries
        try:
            data = response.json()
        except ValueError:
            logger.warning("Divera status catalogue: answer is not JSON")
            return self._entries
        if not isinstance(data, dict) or not data.get("success"):
            logger.warning("Divera status catalogue: success=false")
            return self._entries
        inner = data.get("data")
        self.remember(inner.get("cluster") if isinstance(inner, dict) else None)
        return self._entries


status_catalogue = StatusCatalogueCache()


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


async def store_snapshots(db: AsyncSession, snapshots: Mapping[int, dict[str, Any]]) -> tuple[set[UUID], set[UUID]]:
    """Write the snapshots onto the pool alarms they belong to; only rows that changed.

    Returns the (event ids, incident ids) whose Rückmeldungen changed, for the broadcast.
    An alarm we never took into the pool is ignored – there is nothing to show it on.
    """
    if not snapshots:
        return set(), set()
    result = await db.execute(
        select(models.DiveraEmergency).where(models.DiveraEmergency.divera_id.in_(list(snapshots.keys())))
    )
    events: set[UUID] = set()
    incidents: set[UUID] = set()
    now = datetime.now(UTC)
    for emergency in result.scalars().all():
        if emergency.divera_id is None:
            continue
        snapshot = snapshots.get(emergency.divera_id)
        if snapshot is None or emergency.responses_json == snapshot:
            continue
        emergency.responses_json = snapshot
        emergency.responses_updated_at = now
        if emergency.attached_to_event_id:
            events.add(emergency.attached_to_event_id)
        if emergency.created_incident_id:
            incidents.add(emergency.created_incident_id)
    if events or incidents:
        await db.commit()
    return events, incidents


async def emergencies_for_event(db: AsyncSession, event_id: UUID) -> list[models.DiveraEmergency]:
    result = await db.execute(
        select(models.DiveraEmergency).where(
            models.DiveraEmergency.attached_to_event_id == event_id,
            models.DiveraEmergency.divera_id.is_not(None),
            models.DiveraEmergency.is_training.is_(False),
        )
    )
    return list(result.scalars().all())


async def emergencies_for_incident(db: AsyncSession, incident: models.Incident) -> list[models.DiveraEmergency]:
    """The Divera alarms behind one incident: the one that created it, or matched by `source_ref`."""
    links = [models.DiveraEmergency.created_incident_id == incident.id]
    if incident.source == "divera" and incident.source_ref:
        links.append(models.DiveraEmergency.source_id == incident.source_ref)
    result = await db.execute(
        select(models.DiveraEmergency).where(
            or_(*links),
            models.DiveraEmergency.divera_id.is_not(None),
            models.DiveraEmergency.is_training.is_(False),
        )
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RosterPerson:
    personnel_id: UUID
    name: str
    role: str | None
    tags: list[str]


def _epoch(ts: int) -> datetime | None:
    return datetime.fromtimestamp(ts, tz=UTC) if ts > 0 else None


def summarize(
    snapshots: Iterable[tuple[Mapping[str, Any] | None, datetime | None]],
    overrides: Overrides,
    roster: Mapping[int, RosterPerson],
) -> dict[str, Any]:
    """Merge the snapshots of all alarms of one incident/Ereignis into what the board shows.

    Pure: the endpoint feeds it the stored rows, the station override and the `divera`
    identities; tests feed it the fixtures.
    """
    addressed: set[int] = set()
    read: set[int] = set()
    statuses: dict[str, dict[str, Any]] = {}
    answers: dict[int, dict[str, Any]] = {}
    updated_at: datetime | None = None
    alarm_count = 0

    for snapshot, changed_at in snapshots:
        alarm_count += 1
        if not snapshot:
            continue
        if changed_at is not None and (updated_at is None or changed_at > updated_at):
            updated_at = changed_at
        addressed.update(_int_list(snapshot.get("addressed")))
        read.update(_int_list(snapshot.get("read")))
        for sid, info in (snapshot.get("statuses") or {}).items():
            if isinstance(info, dict):
                statuses[str(sid)] = info
        for ucr_key, answer in (snapshot.get("answers") or {}).items():
            ucr_id = as_int(ucr_key)
            if ucr_id is None or not isinstance(answer, dict):
                continue
            current = answers.get(ucr_id)
            if current is None or (as_int(answer.get("ts")) or 0) > current["ts"]:
                answers[ucr_id] = {
                    "status_id": as_int(answer.get("status_id")) or 0,
                    "ts": as_int(answer.get("ts")) or 0,
                    "note": str(answer.get("note") or "")[:NOTE_MAX_CHARS],
                }

    kind_counts: dict[str, int] = dict.fromkeys(KINDS, 0)
    status_counts: dict[int, dict[str, Any]] = {}
    people: list[dict[str, Any]] = []
    unmapped = 0

    for ucr_id, answer in answers.items():
        status_id = answer["status_id"]
        info = statuses.get(str(status_id))
        name = (info or {}).get("name") or None
        minutes = int((info or {}).get("time") or 0)
        kind = classify(status_id, name, minutes, overrides)
        label = name or f"Status {status_id}"
        kind_counts[kind] += 1
        entry = status_counts.setdefault(
            status_id,
            {
                "status_id": status_id,
                "name": label,
                "kind": kind,
                "time": minutes,
                "count": 0,
                "_sorting": (info or {}).get("sorting", 10_000 + status_id),
            },
        )
        entry["count"] += 1
        eta_ts = answer["ts"] + minutes * 60 if kind == "coming" and minutes > 0 and answer["ts"] > 0 else 0
        person = roster.get(ucr_id)
        if person is None:
            unmapped += 1
        people.append(
            {
                "ucr_id": ucr_id,
                "personnel_id": person.personnel_id if person else None,
                "name": person.name if person else None,
                "role": person.role if person else None,
                "tags": list(person.tags) if person else [],
                "status_id": status_id,
                "status_name": label,
                "kind": kind,
                "answered_at": _epoch(answer["ts"]),
                "eta": _epoch(eta_ts),
                "note": answer["note"] or None,
            }
        )

    kind_order = {"coming": 0, "other": 1, "not_coming": 2}
    people.sort(
        key=lambda p: (
            kind_order[p["kind"]],
            (p["eta"] or p["answered_at"] or datetime.max.replace(tzinfo=UTC)),
            p["ucr_id"],
        )
    )
    ordered_statuses = sorted(status_counts.values(), key=lambda s: (s["_sorting"], s["status_id"]))
    for status in ordered_statuses:
        status.pop("_sorting")

    answered = len(answers)
    return {
        "available": True,
        "reason": None,
        "alarm_count": alarm_count,
        "counts": kind_counts,
        "statuses": ordered_statuses,
        "people": people,
        "addressed": len(addressed),
        "read": len(read),
        "answered": answered,
        # Count arithmetic, as KP Front computes it: somebody who answered without being
        # in `ucr_addressed` (Nachalarm, self-alarm) does not make another person «unanswered».
        "unanswered": max(0, len(addressed) - answered),
        "unmapped": unmapped,
        "updated_at": updated_at,
    }


def not_available(reason: Literal["not_configured", "not_linked"]) -> dict[str, Any]:
    return {"available": False, "reason": reason, "counts": dict.fromkeys(KINDS, 0)}


async def _roster_for(db: AsyncSession, ucr_ids: Iterable[int]) -> dict[int, RosterPerson]:
    """UCR id → local person, through the `divera` external identity (the only place it lives)."""
    wanted = {str(u) for u in ucr_ids}
    if not wanted:
        return {}
    identity_map = await identities_crud.get_identity_map(db, "divera")
    by_ucr = {ext: pid for pid, ext in identity_map.items() if ext in wanted}
    if not by_ucr:
        return {}
    result = await db.execute(select(models.Personnel).where(models.Personnel.id.in_(list(by_ucr.values()))))
    people = {p.id: p for p in result.scalars().all()}
    roster: dict[int, RosterPerson] = {}
    for ext, pid in by_ucr.items():
        person = people.get(pid)
        if person is None:
            continue
        roster[int(ext)] = RosterPerson(
            personnel_id=person.id,
            name=person.name,
            role=person.role,
            tags=[str(t) for t in (person.tags or [])],
        )
    return roster


async def summary_for(db: AsyncSession, emergencies: list[models.DiveraEmergency]) -> dict[str, Any]:
    """The endpoint's answer for a set of pool alarms (one incident or one Ereignis)."""
    if not settings.divera_access_key:
        return not_available("not_configured")
    if not emergencies:
        return not_available("not_linked")
    from .settings import get_setting  # local: services.settings imports nothing from here

    overrides = parse_overrides(await get_setting(db, RESPONSE_CLASSIFICATION_KEY))
    ucr_ids: set[int] = set()
    for emergency in emergencies:
        for key in (emergency.responses_json or {}).get("answers", {}):
            if (ucr := as_int(key)) is not None:
                ucr_ids.add(ucr)
    roster = await _roster_for(db, ucr_ids)
    return summarize(
        ((e.responses_json, e.responses_updated_at) for e in emergencies),
        overrides,
        roster,
    )
