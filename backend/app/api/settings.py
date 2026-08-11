"""Settings API endpoints."""

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Setting
from ..services import branding
from ..services import settings as settings_service
from ..services.audit import log_action
from ..services.settings import DEFAULT_SETTINGS

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/", response_model=dict[str, str])
async def get_all_settings(current_user: CurrentUser, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """Get all settings (any authenticated user)."""
    return await settings_service.get_all_settings(db)


# ---------------------------------------------------------------------------
# Station logo for printed exports.
#
# Its own three endpoints rather than the generic key/value pair above: the value is
# image bytes, so it is served with an image content type (an <img src> can point at
# it directly), written through a validating, re-encoding upload, and kept out of the
# settings dict the page fetches on every visit. Declared before `GET /{key}` for
# readability only — that route matches a single path segment and could never have
# swallowed these two-segment paths.
# ---------------------------------------------------------------------------


@router.get("/branding/logo")
async def get_report_logo(current_user: CurrentUser, db: AsyncSession = Depends(get_db)) -> Response:
    """The station logo as a PNG, or 404 when none is set."""
    png = await branding.get_report_logo(db)
    if png is None:
        raise HTTPException(status_code=404, detail="Kein Logo hinterlegt")
    # no-cache: the settings page has to show a replaced logo immediately, and the
    # payload is ~100 KB fetched on two screens — there is nothing here worth caching.
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.put("/branding/logo", response_model=dict[str, int])
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def upload_report_logo(
    request: Request,
    current_user: CurrentEditor,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Upload/replace the station logo (editor only). Returns the stored size in bytes."""
    # One byte past the cap, so an oversized upload is refused rather than read whole.
    raw = await file.read(branding.MAX_UPLOAD_BYTES + 1)
    user_id = current_user.id if current_user.username != "master-token" else None
    size = await branding.store_report_logo(db, raw, user_id, file.content_type)

    await log_action(
        db=db,
        action_type="update",
        resource_type="setting",
        resource_id=None,
        user=current_user,
        changes={"key": branding.LOGO_SETTING_KEY, "before": None, "after": f"{size} bytes"},
        request=request,
    )
    await db.commit()
    return {"size": size}


@router.delete("/branding/logo", status_code=204)
async def delete_report_logo(
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove the station logo (editor only). Idempotent."""
    user_id = current_user.id if current_user.username != "master-token" else None
    await branding.clear_report_logo(db, user_id)
    await log_action(
        db=db,
        action_type="update",
        resource_type="setting",
        resource_id=None,
        user=current_user,
        changes={"key": branding.LOGO_SETTING_KEY, "before": "gesetzt", "after": None},
        request=request,
    )
    await db.commit()
    return Response(status_code=204)


@router.get("/{key}", response_model=schemas.Setting)
async def get_setting(key: str, current_user: CurrentUser, db: AsyncSession = Depends(get_db)) -> Setting:
    """Get single setting. Credential-valued keys are not served here."""
    if key in settings_service.SECRET_SETTING_KEYS:
        # Masking the value in the list endpoint would be pointless if this one handed it
        # over by name. The DSN has a redacted read at GET /api/sync/config; the webhook
        # secret is provisioned from the environment.
        raise HTTPException(
            status_code=403,
            detail="Dieser Wert ist ein Zugangsdatum und wird hier nicht ausgegeben.",
        )

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
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    request: Request = None,  # type: ignore[assignment]
) -> Setting:
    """Update setting (editor only)."""
    # Only allow updates to known settings keys. The underlying service creates a
    # row for any key, so without this guard an editor could inject arbitrary keys.
    if key not in DEFAULT_SETTINGS:
        raise HTTPException(status_code=404, detail="Unknown setting key")

    # ...and `railway_database_url` was in DEFAULT_SETTINGS, so the guard above admitted
    # the exact key the old comment claimed it protected. That value is fed straight into
    # `create_async_engine` (services/sync_service.py), i.e. it decides where this backend
    # opens an outbound database connection and pushes events, incidents, personnel,
    # vehicles, materials and settings. It has a dedicated endpoint that validates and
    # redacts it — PUT /api/sync/config — and that is now the only way in.
    if key in settings_service.GENERIC_WRITE_DENYLIST:
        raise HTTPException(status_code=403, detail=settings_service.GENERIC_WRITE_DENY_REASONS[key])

    # Get old value for audit logging
    old_value = await settings_service.get_setting(db, key)

    # Update setting (use None for non-DB users like master token)
    user_id = current_user.id if current_user.username != "master-token" else None
    setting = await settings_service.update_setting(db, key, update.value, user_id)

    # Log the change
    await log_action(
        db=db,
        action_type="update",
        resource_type="setting",
        resource_id=None,  # Settings don't have UUIDs
        user=current_user,
        changes={"key": key, "before": old_value, "after": update.value},
        request=request,
    )
    await db.commit()

    return setting
