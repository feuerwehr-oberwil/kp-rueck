"""API routes."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db

router = APIRouter()


# ============================================
# Incident endpoints (formerly Operations)
# ============================================


@router.get("/incidents", response_model=list[schemas.IncidentResponse])
async def read_incidents(
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
) -> list[schemas.IncidentResponse]:
    """Get all incidents (requires authentication)."""
    incidents = await crud.get_incidents(db, skip=skip, limit=limit)
    return incidents


@router.get("/incidents/{incident_id}", response_model=schemas.IncidentResponse)
async def read_incident(
    incident_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
) -> schemas.IncidentResponse:
    """Get a specific incident (requires authentication)."""
    db_incident = await crud.get_incident(db, incident_id=incident_id)
    if db_incident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Einsatz nicht gefunden")
    return db_incident


@router.post("/incidents", response_model=schemas.IncidentResponse, status_code=status.HTTP_201_CREATED)
async def create_incident(
    incident: schemas.IncidentCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.IncidentResponse:
    """Create a new incident (editor only)."""
    return await crud.create_incident(db=db, incident=incident)


@router.put("/incidents/{incident_id}", response_model=schemas.IncidentResponse)
async def update_incident(
    incident_id: UUID,
    incident: schemas.IncidentUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.IncidentResponse:
    """Update an incident (editor only)."""
    db_incident = await crud.update_incident(db, incident_id=incident_id, incident=incident)
    if db_incident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Einsatz nicht gefunden")
    return db_incident


@router.delete("/incidents/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> None:
    """Delete an incident (editor only)."""
    success = await crud.delete_incident(db, incident_id=incident_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Einsatz nicht gefunden")


