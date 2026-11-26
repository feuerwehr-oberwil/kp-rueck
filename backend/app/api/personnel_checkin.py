"""Personnel check-in API endpoints.

Every write here has **two doors** (plan 26 decision 11): the check-in link's token, which
is what a crew member's phone carries, and an editor session, which is what the board
carries. One handler, one CRUD call, one row — not a ``…-by-editor`` twin per route that
would have to be kept in step forever. The price is that an auth change can break the
phone, which is why the parity suite asserts the token door first.

``token`` and ``event_id`` are both optional and **exactly one** must be given. Both at
once is refused rather than resolved: that is the request shape where a stale token could
silently outvote the event the operator is looking at.
"""

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, get_current_user
from ..crud import personnel_checkin as crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import User
from ..services import share_links
from ..services.tokens import link_claims
from ..utils.error_codes import CodedHTTPException, ErrorCode
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_personnel_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/personnel/check-in", tags=["personnel-checkin"])


async def _resolve_event_and_actor(
    *,
    request: Request,
    token: str | None,
    event_id: uuid.UUID | None,
    access_token: str | None,
    db: AsyncSession,
    require_editor: bool = True,
) -> tuple[uuid.UUID, User | None]:
    """Open one of the two doors and return (event, who walked through it).

    A ``None`` user is the field door — the check-in link is anonymous by design, so a
    write through it genuinely has no identity to record. A user is the board.
    """
    if (token is None) == (event_id is None):
        raise HTTPException(
            status_code=422,
            detail="Entweder 'token' oder 'event_id' angeben, nicht beides.",
        )

    if token is not None or event_id is None:
        # `event_id is None` is unreachable — the XOR above already refused it — but it is
        # what narrows `event_id` for the type checker on the way out.
        resolved = await share_links.event_of(db, "checkin", token or "")
        if not resolved:
            raise HTTPException(status_code=401, detail=ErrorMessages.LINK_INVALID)
        return resolved, None

    user = await get_current_user(request, access_token, db)
    if require_editor and user.role not in ("editor", "admin"):
        raise HTTPException(status_code=403, detail="Bearbeiter-Berechtigung erforderlich")
    return event_id, user


@router.post("/generate-link", response_model=schemas.ShareLinkResponse)
async def generate_checkin_link(
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for check-in"),
    db: AsyncSession = Depends(get_db),
) -> schemas.ShareLinkResponse:
    """
    Generate check-in link with QR code (editor only).

    Returns shareable link and QR code data scoped to a specific event.
    Place this button next to "Neuer Einsatz" in the UI.
    """
    token = await share_links.issue(db, "checkin", event_id)
    if token is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.EVENT_NOT_FOUND)
    return schemas.ShareLinkResponse.for_link(token, f"/check-in?token={token}")


@router.get("/list", response_model=schemas.CheckInListResponse)
async def list_personnel_for_checkin(
    request: Request,
    token: str | None = Query(default=None, description="Access token from QR code"),
    event_id: uuid.UUID | None = Query(default=None, description="Event ID (board, requires a session)"),
    checked_in_only: bool = Query(default=False, description="Only show checked-in personnel"),
    include_unavailable: bool = Query(
        default=False, description="List unavailable personnel too (board roll-call shows them disabled)"
    ),
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> schemas.CheckInListResponse:
    """
    Get list of personnel for check-in interface with event information.

    Two doors: the check-in token (phone) or a logged-in session with an explicit
    `event_id` (board). Reading the roll-call is not an edit, so a viewer may do it.
    Unavailable personnel are hidden unless asked for.
    """
    resolved_event_id, _user = await _resolve_event_and_actor(
        request=request,
        token=token,
        event_id=event_id,
        access_token=access_token,
        db=db,
        require_editor=False,
    )

    # Get event information
    from ..crud import events as events_crud

    event = await events_crud.get_event_by_id(db, resolved_event_id)
    if not event:
        raise HTTPException(status_code=404, detail=ErrorMessages.EVENT_NOT_FOUND)

    personnel = await crud.get_available_personnel(
        db=db,
        event_id=resolved_event_id,
        include_checked_out=not checked_in_only,
        include_unavailable=include_unavailable,
    )

    return schemas.CheckInListResponse(
        # Pydantic validates each PersonnelCheckInResponse into the narrower PersonnelListItem
        # by attribute (from_attributes=True); mypy cannot express that model-to-model coercion.
        personnel=personnel,  # type: ignore[arg-type]
        event_id=event.id,
        event_name=event.name,
    )


def _guest_link_key(request: Request) -> str:
    """The guest door's rate-limit bucket per LINK (Ereignis + generation), not per address: a
    station NATs every phone behind one address. Read from the verified claims, never the raw
    token – slowapi logs the key, and a raw key would let junk tokens mint buckets. Every
    unreadable token shares one bucket."""
    token = request.query_params.get("token", "")
    claims = link_claims(token, "checkin") if len(token) <= 2048 else None
    return f"checkin-guest:{claims.event_id}:{claims.generation}" if claims else "checkin-guest:invalid"


@router.post("/guest", response_model=schemas.PersonnelCheckInResponse)
# slowapi checks the innermost decorator first: the address backstop, then the link.
@limiter.limit(RateLimits.CHECKIN_GUEST_PER_LINK, key_func=_guest_link_key)
@limiter.limit(RateLimits.CHECKIN_GUEST_PER_ADDRESS)
async def check_in_guest(
    guest: schemas.CheckInGuest,
    background_tasks: BackgroundTasks,
    request: Request,
    token: str = Query(..., description="Access token from the check-in link"),
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """«‹Name› als Gast einchecken» – somebody at the door who is not on the list.

    The link's door only (no editor twin on this route: the board adds a guest with
    `POST /api/personnel/` + `guest_event_id`, then checks them in). A name that is
    already listed at this Ereignis checks that person in instead of making a second one;
    a name the door cannot settle (two people of that name, somebody unavailable, the
    Ereignis's guest limit) is a 409 `checkin_guest_ask_kp`. Rate-limited per link, with a
    looser per-address backstop. The link is checked under a share lock on the Ereignis row
    (`share_links.event_of(lock=True)`), so a revoke or a delete cannot slip in before the write.
    """
    event_id = await share_links.event_of(db, "checkin", token, lock=True)
    if not event_id:
        raise HTTPException(status_code=401, detail=ErrorMessages.LINK_INVALID)

    try:
        person, created = await crud.check_in_guest(db=db, event_id=event_id, name=guest.name, request=request)
    except crud.GuestCheckInRefusedError as e:
        logger.info("Guest check-in refused: %s", e.reason)
        raise CodedHTTPException(
            status_code=409, code=ErrorCode.CHECKIN_GUEST_ASK_KP, detail="Bitte beim KP melden."
        ) from None

    background_tasks.add_task(
        broadcast_personnel_update,
        {
            "id": str(person.id),
            "name": person.name,
            "role": person.role,
            "status": person.status,
            "checked_in": person.checked_in,
            "event_id": str(event_id),
        },
        "create" if created else "update",
    )

    return person


@router.post("/{personnel_id}/in", response_model=schemas.PersonnelCheckInResponse)
async def check_in(
    personnel_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    request: Request,
    token: str | None = Query(default=None, description="Access token from the check-in link"),
    event_id: uuid.UUID | None = Query(default=None, description="Event ID (board, requires an editor session)"),
    resume: datetime | None = Query(
        default=None,
        description=(
            "Board only: undo the check-out that answered this `checked_out_at` – the same stint"
            " continues (check-in time and plan kept). 409 when that departure is no longer there."
        ),
    ),
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """
    Check in a person (mark as present for the event).

    Either a valid check-in token or an editor session with `event_id`.
    `resume` (editor session only) takes back exactly that check-out instead of starting a
    new stint, or answers 409 when the person was checked in or out again meanwhile.
    Broadcasts real-time update via WebSocket.
    """
    event_id, current_user = await _resolve_event_and_actor(
        request=request,
        token=token,
        event_id=event_id,
        access_token=access_token,
        db=db,
    )

    try:
        person = await crud.check_in_personnel(
            db=db,
            event_id=event_id,
            personnel_id=personnel_id,
            current_user=current_user,
            request=request,
            # The link has no «Auschecken» to take back; only the board resumes a stint.
            resume=resume if current_user is not None else None,
        )
    except crud.CheckOutChangedError as e:
        raise HTTPException(
            status_code=409, detail="Die Anwesenheit hat sich inzwischen geändert – nicht mehr rückgängig zu machen."
        ) from e

    if not person:
        raise HTTPException(status_code=404, detail=ErrorMessages.PERSONNEL_NOT_FOUND)

    # Broadcast WebSocket update for check-in
    if background_tasks:
        background_tasks.add_task(
            broadcast_personnel_update,
            {
                "id": str(person.id),
                "name": person.name,
                "role": person.role,
                "status": person.status,
                "checked_in": person.checked_in,
                "event_id": str(event_id),
            },
            "update",
        )

    return person


@router.post("/{personnel_id}/out", response_model=schemas.PersonnelCheckInResponse)
async def check_out(
    personnel_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    request: Request,
    token: str | None = Query(default=None, description="Access token from the check-in link"),
    event_id: uuid.UUID | None = Query(default=None, description="Event ID (board, requires an editor session)"),
    only_if_free: bool = Query(
        default=False,
        description="Board: refuse (409) when an assignment or a function still binds the person",
    ),
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """
    Check out a person from the event (mark as left).

    Either a valid check-in token or an editor session with `event_id`.
    An assigned person is refused through the phone (it has no way to release the
    assignment) and allowed through the board, which warns first and leaves the
    assignment standing.
    `only_if_free` is the board's check-out without a question: 409 when the person is
    bound after all (its view was stale), so it can ask first.
    Broadcasts real-time update via WebSocket.
    """
    event_id, current_user = await _resolve_event_and_actor(
        request=request,
        token=token,
        event_id=event_id,
        access_token=access_token,
        db=db,
    )

    person = await crud.check_out_personnel(
        db=db,
        event_id=event_id,
        personnel_id=personnel_id,
        current_user=current_user,
        request=request,
        allow_assigned=current_user is not None,
        refuse_bound=only_if_free,
    )

    if not person:
        raise HTTPException(status_code=404, detail=ErrorMessages.PERSONNEL_NOT_FOUND)

    # Broadcast WebSocket update for check-out
    if background_tasks:
        background_tasks.add_task(
            broadcast_personnel_update,
            {
                "id": str(person.id),
                "name": person.name,
                "role": person.role,
                "status": person.status,
                "checked_in": person.checked_in,
                "event_id": str(event_id),
            },
            "update",
        )

    return person


@router.put("/{personnel_id}/plan", response_model=schemas.PersonnelCheckInResponse)
async def set_plan(
    personnel_id: uuid.UUID,
    plan: schemas.AttendancePlanUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    token: str | None = Query(default=None, description="Access token from the check-in link"),
    event_id: uuid.UUID | None = Query(default=None, description="Event ID (board, requires an editor session)"),
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """«kommt um» / «geht um» – the Appell's time chip, or the person on the check-in link.

    Two doors like check-in: the link's token (somebody giving their own «bis 22:00» at the
    door) or an editor session with `event_id` (the KP, from a radio message). Only the
    fields sent change; null clears one. Broadcasts the same `personnel_update` as a tick,
    so the Appell and the pickers show the new time without a reload.
    """
    event_id, current_user = await _resolve_event_and_actor(
        request=request,
        token=token,
        event_id=event_id,
        access_token=access_token,
        db=db,
    )

    person = await crud.set_attendance_plan(
        db=db,
        event_id=event_id,
        personnel_id=personnel_id,
        plan=plan,
        current_user=current_user,
        request=request,
    )

    if not person:
        raise HTTPException(status_code=404, detail=ErrorMessages.PERSONNEL_NOT_FOUND)

    background_tasks.add_task(
        broadcast_personnel_update,
        {
            "id": str(person.id),
            "name": person.name,
            "role": person.role,
            "status": person.status,
            "checked_in": person.checked_in,
            "event_id": str(event_id),
        },
        "update",
    )

    return person


@router.delete("/{personnel_id}", response_model=schemas.PersonnelCheckInResponse)
async def clear_attendance(
    personnel_id: uuid.UUID,
    current_user: CurrentEditor,  # Board only — the phone has no "was never here" to report
    background_tasks: BackgroundTasks,
    request: Request,
    event_id: uuid.UUID = Query(..., description="Event whose attendance row is removed"),
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """Back to "nicht anwesend" — the third step of the board's roll-call cycle.

    Deliberately editor-only and board-only. A crew member's phone can say they
    arrived and that they left; "I was never here" is a correction of the record,
    which belongs to whoever keeps it. Idempotent: clearing a person who has no
    attendance row simply reports them absent.
    """
    person = await crud.clear_personnel_attendance(
        db=db,
        event_id=event_id,
        personnel_id=personnel_id,
        current_user=current_user,
        request=request,
    )
    if not person:
        raise HTTPException(status_code=404, detail=ErrorMessages.PERSONNEL_NOT_FOUND)

    if background_tasks:
        background_tasks.add_task(
            broadcast_personnel_update,
            {
                "id": str(person.id),
                "name": person.name,
                "role": person.role,
                "status": person.status,
                "checked_in": person.checked_in,
                "event_id": str(event_id),
            },
            "update",
        )

    return person


@router.post("/event/{event_id}/out-all", response_model=list[schemas.PersonnelCheckInResponse])
async def check_out_all(
    event_id: uuid.UUID,
    current_user: CurrentEditor,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> list[schemas.PersonnelCheckInResponse]:
    """
    Send everyone still present at this Ereignis home ("Alle abmelden").

    Board only, deliberately: the phone is a self-report and nobody checks thirty-four
    other people out from it. That asymmetry is the direction the parity rule does not
    police — a route with no field twin is fine, a *field* route with no board twin is
    the hole this plan closes.

    Already-departed rows keep their own departure time, nobody gains a row they never
    had, and no assignment is released.
    """
    checked_out = await crud.check_out_all_personnel(
        db=db,
        event_id=event_id,
        current_user=current_user,
        request=request,
    )

    if checked_out:
        # One broadcast for the whole sweep rather than 34 — every listener reacts by
        # refetching anyway, and a burst would just make them do it 34 times.
        background_tasks.add_task(
            broadcast_personnel_update,
            {"event_id": str(event_id), "checked_out": len(checked_out)},
            "update",
        )

    return checked_out


@router.get("/stats", response_model=dict)
async def get_checkin_stats(
    request: Request,
    token: str | None = Query(default=None, description="Access token from the check-in link"),
    event_id: uuid.UUID | None = Query(default=None, description="Event ID (board, requires a session)"),
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """
    Get check-in statistics for the event.

    Either a valid check-in token or a session with `event_id`.

    `left` is the third number the board's roll-call header needs: people who came and
    then went, which is not the same fact as never having come. `checked_out` is kept
    as it was — "not currently present" — so the phone's reading of it does not move.
    """
    resolved_event_id, _user = await _resolve_event_and_actor(
        request=request,
        token=token,
        event_id=event_id,
        access_token=access_token,
        db=db,
        require_editor=False,
    )

    all_personnel = await crud.get_available_personnel(db, event_id=resolved_event_id, include_checked_out=True)
    checked_in = [p for p in all_personnel if p.checked_in]
    left = [p for p in all_personnel if not p.checked_in and p.checked_out_at is not None]

    return {
        "total_available": len(all_personnel),
        "checked_in": len(checked_in),
        "checked_out": len(all_personnel) - len(checked_in),
        "left": len(left),
    }
