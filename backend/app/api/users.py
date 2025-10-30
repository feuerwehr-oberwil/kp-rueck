"""User management API endpoints (editors only)."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..auth.dependencies import CurrentEditor
from ..database import get_db
from ..services.audit import log_action

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=schemas.UserListResponse)
async def list_users(
    current_user: CurrentEditor,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
):
    """
    List all users (editors only).

    Returns list of all users with their details (excluding password hashes).
    """
    users = await crud.get_users(db, skip=skip, limit=limit)
    return schemas.UserListResponse(users=users, total=len(users))


@router.post("/", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: Request,
    user: schemas.UserCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new user (editors only).

    Password must meet strength requirements in production:
    - At least 8 characters
    - Contains uppercase, lowercase, and digit

    In development, passwords can be simpler (min 3 chars).

    SECURITY: Editors can create both editor and viewer accounts.
    """
    # Check if username already exists
    existing_user = await crud.get_user_by_username(db, user.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Benutzername bereits vergeben"
        )

    # Create user
    new_user = await crud.create_user(db, user)

    # Log user creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="user",
        resource_id=new_user.id,
        user=current_user,
        changes={
            "username": new_user.username,
            "role": new_user.role,
        },
        request=request
    )

    await db.commit()
    await db.refresh(new_user)

    return new_user


@router.get("/{user_id}", response_model=schemas.UserResponse)
async def get_user(
    user_id: UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
):
    """
    Get specific user by ID (editors only).

    Returns user details excluding password hash.
    """
    user = await crud.get_user(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Benutzer nicht gefunden"
        )

    return user


@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user(
    request: Request,
    user_id: UUID,
    user_update: schemas.UserUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
):
    """
    Update user (editors only).

    Can update:
    - Username (must be unique)
    - Role (editor/viewer)
    - Password (will be hashed)

    SECURITY: Editors can reset other users' passwords without knowing the current password.
    """
    # Check if user exists
    existing_user = await crud.get_user(db, user_id)
    if not existing_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Benutzer nicht gefunden"
        )

    # If username is being changed, check for conflicts
    if user_update.username and user_update.username != existing_user.username:
        username_conflict = await crud.get_user_by_username(db, user_update.username)
        if username_conflict:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Benutzername bereits vergeben"
            )

    # Track changes for audit log
    changes = {}
    if user_update.username:
        changes["username"] = {"old": existing_user.username, "new": user_update.username}
    if user_update.role:
        changes["role"] = {"old": existing_user.role, "new": user_update.role}
    if user_update.password:
        changes["password"] = "reset"

    # Update user
    updated_user = await crud.update_user(db, user_id, user_update)

    # Log user update
    await log_action(
        db=db,
        action_type="update",
        resource_type="user",
        resource_id=user_id,
        user=current_user,
        changes=changes,
        request=request
    )

    await db.commit()
    await db.refresh(updated_user)

    return updated_user


@router.delete("/{user_id}")
async def delete_user(
    request: Request,
    user_id: UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete user (editors only).

    SECURITY: Users cannot delete themselves.
    This prevents accidentally locking out all editors.
    """
    # Prevent self-deletion
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sie können Ihr eigenes Konto nicht löschen"
        )

    # Check if user exists
    user_to_delete = await crud.get_user(db, user_id)
    if not user_to_delete:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Benutzer nicht gefunden"
        )

    # Log user deletion before deleting
    await log_action(
        db=db,
        action_type="delete",
        resource_type="user",
        resource_id=user_id,
        user=current_user,
        changes={
            "username": user_to_delete.username,
            "role": user_to_delete.role,
        },
        request=request
    )

    # Delete user
    success = await crud.delete_user(db, user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Fehler beim Löschen des Benutzers"
        )

    await db.commit()

    return {"message": "Benutzer erfolgreich gelöscht"}
