"""Notification API endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/", response_model=list[schemas.NotificationResponse])
async def get_current_notifications(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    event_id: UUID = Query(..., description="Event ID to get notifications for"),
):
    """
    Get all active notifications for the specified event.

    Evaluates all notification rules and returns active (non-dismissed) notifications.
    """
    notifications = await notification_service.evaluate_notifications(db, event_id)
    return notifications


@router.post("/{notification_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_notification(
    notification_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """
    Mark notification as dismissed.

    Any authenticated user can dismiss notifications.
    """
    notification = await notification_service.dismiss_notification(db, notification_id, current_user.id)

    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")


@router.get("/settings/", response_model=schemas.NotificationSettings)
async def get_notification_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """
    Get current notification threshold settings.

    Available to all authenticated users.
    """
    settings = await notification_service.get_notification_settings(db)
    return settings


@router.patch("/settings/", response_model=schemas.NotificationSettings)
async def update_notification_settings(
    settings_update: schemas.NotificationSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Update notification thresholds (Editor only).

    Only editors can modify notification settings.
    """
    # Get current settings
    current_settings = await notification_service.get_notification_settings(db)

    # Apply updates (only fields that are not None)
    update_data = settings_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_settings, field, value)

    # Save updated settings
    updated_settings = await notification_service.save_notification_settings(db, current_settings, current_user.id)

    return updated_settings
