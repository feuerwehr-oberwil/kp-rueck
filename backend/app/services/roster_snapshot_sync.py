"""Roster snapshot → this deployment's ``personnel``: KP Rück's half of the ingestion.

A station whose personnel list lives somewhere else (an HR system, a spreadsheet, a sibling
application such as fwo-admin) publishes it as a ``roster-snapshot/1`` file, and this module
reads it — every ``ROSTER_SNAPSHOT_INTERVAL_MINUTES`` (background/roster_snapshot.py) and on
demand (``POST /api/integrations/roster-snapshot/sync``, or the CLI below).

**Off unless a source is set.** Nothing happens until ``ROSTER_SNAPSHOT_SOURCE`` names an
address or a path. The Divera roster sync is untouched by this module and stays the default.

**The rules live in the shared half.** Matching, the deactivation cap, the never-empty and
time-travel guards and the outcome report are :mod:`app.roster_snapshot_ingest`, byte-identical
with KP Front's copy (pinned by tests/test_roster_snapshot_contract.py, diffed by CI's
``roster-schema-drift``), so one published file lands the same way in both products. What is
KP Rück's own is here:

* **«Active» is not ``status``.** ``personnel.status`` is availability on the board
  (``available`` / ``unavailable``) and belongs to the operators — somebody on holiday is
  unavailable and still on the roster. So a person the snapshot deactivates is set
  ``unavailable`` AND marked on their snapshot identity row (``deactivated_by_snapshot``, plus
  the status they had), and only a person carrying that mark counts as inactive to the
  reconciliation. Re-activation restores the status they had and clears the mark; a person an
  operator set unavailable is never «re-activated» by a feed.
* **Rank → ``role``.** The board ranks by four role words. A snapshot carries Swiss rank keys
  (``wm``, ``kpl``, …); :data:`RANK_ROLE` maps them, and a key outside it is reported as an
  unknown rank and leaves ``role`` alone. The key last applied is kept on the identity row, so an
  operator's own edit of ``role`` survives until the FILE changes that person's rank.
* **Never deleted.** Unlike the Divera sync's «remove stale», nothing here deletes a person.
* The last report lives in the ``settings`` row ``roster_snapshot.status`` (JSON), served by
  ``GET /api/integrations/roster-snapshot`` and shown under Einstellungen › Integrationen.

CLI (``cd backend``; in the compose stack ``docker compose exec backend …``)::

    uv run python -m app.services.roster_snapshot_sync run [--force]
    uv run python -m app.services.roster_snapshot_sync status
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Personnel, PersonnelExternalIdentity, Setting
from ..roster_snapshot_ingest import (
    LastGood,
    LocalPerson,
    Reconciliation,
    read_source,
    reconcile,
    refused_outcome,
    status_json,
)
from .audit import log_action

logger = logging.getLogger(__name__)

STATUS_KEY = "roster_snapshot.status"

#: Snapshot rank key → KP Rück's role word. The keys are KP Front's Swiss default list
#: (backend/app/ranks.py there), which is what a station's snapshot is most likely to carry; the
#: four role words are the ones the board ranks by (crud/assignments._RANK_FALLBACK).
RANK_ROLE: dict[str, str] = {
    "kdt": "Offizier",
    "maj": "Offizier",
    "hptm": "Offizier",
    "oblt": "Offizier",
    "lt": "Offizier",
    "fw": "Wachtmeister",
    "wm": "Wachtmeister",
    "kpl": "Korporal",
    "gfr": "Mannschaft",
    "fwm": "Mannschaft",
    "sdt": "Mannschaft",
}

_MARK = "deactivated_by_snapshot"


def configured() -> bool:
    return bool(settings.roster_snapshot_source.strip())


async def read_status(db: AsyncSession) -> dict[str, Any] | None:
    row = (await db.execute(select(Setting).where(Setting.key == STATUS_KEY))).scalar_one_or_none()
    if row is None or not row.value:
        return None
    try:
        doc = json.loads(row.value)
    except ValueError:
        return None
    return doc if isinstance(doc, dict) else None


async def _write_status(db: AsyncSession, status: dict[str, Any]) -> None:
    """Stage the status row in the CALLER's transaction — the report and the roster it
    describes commit together or not at all."""
    row = (await db.execute(select(Setting).where(Setting.key == STATUS_KEY))).scalar_one_or_none()
    value = json.dumps(status, ensure_ascii=False)
    if row is None:
        db.add(Setting(key=STATUS_KEY, value=value))
    else:
        row.value = value


def _meta_str(meta: list[dict[str, Any]], key: str) -> str | None:
    """A value the snapshot last wrote, kept on its identity row (Personnel has no column)."""
    return next((m[key] for m in meta if isinstance(m.get(key), str)), None)


#: What the snapshot writes that Personnel has no column for — kept on the snapshot identity
#: row, so the next run compares against what IT wrote, not against an operator's later edit.
_KEPT = ("first_name", "last_name", "rank")


async def load_people(
    db: AsyncSession,
) -> tuple[list[LocalPerson], dict[str, Personnel], dict[tuple[str, str], PersonnelExternalIdentity]]:
    """Every person, oldest first, as the reconciliation sees them — plus the rows to write to."""
    rows = list((await db.execute(select(Personnel).order_by(Personnel.created_at, Personnel.id))).scalars())
    by_person: dict[UUID, list[PersonnelExternalIdentity]] = {}
    ident_rows: dict[tuple[str, str], PersonnelExternalIdentity] = {}
    for ident in (await db.execute(select(PersonnelExternalIdentity))).scalars():
        by_person.setdefault(ident.personnel_id, []).append(ident)
        ident_rows[(str(ident.personnel_id), ident.provider)] = ident
    people: list[LocalPerson] = []
    for row in rows:
        idents = by_person.get(row.id, [])
        meta = [i.metadata_json or {} for i in idents]
        people.append(
            LocalPerson(
                id=str(row.id),
                display_name=row.name,
                first_name=_meta_str(meta, "first_name"),
                last_name=_meta_str(meta, "last_name"),
                rank=_meta_str(meta, "rank"),
                active=not any(m.get(_MARK) for m in meta),
                identities={i.provider: i.external_id for i in idents},
            )
        )
    return people, {str(r.id): r for r in rows}, ident_rows


async def apply(
    db: AsyncSession,
    rec: Reconciliation,
    rows: dict[str, Personnel],
    ident_rows: dict[tuple[str, str], PersonnelExternalIdentity],
) -> None:
    """Write one accepted plan. Flushes, never commits."""
    if rec.snapshot is None or rec.refused is not None:
        raise ValueError("a refused plan is never applied")
    provider = rec.snapshot.provider

    def _link(person_id: str, prov: str, external_id: str, meta: dict[str, Any] | None) -> None:
        ident = PersonnelExternalIdentity(
            personnel_id=UUID(person_id), provider=prov, external_id=external_id, metadata_json=meta
        )
        db.add(ident)
        ident_rows[(person_id, prov)] = ident

    for write in rec.creates:
        rank = write.fields.get("rank")
        person = Personnel(
            name=(write.fields.get("display_name") or write.display_name)[:100],
            role=RANK_ROLE.get(rank) if rank else None,
            status="available",
            tags=[],
        )
        db.add(person)
        await db.flush()
        kept = {k: write.fields[k] for k in _KEPT if write.fields.get(k)}
        for prov, external_id in write.links:
            _link(str(person.id), prov, external_id, (kept or None) if prov == provider else None)

    for write in rec.updates:
        pid = str(write.person_id)
        person = rows[pid]
        new_name = write.fields.get("display_name")
        if new_name:
            person.name = new_name[:100]
        for prov, external_id in write.links:
            _link(pid, prov, external_id, None)
        own = ident_rows[(pid, provider)]
        meta = dict(own.metadata_json or {})
        for key in _KEPT:
            if write.fields.get(key):
                meta[key] = write.fields[key]
        rank = write.fields.get("rank")
        if rank:
            person.role = RANK_ROLE.get(rank, person.role)
        if write.reactivate and meta.get(_MARK):
            person.status = meta.get("status_before") or "available"
            meta.pop(_MARK, None)
            meta.pop("status_before", None)
        own.metadata_json = meta or None
    await db.flush()

    for gone in rec.deactivations:
        person = rows[gone.person_id]
        linked = ident_rows.get((gone.person_id, provider))
        if linked is None:  # cannot happen — a deactivated person is linked by now — but never guess
            continue
        meta = dict(linked.metadata_json or {})
        meta[_MARK] = True
        meta["status_before"] = person.status
        linked.metadata_json = meta
        person.status = "unavailable"
    await db.flush()


async def run(db: AsyncSession, *, trigger: str, force: bool = False, skip_unchanged: bool = False) -> dict[str, Any]:
    """Fetch, reconcile, apply, record — and commit. Returns the stored status document.

    ⚠️ Rolled back BEFORE a failure is recorded, so a half-applied plan never rides out on the
    back of its own error report.
    """
    source = settings.roster_snapshot_source.strip()
    if not source:
        raise ValueError("no roster snapshot source configured (ROSTER_SNAPSHOT_SOURCE)")
    previous = await read_status(db) or {}
    last_good = LastGood.from_json(previous.get("lastGood"))
    now = datetime.now(UTC).isoformat()

    try:
        raw = await read_source(source, settings.roster_snapshot_token or None)
    except ValueError as e:
        await db.rollback()
        status = {
            **previous,
            "trigger": trigger,
            "outcome": refused_outcome(str(e), last_good=last_good).model_dump(mode="json", by_alias=True),
            "held": False,
            "unchanged": False,
            "pendingDeactivations": 0,
            "lastAttempt": now,
            "lastError": str(e)[:400],
        }
        await _write_status(db, status)
        await db.commit()
        return status

    try:
        people, rows, ident_rows = await load_people(db)
        rec = reconcile(
            raw,
            people,
            known_ranks=RANK_ROLE.keys(),
            max_deactivate_pct=settings.roster_snapshot_max_deactivate_pct,
            last_good=last_good,
            force=force,
            skip_unchanged=skip_unchanged,
            now=datetime.now(UTC),
        )
        applied_at = previous.get("appliedAt")
        if rec.refused is None and not rec.unchanged:
            await apply(db, rec, rows, ident_rows)
            applied_at = now
            out = rec.outcome
            await log_action(
                db,
                action_type="sync",
                resource_type="personnel",
                changes={
                    "source": "roster-snapshot",
                    "provider": rec.snapshot.provider if rec.snapshot else None,
                    "trigger": trigger,
                    "created": out.created,
                    "updated": out.updated,
                    "deactivated": out.deactivated,
                },
            )
        status = {
            **status_json(rec, trigger=trigger, last_good=last_good, applied_at=applied_at),
            "lastAttempt": now,
            "lastSuccess": now if rec.refused is None else previous.get("lastSuccess"),
            "lastError": rec.refused[:400] if rec.refused else None,
        }
        await _write_status(db, status)
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Roster snapshot run failed")
        raise
    logger.info(
        "Roster snapshot (%s): %s — +%d created, %d updated, %d deactivated, %d unmatched",
        trigger,
        "refused: " + rec.refused if rec.refused else ("unchanged" if rec.unchanged else "applied"),
        rec.outcome.created,
        rec.outcome.updated,
        rec.outcome.deactivated,
        len(rec.outcome.unmatched),
    )
    return status


async def _cli(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.services.roster_snapshot_sync")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run", help="read the snapshot now and apply it")
    p_run.add_argument("--force", action="store_true", help="release a run the deactivation cap held")
    sub.add_parser("status", help="print the last run's report")
    args = parser.parse_args(argv)

    from ..database import async_session_maker

    async with async_session_maker() as db:
        if args.cmd == "status":
            print(json.dumps(await read_status(db), indent=2, ensure_ascii=False))
            return 0
        if not configured():
            print("ERROR: ROSTER_SNAPSHOT_SOURCE is not set", file=sys.stderr)
            return 1
        status = await run(db, trigger="cli", force=args.force)
    print(json.dumps(status, indent=2, ensure_ascii=False))
    return 0 if not status["outcome"].get("refused") else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(_cli(sys.argv[1:])))
