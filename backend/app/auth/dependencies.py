"""FastAPI dependency injection for authentication."""

import logging
import uuid
from datetime import UTC
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from .config import auth_settings
from .security import decode_token
from .token_blocklist import token_blocklist

logger = logging.getLogger(__name__)


async def get_current_user(
    request: Request, access_token: Annotated[str | None, Cookie()] = None, db: AsyncSession = Depends(get_db)
) -> User:
    """
    Get the currently authenticated user from JWT cookie.

    Dependency injection:
        current_user: User = Depends(get_current_user)

    Raises:
        HTTPException 401: If token missing, invalid, or user not found

    Note: If AUTH_BYPASS_AUTH_DEV is enabled (development only), returns a mock editor user.
    """
    # Development bypass mode - return mock user
    if auth_settings.is_auth_bypassed:
        # Create a mock user for development
        from datetime import datetime

        mock_user = User(
            id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
            username="dev-user",
            password_hash="",  # Not used in bypass mode
            role="editor",
            created_at=datetime.now(UTC),  # Required field
            last_login=None,
        )
        # Set on request state for logging/audit
        request.state.user = mock_user
        return mock_user

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Check if token present
    if not access_token:
        logger.debug("No access_token cookie found")
        raise credentials_exception

    try:
        # Decode token (never log token content for security)
        payload = decode_token(access_token)

        # Verify token type
        if payload.get("type") != "access":
            raise credentials_exception

        # Check if token has been revoked (logout)
        jti = payload.get("jti")
        if jti and await token_blocklist.is_revoked(jti):
            logger.debug("Token has been revoked")
            raise credentials_exception

        # Extract user ID
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception

        user_id = uuid.UUID(user_id_str)

    except JWTError:
        logger.debug("JWT decoding failed")
        raise credentials_exception
    except ValueError:  # Invalid UUID
        logger.debug("Invalid user ID format in token")
        raise credentials_exception

    # Load user from database
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        logger.debug("User from token not found in database")
        raise credentials_exception

    logger.debug("User authenticated: %s", user.username)

    # Set user on request state for middleware access
    request.state.user = user

    return user


async def get_current_editor(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """
    Verify current user has 'editor' role.

    Dependency injection:
        current_user: User = Depends(get_current_editor)

    Raises:
        HTTPException 403: If user is not an editor
    """
    if current_user.role != "editor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor-Berechtigung erforderlich")
    return current_user


# Convenience type aliases
CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentEditor = Annotated[User, Depends(get_current_editor)]
