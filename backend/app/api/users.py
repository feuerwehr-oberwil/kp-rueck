"""User management API endpoints (admin only)."""

import logging
import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentAdmin
from ..auth.security import hash_password
from ..config import settings
from ..database import get_db
from ..models import User
from ..services.audit import log_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


def _hash_user_password(password: str) -> str:
    """Translate password policy failures without exposing supplied credentials."""
    try:
        return hash_password(password)
    except ValueError:
        raise HTTPException(status_code=400, detail="Passwort erfüllt die Passwortanforderungen nicht.") from None


@router.get("/", response_model=list[schemas.UserResponse])
async def list_users(
    current_user: CurrentAdmin,
    db: AsyncSession = Depends(get_db),
) -> Sequence[User]:
    """
    List all users (admin only).

    Returns all users including inactive ones.
    """
    result = await db.execute(select(User).order_by(User.username))
    users = result.scalars().all()
    return users


@router.get("/{user_id}", response_model=schemas.UserResponse)
async def get_user(
    user_id: uuid.UUID,
    current_user: CurrentAdmin,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get a specific user by ID (admin only).
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")

    return user


@router.post("/", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: schemas.UserCreate,
    current_user: CurrentAdmin,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Create a new user (admin only).

    Args:
        user_data: User creation data including username, password, role, display_name
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Benutzerverwaltung ist im Demo-Modus nicht verfügbar",
        )

    # Check if username already exists
    existing = await db.execute(select(User).where(User.username == user_data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Benutzername bereits vergeben")

    # Validate role
    if user_data.role not in ("admin", "editor", "viewer"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültige Rolle. Erlaubt: admin, editor")

    # Create user
    user = User(
        username=user_data.username,
        password_hash=_hash_user_password(user_data.password),
        role=user_data.role,
        display_name=user_data.display_name or user_data.username,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    # Audit log
    await log_action(
        db=db,
        action_type="create",
        resource_type="user",
        resource_id=user.id,
        user=current_user,
        changes={"username": user.username, "role": user.role, "display_name": user.display_name},
        request=request,
    )
    await db.commit()

    logger.info("User %s created by admin %s", user.username, current_user.username)
    return user


@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user(
    user_id: uuid.UUID,
    user_data: schemas.UserUpdate,
    current_user: CurrentAdmin,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Update a user (admin only).

    Can update username, role, display_name, is_active.
    Cannot update password here - use reset-password endpoint.
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Benutzerverwaltung ist im Demo-Modus nicht verfügbar",
        )

    result = await db.execute(select(User).where(User.id == user_id).with_for_update())
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")

    # Prevent admin from deactivating themselves
    if user.id == current_user.id and user_data.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sie können sich nicht selbst deaktivieren")

    # Prevent admin from removing their own admin role
    if user.id == current_user.id and user_data.role and user_data.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Sie können Ihre eigene Admin-Rolle nicht entfernen"
        )

    # Check for username conflict
    if user_data.username and user_data.username != user.username:
        existing = await db.execute(select(User).where(User.username == user_data.username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Benutzername bereits vergeben")

    # Validate role if provided
    if user_data.role and user_data.role not in ("admin", "editor", "viewer"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ungültige Rolle. Erlaubt: admin, editor")

    if user.is_active and user_data.is_active is False:
        await db.execute(update(User).where(User.id == user_id).values(session_version=User.session_version + 1))

    # Track changes for audit log
    changes: dict[str, dict[str, Any]] = {}
    update_data = user_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        old_value = getattr(user, key)
        if old_value != value:
            changes[key] = {"old": old_value, "new": value}
            setattr(user, key, value)

    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="user",
            resource_id=user.id,
            user=current_user,
            changes=changes,
            request=request,
        )
        await db.commit()
        await db.refresh(user)
        logger.info("User %s updated by admin %s: %s", user.username, current_user.username, list(changes.keys()))

    return user


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_user_password(
    user_id: uuid.UUID,
    password_data: schemas.UserPasswordReset,
    current_user: CurrentAdmin,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Reset a user's password (admin only).

    Admin sets the new password directly.
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Benutzerverwaltung ist im Demo-Modus nicht verfügbar",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")

    # Hash before mutation. The database increment prevents concurrent resets
    # from losing an invalidation, and commits atomically with the new password.
    password_hash = _hash_user_password(password_data.new_password)
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=password_hash, session_version=User.session_version + 1)
    )

    await log_action(
        db=db,
        action_type="password_reset",
        resource_type="user",
        resource_id=user.id,
        user=current_user,
        changes={"action": "password_reset_by_admin"},
        request=request,
    )
    await db.commit()

    logger.info("Password reset for user %s by admin %s", user.username, current_user.username)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    current_user: CurrentAdmin,
    request: Request,
    db: AsyncSession = Depends(get_db),
    permanent: bool = False,
) -> None:
    """
    Deactivate or permanently delete a user (admin only).

    By default, soft-deletes by setting is_active=False.
    With permanent=true, permanently removes the user from the database.
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Benutzerverwaltung ist im Demo-Modus nicht verfügbar",
        )

    result = await db.execute(select(User).where(User.id == user_id).with_for_update())
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")

    # Prevent admin from deleting themselves
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sie können sich nicht selbst löschen",
        )

    username = user.username  # Store for logging before potential delete

    if permanent:
        # Permanent delete
        await db.delete(user)
        await log_action(
            db=db,
            action_type="delete",
            resource_type="user",
            resource_id=user_id,
            user=current_user,
            changes={"username": username, "action": "permanently_deleted"},
            request=request,
        )
        await db.commit()
        logger.info("User %s permanently deleted by admin %s", username, current_user.username)
    else:
        # A later reactivation must not resurrect credentials from before deactivation.
        if user.is_active:
            await db.execute(update(User).where(User.id == user_id).values(session_version=User.session_version + 1))
        user.is_active = False
        await log_action(
            db=db,
            action_type="deactivate",
            resource_type="user",
            resource_id=user.id,
            user=current_user,
            changes={"username": username, "action": "deactivated"},
            request=request,
        )
        await db.commit()
        logger.info("User %s deactivated by admin %s", username, current_user.username)
