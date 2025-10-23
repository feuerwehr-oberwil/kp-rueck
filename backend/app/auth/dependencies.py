"""FastAPI dependency injection for authentication."""
from typing import Annotated
import uuid

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from .security import decode_token


async def get_current_user(
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Get the currently authenticated user from JWT cookie.

    Dependency injection:
        current_user: User = Depends(get_current_user)

    Raises:
        HTTPException 401: If token missing, invalid, or user not found
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Check if token present
    if not access_token:
        raise credentials_exception

    try:
        # Decode token
        payload = decode_token(access_token)

        # Verify token type
        if payload.get("type") != "access":
            raise credentials_exception

        # Extract user ID
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception

        user_id = uuid.UUID(user_id_str)

    except JWTError:
        raise credentials_exception
    except ValueError:  # Invalid UUID
        raise credentials_exception

    # Load user from database
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    return user


async def get_current_editor(
    current_user: Annotated[User, Depends(get_current_user)]
) -> User:
    """
    Verify current user has 'editor' role.

    Dependency injection:
        current_user: User = Depends(get_current_editor)

    Raises:
        HTTPException 403: If user is not an editor
    """
    if current_user.role != "editor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Editor role required for this operation"
        )
    return current_user


# Convenience type aliases
CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentEditor = Annotated[User, Depends(get_current_editor)]
