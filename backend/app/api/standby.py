"""The standby box and the hosted board: who leads an Ereignis, the sync between them, conflicts.

On a standby box (`DEPLOYMENT_ROLE=standby`, app/standby.py): how current the mirror is, and
«Dieses Ereignis offline übernehmen». On the hosted board: which Ereignisse a box leads, «Hier
übernehmen» to take one back, and the box's way in – `POST /sync` and the photo routes, with a
token (`STANDBY_SYNC_TOKEN`). Conflicts are listed on both and decided on the one that leads.
docs/STANDBY.md is the operator's side.
"""

import hmac
import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Body, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..database import get_db
from ..environment import ROLE_STANDBY, deployment_role
from ..middleware.rate_limit import RateLimits, limiter
from ..models import JournalEntry, User
from ..services.photo_storage import photo_storage
from ..standby import Lead, MirrorState, StandbyError, hosted_leads, mirror_state, take_over
from ..standby_sync import CONFLICTS, HOSTED, STANDBY, Op, apply_ops, event_tables
from ..websocket_manager import broadcast_group_update, broadcast_incident_update

router = APIRouter(prefix="/standby", tags=["standby"])

# When the box last reached this hosted board, per Ereignis, and what it had not sent yet.
# In memory: it is a heartbeat, renewed every few seconds, and the backend runs one process.
_contact: dict[uuid.UUID, tuple[datetime, int]] = {}


async def _driver(db: AsyncSession) -> asyncpg.Connection:
    """The asyncpg connection under the request's session – same transaction, same commit."""
    raw = await (await db.connection()).get_raw_connection()
    conn: asyncpg.Connection = raw.driver_connection
    return conn


def _side() -> str:
    return STANDBY if deployment_role() == ROLE_STANDBY else HOSTED


def _lead_json(event_id: uuid.UUID, lead: Lead) -> dict[str, Any]:
    contact_at, pending = lead.contact_at, lead.pending
    if _side() == HOSTED and event_id in _contact:
        contact_at, pending = _contact[event_id]
    return {
        "event_id": str(event_id),
        "holder": lead.holder,
        "since": lead.since,
        "taken_by": lead.taken_by,
        "pending": pending,
        "contact_at": contact_at,
        "open_conflicts": lead.open_conflicts,
    }


def _payload(state: MirrorState) -> dict[str, Any]:
    return {
        "mirror": True,
        "configured": state.configured,
        "current": state.current,
        "last_received_at": state.last_received_at,
        "detached": [
            {"event_id": str(event_id), "detached_at": at}
            for event_id, at in sorted(state.detached.items(), key=lambda kv: kv[1])
        ],
        "leads": [_lead_json(event_id, lead) for event_id, lead in state.leads.items()],
    }


def _refresh(background_tasks: BackgroundTasks) -> None:
    """Every open board re-reads – after the commit, like every other push."""
    background_tasks.add_task(broadcast_incident_update, {}, "refresh")
    background_tasks.add_task(broadcast_group_update, {}, "refresh")


def _journal(db: AsyncSession, event_id: uuid.UUID, user: User, text: str) -> None:
    db.add(
        JournalEntry(
            event_id=event_id,
            kind="manual",
            text=text,
            author_name=user.display_name or user.username,
            created_by=user.id,
        )
    )


@router.get("", response_model=None)
async def standby_status(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """Is this a mirror, how current, and which Ereignisse are led where.

    Unauthenticated, like `/api/deployment`: the band speaks on the login screen too. It carries
    timestamps, counts and Ereignis ids, nothing else. On a hosted board `leads` lists the
    Ereignisse a standby box took over at some point (usually none).
    """
    conn = await _driver(db)
    if deployment_role() == ROLE_STANDBY:
        return _payload(await mirror_state(conn))
    leads = await hosted_leads(conn)
    return {"mirror": False, "leads": [_lead_json(event_id, lead) for event_id, lead in leads.items()]}


@router.post("/events/{event_id}/takeover", response_model=None)
async def take_event_offline(
    event_id: uuid.UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """«Dieses Ereignis offline übernehmen» on the box. Editors and admins.

    From now on the Ereignis is led here; the sidecar syncs it with the hosted board both ways
    (app/standby_sync.py), so the hosted board shows the work here and may take it back.
    """
    if deployment_role() != ROLE_STANDBY:
        raise HTTPException(status_code=404, detail="Dieses System ist kein Standby.")
    conn = await _driver(db)
    try:
        await take_over(conn, event_id, current_user.display_name or current_user.username)
    except StandbyError as exc:
        status = 404 if exc.stage == "unknown_event" else 409
        detail = (
            "Ereignis nicht gefunden." if status == 404 else "Der Standby ist auf diesem System nicht eingerichtet."
        )
        raise HTTPException(status_code=status, detail=detail) from exc
    _journal(db, event_id, current_user, "Führung übernommen auf KP Rück Offline")
    await db.flush()
    _refresh(background_tasks)
    return _payload(await mirror_state(conn))


@router.post("/events/{event_id}/lead", response_model=None)
async def take_event_back(
    event_id: uuid.UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """«Hier übernehmen» on the hosted board: take an Ereignis back from the box. Editors and admins.

    The box learns it with its next sync round and becomes a mirror of it again; what it changed
    before it knew still arrives – new things are added, clashing edits become conflicts here.
    """
    if deployment_role() == ROLE_STANDBY:
        raise HTTPException(status_code=404, detail="Auf dem Standby heisst das «offline übernehmen».")
    conn = await _driver(db)
    holder = await conn.fetchval("SELECT holder FROM public.event_leads WHERE event_id = $1 FOR UPDATE", event_id)
    if holder != STANDBY:
        raise HTTPException(status_code=409, detail="Dieses Ereignis wird bereits hier geführt.")
    await conn.execute(
        "UPDATE public.event_leads SET holder = 'hosted', since = now(), taken_by = $2 WHERE event_id = $1",
        event_id,
        current_user.display_name or current_user.username,
    )
    _journal(db, event_id, current_user, "Führung übernommen auf KP Rück Online")
    await db.flush()
    _refresh(background_tasks)
    leads = await hosted_leads(conn)
    return {"mirror": False, "leads": [_lead_json(e, lead) for e, lead in leads.items()]}


# --- the box's way in (hosted board, token) --------------------------------------------------


def _require_box(authorization: str | None) -> None:
    """The standby box's token, or nothing here exists."""
    token = settings.standby_sync_token
    given = (authorization or "").removeprefix("Bearer ").strip()
    if deployment_role() == ROLE_STANDBY or not token or not hmac.compare_digest(given, token):
        raise HTTPException(status_code=404, detail="Nicht gefunden.")


class SyncOp(BaseModel):
    table: str
    id: str
    row: dict[str, Any] | None = None
    expected: dict[str, Any] | None = None
    required: bool = False


class SyncIn(BaseModel):
    event_id: uuid.UUID
    ops: list[SyncOp]
    pending: int = 0


@router.post("/sync", response_model=None, include_in_schema=False)
@limiter.limit(RateLimits.STANDBY_SYNC)
async def apply_from_box(
    request: Request,
    body: SyncIn,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """The box's sync round writes here (app/standby_sync.py): ops for one Ereignis, one result each.

    Only rows of that Ereignis, and only of an Ereignis the box has taken over at some point.
    A `required` op (the takeover row) that does not land refuses the whole batch with 409.
    Every call is also the box's heartbeat, which the band on this board reads.
    """
    _require_box(authorization)
    conn = await _driver(db)
    await conn.execute("SET LOCAL TIME ZONE 'UTC'")
    ops = [Op(o.table, o.id, o.row, o.expected, o.required) for o in body.ops]
    results = await apply_ops(conn, await event_tables(conn), body.event_id, ops)
    if any(op.required and result != "ok" for op, result in zip(ops, results, strict=True)):
        raise HTTPException(status_code=409, detail="Die Führung wurde hier inzwischen geändert.")
    if not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM public.event_leads WHERE event_id = $1)", body.event_id):
        raise HTTPException(status_code=403, detail="Dieses Ereignis wurde nie offline übernommen.")
    _contact[body.event_id] = (datetime.now(UTC), body.pending)
    if any(r == "ok" for r in results) and ops:
        _refresh(background_tasks)
    return {"results": results}


class PhotoRef(BaseModel):
    incident_id: uuid.UUID
    name: str


@router.post("/photos/missing", response_model=None, include_in_schema=False)
@limiter.limit(RateLimits.STANDBY_SYNC)
async def photos_missing(
    request: Request,
    photos: Annotated[list[PhotoRef], Body(embed=True)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Which of the box's photos this board does not have yet."""
    _require_box(authorization)
    missing = []
    for ref in photos:
        try:
            if photo_storage.get_photo_path(ref.incident_id, ref.name) is None:
                missing.append(ref.model_dump(mode="json"))
        except HTTPException:
            continue  # not a photo name; never asked for again
    return {"missing": missing}


@router.put("/photos/{incident_id}/{name}", response_model=None, include_in_schema=False)
@limiter.limit(RateLimits.STANDBY_SYNC)
async def photo_from_box(
    incident_id: uuid.UUID,
    name: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """A photo taken on the box, for an Einsatz of an Ereignis the box took over."""
    _require_box(authorization)
    conn = await _driver(db)
    led = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM public.incidents i JOIN public.event_leads l ON l.event_id = i.event_id WHERE i.id = $1)",
        incident_id,
    )
    if not led:
        raise HTTPException(status_code=404, detail="Einsatz nicht gefunden.")
    return {"written": photo_storage.store_synced_photo(incident_id, name, await request.body())}


# --- conflicts (both) --------------------------------------------------------------------------


@router.get("/events/{event_id}/conflicts", response_model=None)
async def list_conflicts(
    event_id: uuid.UUID, _user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, Any]:
    """The conflicts of one Ereignis, open ones first, and whether they can be decided here."""
    conn = await _driver(db)
    rows = await conn.fetch(
        """
        SELECT id, table_name, row_id, kind, kept_on, deleted_on, columns::text, row::text, subject::text,
               lost_at, detected_at, resolved_at, resolved_by, resolution
        FROM public.event_conflicts WHERE event_id = $1
        ORDER BY resolved_at IS NOT NULL, detected_at DESC
        """,
        event_id,
    )
    leader = await conn.fetchval("SELECT holder FROM public.event_leads WHERE event_id = $1", event_id) or HOSTED
    return {
        "decidable": leader == _side(),
        "conflicts": [
            {
                **{k: r[k] for k in ("table_name", "kind", "kept_on", "deleted_on", "lost_at", "detected_at")},
                **{k: r[k] for k in ("resolved_at", "resolved_by", "resolution")},
                "id": str(r["id"]),
                "row_id": str(r["row_id"]),
                "columns": json.loads(r["columns"]) if r["columns"] else None,
                "row": json.loads(r["row"]) if r["row"] else None,
                "subject": json.loads(r["subject"]) if r["subject"] else None,
            }
            for r in rows
        ],
    }


class ResolveIn(BaseModel):
    # kept = the version that stands; other = the one that lost; both = joined text per column
    choice: Literal["kept", "other", "both"]
    text: dict[str, str] | None = None


@router.post("/conflicts/{conflict_id}/resolve", response_model=None)
async def resolve_conflict(
    conflict_id: uuid.UUID,
    body: ResolveIn,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Decide a conflict – on the system that leads its Ereignis. Editors and admins.

    The write is an ordinary one here, so the sync carries it to the other system.
    """
    conn = await _driver(db)
    await conn.execute("SET LOCAL TIME ZONE 'UTC'")
    conflict = await conn.fetchrow(
        "SELECT event_id, table_name, row_id, kind, deleted_on, columns::text AS columns, row::text AS row, resolved_at "
        "FROM public.event_conflicts WHERE id = $1 FOR UPDATE",
        conflict_id,
    )
    if conflict is None:
        raise HTTPException(status_code=404, detail="Konflikt nicht gefunden.")
    event_id = conflict["event_id"]
    leader = await conn.fetchval("SELECT holder FROM public.event_leads WHERE event_id = $1", event_id) or HOSTED
    if leader != _side():
        raise HTTPException(status_code=409, detail="Entschieden wird auf dem System, das das Ereignis führt.")
    if conflict["resolved_at"] is not None:
        raise HTTPException(status_code=409, detail="Dieser Konflikt ist schon entschieden.")
    op = _resolution(conflict, body)
    if op is not None:
        tables = await event_tables(conn)
        current = await conn.fetchval(
            f"SELECT {tables[op.table].row_sql}::text FROM public.{op.table} r WHERE r.{tables[op.table].key} = $1::uuid",  # noqa: S608
            op.id,
        )
        op.expected = json.loads(current) if current else None
        if op.row is not None and op.expected is not None:
            op.row = {**op.expected, **op.row}
        [result] = await apply_ops(conn, tables, event_id, [op])
        if result != "ok":
            raise HTTPException(status_code=409, detail="Das lässt sich so nicht mehr übernehmen.")
    await conn.execute(
        f"UPDATE public.{CONFLICTS} SET resolved_at = now(), resolved_by = $2, resolution = $3 WHERE id = $1",  # noqa: S608  # nosec B608 – a constant
        conflict_id,
        current_user.display_name or current_user.username,
        body.choice,
    )
    _refresh(background_tasks)
    return {"resolved": str(conflict_id), "choice": body.choice}


def _resolution(conflict: asyncpg.Record, body: ResolveIn) -> Op | None:
    """The write a choice means; None for «keep what stands»."""
    if body.choice == "kept":
        return None
    table, row_id, kind = conflict["table_name"], str(conflict["row_id"]), conflict["kind"]
    if kind == "field":
        columns: dict[str, dict[str, Any]] = json.loads(conflict["columns"] or "{}")
        if body.choice == "other":
            return Op(table, row_id, {c: v["lost"] for c, v in columns.items()}, None)
        joined = body.text or {}
        if not joined or any(c not in columns or not columns[c].get("text") for c in joined):
            raise HTTPException(status_code=422, detail="«Beide zusammen» geht nur für Text.")
        return Op(table, row_id, dict(joined), None)
    if kind == "deleted" and body.choice == "other":
        lost = json.loads(conflict["row"] or "null")
        if conflict["deleted_on"] == _side():  # deleted here, changed there: bring it back
            return Op(table, row_id, lost, None)
        return Op(table, row_id, None, None)  # changed here, deleted there: delete it here too
    raise HTTPException(status_code=422, detail="Diese Wahl gibt es für diesen Konflikt nicht.")
