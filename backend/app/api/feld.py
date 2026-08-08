"""`/feld` — the login-less field surface (plan 25).

One global QR per Ereignis; everyone in the field finds themselves in a list and
sees exactly their own Schadenplätze. Phase 0 is the door only: the picker, the
list, and the Einsatzleiter briefing on every row. Nothing here writes.

**Authorization is two-step on every single endpoint** and neither step is
optional:

1. ``validate_feld_token`` turns the link's token into an event id, else 401.
   A ``checkin`` / ``viewer`` / ``reko_dashboard`` / ``alarm`` token does not
   open this door.
2. The caller's personnel row must have an ``incident_assignments`` row for an
   incident in that event — active **or already released** — else 403. This is
   decision 4 ("visibility is only mine") and it lives in ``crud/feld.py``, not
   in the UI.

Privacy (§9): neither a token nor any owner field may be interpolated into a log
line here. The field surface is the first place kp-rueck touches citizen PII.
"""

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..crud import events as events_crud
from ..crud import feld as crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Event, Personnel
from ..services.tokens import generate_feld_token, validate_feld_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feld", tags=["feld"])


async def require_feld_event(
    token: str = Query(..., description="Access token from the generated /feld link"),
) -> uuid.UUID:
    """Step 1: the token must be a valid, unexpired `feld` token."""
    event_id = validate_feld_token(token)
    if event_id is None:
        raise HTTPException(status_code=401, detail="Ungültiger oder abgelaufener Zugriffscode")
    return event_id


FeldEventId = Annotated[uuid.UUID, Depends(require_feld_event)]


async def _load_event(db: AsyncSession, event_id: uuid.UUID) -> Event:
    """The event the token names, or 404."""
    event = await events_crud.get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Ereignis nicht gefunden")
    return event


async def require_feld_person(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> Personnel:
    """Step 2, person-scoped: this person must have an assignment in this event.

    An unknown personnel id gets the same 403 as a known-but-unassigned one —
    a public token must not become a way to probe which UUIDs exist.
    """
    if not await crud.person_has_event_assignment(db, event_id, personnel_id):
        raise HTTPException(
            status_code=403,
            detail="Für diese Person ist in diesem Ereignis keine Einsatzstelle erfasst.",
        )
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    person = result.scalar_one_or_none()
    if person is None:
        # Only reachable if the personnel row vanished between the two queries.
        raise HTTPException(
            status_code=403,
            detail="Für diese Person ist in diesem Ereignis keine Einsatzstelle erfasst.",
        )
    return person


@router.post("/generate-link", response_model=dict)
async def generate_feld_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for the field surface"),
) -> dict[str, str]:
    """
    Generate the `/feld` link with QR code (editor only).

    One global link per Ereignis — no per-incident and no per-vehicle links.
    Long-lived (30 days), because it goes on a printed poster.
    """
    token = generate_feld_token(event_id)
    link = f"/feld?token={token}"

    base_url = str(request.base_url).rstrip("/")

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend generates the QR code from this
    }


@router.get("/personnel", response_model=schemas.FeldPersonnelListResponse)
@limiter.limit(RateLimits.FELD)
async def list_feld_personnel(
    request: Request,
    event_id: FeldEventId,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldPersonnelListResponse:
    """
    The person picker: everyone with an assignment in this event.

    Token only — no login. Deliberately not the roster: a person with no
    assignment has nothing to file, and listing them would produce an empty page
    with no explanation instead of the "melde dich beim KP" sentence.
    """
    event = await _load_event(db, event_id)
    personnel = await crud.get_feld_personnel_for_event(db, event_id)

    return schemas.FeldPersonnelListResponse(
        personnel=[schemas.FeldPersonnel(**p) for p in personnel],
        event_id=event.id,
        event_name=event.name,
    )


@router.get("/assignments/{personnel_id}", response_model=schemas.FeldAssignmentsResponse)
@limiter.limit(RateLimits.FELD)
async def get_feld_assignments(
    request: Request,
    personnel_id: uuid.UUID,
    event_id: FeldEventId,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldAssignmentsResponse:
    """
    "Meine Einsatzstellen" — this person's Schadenplätze in this event.

    Each row carries the rapport state, the two field timestamps, and the
    Einsatzleiter of that incident (decision 22): the EL is briefed before any
    form opens, never enforced.
    """
    event = await _load_event(db, event_id)
    person = await require_feld_person(db, event_id, personnel_id)

    assignments = await crud.get_feld_assignments_for_personnel(db, event_id, personnel_id)

    return schemas.FeldAssignmentsResponse(
        personnel_id=person.id,
        personnel_name=person.name,
        personnel_role=person.role,
        event_id=event.id,
        event_name=event.name,
        assignments=[schemas.FeldAssignment(**a) for a in assignments],
    )
