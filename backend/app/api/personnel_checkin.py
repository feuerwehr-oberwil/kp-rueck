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
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Header, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, get_current_user
from ..crud import personnel_checkin as crud
from ..database import get_db
from ..models import User
from ..services.tokens import generate_checkin_token, validate_checkin_token
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
    authorization: str | None,
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
        resolved = validate_checkin_token(token or "")
        if not resolved:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return resolved, None

    user = await get_current_user(request, access_token, authorization, db)
    if require_editor and user.role not in ("editor", "admin"):
        raise HTTPException(status_code=403, detail="Editor-Berechtigung erforderlich")
    return event_id, user


@router.post("/generate-link", response_model=dict)
async def generate_checkin_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for check-in"),
) -> dict[str, str]:
    """
    Generate check-in link with QR code (editor only).

    Returns shareable link and QR code data scoped to a specific event.
    Place this button next to "Neuer Einsatz" in the UI.
    """
    token = generate_checkin_token(event_id)
    link = f"/check-in?token={token}"

    # Get base URL from request
    base_url = str(request.base_url).rstrip("/")

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend will generate QR code from this
    }


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
    authorization: Annotated[str | None, Header()] = None,
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
        authorization=authorization,
        db=db,
        require_editor=False,
    )

    # Get event information
    from ..crud import events as events_crud

    event = await events_crud.get_event_by_id(db, resolved_event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

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


@router.post("/{personnel_id}/in", response_model=schemas.PersonnelCheckInResponse)
async def check_in(
    personnel_id: uuid.UUID,
    token: str | None = Query(default=None, description="Access token from the check-in link"),
    event_id: uuid.UUID | None = Query(default=None, description="Event ID (board, requires an editor session)"),
    access_token: Annotated[str | None, Cookie()] = None,
    authorization: Annotated[str | None, Header()] = None,
    # FastAPI injects these two by type, so the `= None` defaults never apply. They cannot be
    # dropped (they precede other defaulted params) and must NOT become `X | None`: FastAPI only
    # special-cases the bare classes, so a Union turns them into body params and the app fails
    # to import.
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    request: Request = None,  # type: ignore[assignment]
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """
    Check in a person (mark as present for the event).

    Either a valid check-in token or an editor session with `event_id`.
    Broadcasts real-time update via WebSocket.
    """
    event_id, current_user = await _resolve_event_and_actor(
        request=request,
        token=token,
        event_id=event_id,
        access_token=access_token,
        authorization=authorization,
        db=db,
    )

    try:
        person = await crud.check_in_personnel(
            db=db,
            event_id=event_id,
            personnel_id=personnel_id,
            current_user=current_user,
            request=request,
        )
    except ValueError as e:
        logger.warning("Personnel check-in failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e

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
    token: str | None = Query(default=None, description="Access token from the check-in link"),
    event_id: uuid.UUID | None = Query(default=None, description="Event ID (board, requires an editor session)"),
    access_token: Annotated[str | None, Cookie()] = None,
    authorization: Annotated[str | None, Header()] = None,
    # Same as check_in above: injected by type, `= None` is dead, `X | None` would break FastAPI.
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    request: Request = None,  # type: ignore[assignment]
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """
    Check out a person from the event (mark as left).

    Either a valid check-in token or an editor session with `event_id`.
    An assigned person is refused through the phone (it has no way to release the
    assignment) and allowed through the board, which warns first and leaves the
    assignment standing.
    Broadcasts real-time update via WebSocket.
    """
    event_id, current_user = await _resolve_event_and_actor(
        request=request,
        token=token,
        event_id=event_id,
        access_token=access_token,
        authorization=authorization,
        db=db,
    )

    try:
        person = await crud.check_out_personnel(
            db=db,
            event_id=event_id,
            personnel_id=personnel_id,
            current_user=current_user,
            request=request,
            allow_assigned=current_user is not None,
        )
    except ValueError as e:
        # Only reachable through the field door now. It used to escape as a 500.
        logger.warning("Personnel check-out failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e

    if not person:
        raise HTTPException(status_code=404, detail="Personnel not found")

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
    authorization: Annotated[str | None, Header()] = None,
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
        authorization=authorization,
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
