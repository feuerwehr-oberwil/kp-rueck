"""Personnel check-in API endpoints."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..crud import personnel_checkin as crud
from ..database import get_db
from ..services.tokens import generate_checkin_token, validate_checkin_token

router = APIRouter(prefix="/personnel/check-in", tags=["personnel-checkin"])


@router.post("/generate-link", response_model=dict)
async def generate_checkin_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
):
    """
    Generate check-in link with QR code (editor only).

    Returns shareable link and QR code data.
    Place this button next to "Neuer Einsatz" in the UI.
    """
    token = generate_checkin_token()
    link = f"/check-in?token={token}"

    # Get base URL from request
    base_url = str(request.base_url).rstrip('/')

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend will generate QR code from this
    }


@router.get("/list", response_model=list[schemas.PersonnelListItem])
async def list_personnel_for_checkin(
    token: str = Query(..., description="Access token from QR code"),
    checked_in_only: bool = Query(default=False, description="Only show checked-in personnel"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get list of personnel for check-in interface.

    Requires valid token (no user authentication).
    Excludes unavailable personnel.
    """
    if not validate_checkin_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    personnel = await crud.get_available_personnel(
        db=db,
        include_checked_out=not checked_in_only,
    )
    return personnel


@router.post("/{personnel_id}/in", response_model=schemas.PersonnelCheckInResponse)
async def check_in(
    personnel_id: uuid.UUID,
    token: str = Query(..., description="Access token"),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Check in a person (mark as present).

    Requires valid token (no user authentication).
    """
    if not validate_checkin_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        person = await crud.check_in_personnel(
            db=db,
            personnel_id=personnel_id,
            current_user=None,  # No user auth
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not person:
        raise HTTPException(status_code=404, detail="Personnel not found")

    return person


@router.post("/{personnel_id}/out", response_model=schemas.PersonnelCheckInResponse)
async def check_out(
    personnel_id: uuid.UUID,
    token: str = Query(..., description="Access token"),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Check out a person (mark as left).

    Requires valid token (no user authentication).
    """
    if not validate_checkin_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    person = await crud.check_out_personnel(
        db=db,
        personnel_id=personnel_id,
        current_user=None,  # No user auth
        request=request,
    )

    if not person:
        raise HTTPException(status_code=404, detail="Personnel not found")

    return person


@router.get("/stats", response_model=dict)
async def get_checkin_stats(
    token: str = Query(..., description="Access token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get check-in statistics.

    Requires valid token.
    Returns counts of checked-in, available, and total personnel.
    """
    if not validate_checkin_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    all_personnel = await crud.get_available_personnel(db, include_checked_out=True)
    checked_in = [p for p in all_personnel if p.checked_in]

    return {
        "total_available": len(all_personnel),
        "checked_in": len(checked_in),
        "checked_out": len(all_personnel) - len(checked_in),
    }
