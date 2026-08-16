"""Standard-Auftrag (Auftrag template) API endpoints.

Station configuration rather than event data: these outlive every Lage, are not
event-scoped, and are read by both the settings screen and the Vorlagen row in
the Aufträge-Slide-up. Any signed-in user may read them (the board needs the
list); only editors may change them.
"""

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import auftrag_templates as crud
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auftrag-templates", tags=["auftrag-templates"])


@router.get("/", response_model=list[schemas.AuftragTemplateResponse])
async def list_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[schemas.AuftragTemplateResponse]:
    """List the station's Standard-Aufträge in settings order."""
    templates = await crud.list_templates(db)
    return [schemas.AuftragTemplateResponse.model_validate(t) for t in templates]


@router.post("/", response_model=schemas.AuftragTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: schemas.AuftragTemplateCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.AuftragTemplateResponse:
    """Create a Standard-Auftrag (editor only)."""
    template = await crud.create_template(db, payload, current_user, request)
    return schemas.AuftragTemplateResponse.model_validate(template)


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_templates(
    reorder: schemas.AuftragTemplateReorder,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> None:
    """Persist the settings list order (editor only)."""
    await crud.reorder_templates(db, reorder.template_ids)


@router.patch("/{template_id}", response_model=schemas.AuftragTemplateResponse)
async def update_template(
    template_id: uuid.UUID,
    payload: schemas.AuftragTemplateUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.AuftragTemplateResponse:
    """Update a Standard-Auftrag (editor only). A given ``resources`` list replaces the old one."""
    template = await crud.update_template(db, template_id, payload, current_user, request)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Standard-Auftrag nicht gefunden")
    return schemas.AuftragTemplateResponse.model_validate(template)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> None:
    """Delete a Standard-Auftrag (editor only). Aufträge created from it stay put."""
    if not await crud.delete_template(db, template_id, current_user, request):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Standard-Auftrag nicht gefunden")
