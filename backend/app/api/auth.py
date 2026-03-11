"""Authentication API endpoints."""

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.config import auth_settings
from ..auth.dependencies import CurrentUser, get_current_user
from ..auth.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from ..auth.token_blocklist import token_blocklist
from ..config import settings
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import User
from ..services.audit import log_login, log_logout

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/login", response_model=schemas.UserResponse)
@limiter.limit(RateLimits.LOGIN)
async def login(
    request: Request,
    response: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncSession = Depends(get_db),
):
    """
    Login with username and password.

    Returns user data and sets httpOnly cookies with access/refresh tokens.

    Flow:
        1. Verify credentials
        2. Generate JWT tokens
        3. Set httpOnly cookies
        4. Update last_login timestamp
        5. Log login attempt
        6. Return user data
    """
    # Find user by username
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalar_one_or_none()

    # Verify credentials (password_hash can be None for Microsoft-only users)
    if not user or not user.password_hash or not verify_password(form_data.password, user.password_hash):
        # Log failed login attempt if user exists
        if user:
            await log_login(db=db, user=user, request=request, success=False)
            await db.commit()

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Falscher Benutzername oder Passwort",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user is active
    if not user.is_active:
        await log_login(db=db, user=user, request=request, success=False)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Benutzerkonto ist deaktiviert",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create tokens
    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "username": user.username,
            "role": user.role,
        }
    )

    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    # Set httpOnly cookies - explicitly set path="/" to ensure cookies are sent on all paths
    # In production, set AUTH_COOKIE_DOMAIN to share cookies across subdomains
    cookie_kwargs = {
        "path": "/",
        "httponly": auth_settings.COOKIE_HTTPONLY,
        "secure": auth_settings.cookie_secure,
        "samesite": auth_settings.cookie_samesite,
    }
    if auth_settings.cookie_domain:
        cookie_kwargs["domain"] = auth_settings.cookie_domain

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **cookie_kwargs,
    )

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=auth_settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        **cookie_kwargs,
    )

    # Update last login
    user.last_login = datetime.now(UTC)

    # Log successful login
    await log_login(db=db, user=user, request=request, success=True)

    await db.commit()

    return user


@router.post("/refresh", response_model=schemas.UserResponse)
@limiter.limit(RateLimits.DEFAULT)
async def refresh_token(
    request: Request,
    response: Response,
    refresh_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh access token using refresh token.

    Frontend calls this when access token is about to expire (8 hours).
    """
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh-Token fehlt")

    try:
        payload = decode_token(refresh_token)

        # Verify token type
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ungültiger Token-Typ")

        # Check if refresh token has been revoked (logout)
        jti = payload.get("jti")
        if jti and await token_blocklist.is_revoked(jti):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token wurde widerrufen")

        user_id = uuid.UUID(payload.get("sub"))

    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ungültiger Refresh-Token")

    # Load user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Benutzer nicht gefunden")

    # Create new access token
    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "username": user.username,
            "role": user.role,
        }
    )

    # Update cookie - explicitly set path="/" to match login
    cookie_kwargs = {
        "path": "/",
        "httponly": auth_settings.COOKIE_HTTPONLY,
        "secure": auth_settings.cookie_secure,
        "samesite": auth_settings.cookie_samesite,
    }
    if auth_settings.cookie_domain:
        cookie_kwargs["domain"] = auth_settings.cookie_domain

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **cookie_kwargs,
    )

    return user


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    access_token: Annotated[str | None, Cookie()] = None,
    refresh_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Logout by revoking tokens and clearing cookies.

    Adds token JTIs to the blocklist so they cannot be reused,
    even if someone intercepts them before expiry.
    Works whether authenticated or not - just clears cookies.
    """
    # Try to get current user for logging purposes (but don't require it)
    current_user = None
    if access_token:
        try:
            current_user = await get_current_user(request=request, access_token=access_token, db=db)
        except HTTPException:
            # If token is invalid/expired, that's fine - just clear cookies
            pass

    # Revoke access token by adding JTI to blocklist
    if access_token:
        try:
            payload = decode_token(access_token)
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                # Convert exp timestamp to datetime
                expires_at = datetime.fromtimestamp(exp, tz=UTC)
                await token_blocklist.revoke(jti, expires_at)
        except JWTError:
            # Token already invalid, no need to revoke
            pass

    # Revoke refresh token by adding JTI to blocklist
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                expires_at = datetime.fromtimestamp(exp, tz=UTC)
                await token_blocklist.revoke(jti, expires_at)
        except JWTError:
            # Token already invalid, no need to revoke
            pass

    # Log logout event if we have a user
    if current_user:
        await log_logout(db=db, user=current_user, request=request)
        await db.commit()

    # Always clear cookies - must match attributes used when setting them
    cookie_kwargs = {
        "path": "/",
        "httponly": auth_settings.COOKIE_HTTPONLY,
        "secure": auth_settings.cookie_secure,
        "samesite": auth_settings.cookie_samesite,
    }
    if auth_settings.cookie_domain:
        cookie_kwargs["domain"] = auth_settings.cookie_domain

    response.delete_cookie(key="access_token", **cookie_kwargs)
    response.delete_cookie(key="refresh_token", **cookie_kwargs)
    return {"message": "Erfolgreich abgemeldet"}


@router.get("/me", response_model=schemas.UserResponse)
async def get_current_user_info(current_user: CurrentUser):
    """
    Get current authenticated user info.

    Used by frontend to verify authentication status.
    """
    return current_user


@router.get("/microsoft-config", response_model=schemas.MicrosoftAuthConfig)
async def get_microsoft_auth_config():
    """
    Get Microsoft auth configuration for the frontend.

    Returns client_id, tenant_id, and redirect_uri if Microsoft auth is enabled.
    Never exposes the client secret.
    """
    if not settings.microsoft_auth_enabled:
        return schemas.MicrosoftAuthConfig(enabled=False)

    return schemas.MicrosoftAuthConfig(
        enabled=True,
        client_id=settings.microsoft_client_id,
        tenant_id=settings.microsoft_tenant_id,
        redirect_uri=settings.microsoft_redirect_uri,
    )


@router.post("/microsoft-login", response_model=schemas.UserResponse)
@limiter.limit(RateLimits.LOGIN)
async def microsoft_login(
    request: Request,
    response: Response,
    body: schemas.MicrosoftLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Login with Microsoft Entra ID authorization code.

    Flow:
        1. Exchange auth code for tokens via Microsoft
        2. Validate & decode ID token
        3. Extract email and display name
        4. Find or create user
        5. Issue app JWT tokens as httpOnly cookies
    """
    if not settings.microsoft_auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Microsoft-Anmeldung ist nicht konfiguriert",
        )

    from ..services.microsoft_auth import exchange_code_for_tokens, validate_and_decode_id_token

    # 1. Exchange auth code for tokens
    try:
        token_response = await exchange_code_for_tokens(body.code)
    except ValueError as e:
        logger.warning("Microsoft token exchange failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Microsoft-Anmeldung fehlgeschlagen: Code-Austausch ungültig",
        )
    except Exception as e:
        logger.error("Microsoft token exchange error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Verbindung zu Microsoft fehlgeschlagen",
        )

    # 2. Validate & decode ID token
    try:
        claims = validate_and_decode_id_token(token_response["id_token"])
    except Exception as e:
        logger.warning("Microsoft ID token validation failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Microsoft-Token ungültig",
        )

    # 3. Extract identity
    email = claims.get("preferred_username", "").lower().strip()
    display_name = claims.get("name", "")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Keine E-Mail-Adresse im Microsoft-Konto gefunden",
        )

    username = email.split("@")[0]

    # 4. Find or create user
    # First try: lookup by email
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    if not user:
        # Second try: link existing user by username (migration path)
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if user and not user.email:
            user.email = email
            if display_name and not user.display_name:
                user.display_name = display_name
            logger.info("Linked email %s to existing user %s", email, username)

    if not user:
        # Create new user from Microsoft login (default role: editor)
        user = User(
            username=username,
            email=email,
            password_hash=None,
            role="editor",
            display_name=display_name or username,
            is_active=True,
        )
        db.add(user)
        await db.flush()  # Get the ID
        logger.info("Created new user %s from Microsoft login", username)

    # Check if user is active
    if not user.is_active:
        await log_login(db=db, user=user, request=request, success=False)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Benutzerkonto ist deaktiviert",
        )

    # Update display name if changed in Microsoft
    if display_name and user.display_name != display_name:
        user.display_name = display_name

    # 5. Issue app JWT tokens
    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "username": user.username,
            "role": user.role,
        }
    )

    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    # Set httpOnly cookies
    cookie_kwargs = {
        "path": "/",
        "httponly": auth_settings.COOKIE_HTTPONLY,
        "secure": auth_settings.cookie_secure,
        "samesite": auth_settings.cookie_samesite,
    }
    if auth_settings.cookie_domain:
        cookie_kwargs["domain"] = auth_settings.cookie_domain

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **cookie_kwargs,
    )

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=auth_settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        **cookie_kwargs,
    )

    # Update last login
    user.last_login = datetime.now(UTC)

    # Log successful login
    await log_login(db=db, user=user, request=request, success=True)

    await db.commit()

    return user
