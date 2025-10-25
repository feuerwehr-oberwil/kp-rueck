"""Event API endpoints."""
from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import events as crud
from ..database import get_db

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/", response_model=schemas.EventListResponse)
async def list_events(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    include_archived: bool = False,
    skip: int = 0,
    limit: int = Query(default=100, le=500),
):
    """
    List all events (excluding archived by default).

    Args:
        include_archived: Include archived events in results
        skip: Pagination offset
        limit: Max number of results (max 500)
    """
    events = await crud.get_events(
        db,
        include_archived=include_archived,
        skip=skip,
        limit=limit
    )

    # Add incident counts
    event_responses = []
    for event in events:
        incident_count = await crud.get_event_incident_count(db, event.id)
        event_dict = {
            "id": event.id,
            "name": event.name,
            "training_flag": event.training_flag,
            "created_at": event.created_at,
            "updated_at": event.updated_at,
            "archived_at": event.archived_at,
            "last_activity_at": event.last_activity_at,
            "incident_count": incident_count,
        }
        event_responses.append(schemas.EventResponse.model_validate(event_dict))

    return schemas.EventListResponse(
        events=event_responses,
        total=len(events)
    )


@router.get("/{event_id}", response_model=schemas.EventResponse)
async def get_event(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Get a single event by ID."""
    event = await crud.get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    incident_count = await crud.get_event_incident_count(db, event.id)
    event_dict = {
        "id": event.id,
        "name": event.name,
        "training_flag": event.training_flag,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "archived_at": event.archived_at,
        "last_activity_at": event.last_activity_at,
        "incident_count": incident_count,
    }

    return schemas.EventResponse.model_validate(event_dict)


@router.post("/", response_model=schemas.EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    event_data: schemas.EventCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,  # Only editors can create
):
    """Create a new event (editor only)."""
    event = await crud.create_event(db, event_data)

    event_dict = {
        "id": event.id,
        "name": event.name,
        "training_flag": event.training_flag,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "archived_at": event.archived_at,
        "last_activity_at": event.last_activity_at,
        "incident_count": 0,
    }

    return schemas.EventResponse.model_validate(event_dict)


@router.put("/{event_id}", response_model=schemas.EventResponse)
async def update_event(
    event_id: uuid.UUID,
    event_data: schemas.EventUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Update an event (editor only)."""
    event = await crud.update_event(db, event_id, event_data)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    incident_count = await crud.get_event_incident_count(db, event.id)
    event_dict = {
        "id": event.id,
        "name": event.name,
        "training_flag": event.training_flag,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "archived_at": event.archived_at,
        "last_activity_at": event.last_activity_at,
        "incident_count": incident_count,
    }

    return schemas.EventResponse.model_validate(event_dict)


@router.post("/{event_id}/archive", response_model=schemas.EventResponse)
async def archive_event(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Archive an event (soft delete, editor only)."""
    event = await crud.archive_event(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    incident_count = await crud.get_event_incident_count(db, event.id)
    event_dict = {
        "id": event.id,
        "name": event.name,
        "training_flag": event.training_flag,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "archived_at": event.archived_at,
        "last_activity_at": event.last_activity_at,
        "incident_count": incident_count,
    }

    return schemas.EventResponse.model_validate(event_dict)


@router.post("/{event_id}/unarchive", response_model=schemas.EventResponse)
async def unarchive_event(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Unarchive an event (restore from archive, editor only)."""
    event = await crud.unarchive_event(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    incident_count = await crud.get_event_incident_count(db, event.id)
    event_dict = {
        "id": event.id,
        "name": event.name,
        "training_flag": event.training_flag,
        "created_at": event.created_at,
        "updated_at": event.updated_at,
        "archived_at": event.archived_at,
        "last_activity_at": event.last_activity_at,
        "incident_count": incident_count,
    }

    return schemas.EventResponse.model_validate(event_dict)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Permanently delete an event (editor only).

    Event must be archived first before it can be deleted.
    """
    try:
        success = await crud.delete_event(db, event_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Event not found"
            )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    return None
