"""Regie API (`/training/events/{id}/regie`): the Übungs-Steuerung's Autopilot, tempo, pause and steps.

The logic lives in `services/training_regie.py`; these routes guard, call it and answer with
the page's whole state. Every write also broadcasts `training_regie` after the commit.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..schemas import RegieHoldRequest, RegieStateResponse, RegieStepRequest, RegieUpdateRequest
from ..services import training_regie
from ..services.training_steps import StepRefusedError
from .training_simulate import get_event_incident, require_training_event

router = APIRouter(prefix="/training", tags=["training"])


@router.get("/events/{event_id}/regie", response_model=RegieStateResponse)
async def get_regie(
    event_id: UUID, current_user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> RegieStateResponse:
    """The Regie page: switches, every open incident with its next steps and due times, «Vorhin»."""
    await require_training_event(db, event_id)
    return await training_regie.build_state(db, event_id)


@router.put("/events/{event_id}/regie", response_model=RegieStateResponse)
async def put_regie(
    event_id: UUID,
    payload: RegieUpdateRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> RegieStateResponse:
    """Switch the Autopilot, set the tempo (ruhig/normal/sturm) or pause/resume the whole Übung."""
    await require_training_event(db, event_id)
    return await training_regie.update_regie(db, event_id, payload, current_user)


@router.put("/events/{event_id}/regie/hold/{incident_id}", response_model=RegieStateResponse)
async def put_regie_hold(
    event_id: UUID,
    incident_id: UUID,
    payload: RegieHoldRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> RegieStateResponse:
    """«Halten»: the Autopilot leaves this incident alone (``held=false`` releases it)."""
    await require_training_event(db, event_id)
    await get_event_incident(db, event_id, incident_id)
    return await training_regie.set_held(db, event_id, incident_id, payload.held, current_user)


@router.post("/events/{event_id}/regie/step/{incident_id}", response_model=RegieStateResponse)
async def post_regie_step(
    event_id: UUID,
    incident_id: UUID,
    payload: RegieStepRequest,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> RegieStateResponse:
    """«Jetzt»: run one step of the incident now. 409 when it is not one of its current steps.

    ``pickup_needed`` answers «Kommt der Trupp selbst zurück?» for ``field_complete``; null lets
    the situation decide.
    """
    await require_training_event(db, event_id)
    try:
        return await training_regie.step_now(
            db,
            event_id,
            incident_id,
            payload.key,
            user=current_user,
            pickup_needed=payload.pickup_needed,
            request=request,
        )
    except (training_regie.NotCurrentStepError, StepRefusedError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
