"""The standby box's own endpoints: how current the mirror is, and taking one Ereignis offline.

Only meaningful with `DEPLOYMENT_ROLE=standby` (app/standby.py, docs/STANDBY.md); elsewhere the
status says `mirror: false` and the takeover answers 404, so a hosted board has nothing to press.
"""

import uuid
from typing import Annotated, Any

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor
from ..database import get_db
from ..environment import ROLE_STANDBY, deployment_role
from ..standby import MirrorState, StandbyError, detach_event, mirror_state
from ..websocket_manager import broadcast_group_update, broadcast_incident_update

router = APIRouter(prefix="/standby", tags=["standby"])


async def _driver(db: AsyncSession) -> asyncpg.Connection:
    """The asyncpg connection under the request's session – same transaction, same commit."""
    raw = await (await db.connection()).get_raw_connection()
    conn: asyncpg.Connection = raw.driver_connection
    return conn


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
    }


@router.get("", response_model=None)
async def standby_status(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    """Is this box a mirror, how current is it, and which Ereignisse were taken offline.

    Unauthenticated, like `/api/deployment`: the band says «Spiegel … nur ansehen» on the login
    screen too. It carries a timestamp and Ereignis ids, nothing else.
    """
    if deployment_role() != ROLE_STANDBY:
        return {"mirror": False}
    return _payload(await mirror_state(await _driver(db)))


@router.post("/events/{event_id}/takeover", response_model=None)
async def take_event_offline(
    event_id: uuid.UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Take one Ereignis offline on this box, for good. Editors and admins.

    From now on nothing the hosted board does to this Ereignis arrives here, even once it is
    reachable again; every other Ereignis keeps mirroring. There is no way back in the app –
    carrying the work back to the hosted board is the Ausfall-SOP's «Wiederanlauf».
    """
    if deployment_role() != ROLE_STANDBY:
        raise HTTPException(status_code=404, detail="Dieses System ist kein Standby.")
    conn = await _driver(db)
    try:
        await detach_event(conn, event_id, current_user.username)
    except StandbyError as exc:
        status = 404 if exc.stage == "unknown_event" else 409
        detail = (
            "Ereignis nicht gefunden." if status == 404 else "Der Standby ist auf diesem System nicht eingerichtet."
        )
        raise HTTPException(status_code=status, detail=detail) from exc
    # Every open board re-reads: the band turns amber and the controls unlock.
    background_tasks.add_task(broadcast_incident_update, {}, "refresh")
    background_tasks.add_task(broadcast_group_update, {}, "refresh")
    return _payload(await mirror_state(conn))
