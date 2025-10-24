"""Settings API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..models import Setting
from ..services import settings as settings_service
from ..services.audit import log_action

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/", response_model=dict[str, str])
async def get_all_settings(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """Get all settings (any authenticated user)."""
    return await settings_service.get_all_settings(db)


@router.get("/{key}", response_model=schemas.Setting)
async def get_setting(
    key: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """Get single setting."""
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    return setting


@router.patch("/{key}", response_model=schemas.Setting)
async def update_setting(
    key: str,
    update: schemas.SettingUpdate,
    current_user: CurrentEditor,  # Editor only
    db: AsyncSession = Depends(get_db),
    request: Request = None
):
    """Update setting (editor only)."""
    # Get old value for audit logging
    old_value = await settings_service.get_setting(db, key)

    # Update setting
    setting = await settings_service.update_setting(
        db, key, update.value, current_user.id
    )

    # Log the change
    await log_action(
        db=db,
        action_type="update",
        resource_type="setting",
        resource_id=None,  # Settings don't have UUIDs
        user=current_user,
        changes={
            "key": key,
            "before": old_value,
            "after": update.value
        },
        request=request
    )
    await db.commit()

    return setting
