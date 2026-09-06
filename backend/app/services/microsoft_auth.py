"""Microsoft Entra ID (OIDC) authentication service.

Handles the authorization code flow:
1. Exchange auth code for tokens
2. Validate ID token against Microsoft's JWKS
3. Extract user identity (email, display name)

This module is only used when MICROSOFT_CLIENT_ID etc. are configured.
"""

import base64
import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt as pyjwt
from jwt import PyJWKClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import MicrosoftLoginTransaction

logger = logging.getLogger(__name__)

# Lazy-initialized JWKS client (caches Microsoft's public keys)
_jwks_client: PyJWKClient | None = None

LOGIN_TRANSACTION_SECONDS = 600
LOGIN_COOKIE = "microsoft_login_browser"


@dataclass(frozen=True)
class MicrosoftLoginStart:
    """Public redirect and separate browser proof for one login attempt."""

    authorization_url: str
    browser_secret: str


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def start_login(db: AsyncSession) -> MicrosoftLoginStart:
    """Create a short-lived, browser-bound PKCE transaction; prune abandoned attempts."""
    now = datetime.now(UTC)
    state = secrets.token_urlsafe(32)
    browser_secret = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    nonce = secrets.token_urlsafe(32)
    await db.execute(delete(MicrosoftLoginTransaction).where(MicrosoftLoginTransaction.expires_at <= now))
    db.add(
        MicrosoftLoginTransaction(
            state_hash=_digest(state),
            browser_hash=_digest(browser_secret),
            code_verifier=verifier,
            nonce=nonce,
            expires_at=now + timedelta(seconds=LOGIN_TRANSACTION_SECONDS),
        )
    )
    await db.commit()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    params = urlencode(
        {
            "client_id": settings.microsoft_client_id,
            "response_type": "code",
            "redirect_uri": settings.microsoft_redirect_uri,
            "scope": "openid profile email",
            "response_mode": "query",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return MicrosoftLoginStart(
        f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/oauth2/v2.0/authorize?{params}",
        browser_secret,
    )


async def consume_login(db: AsyncSession, state: str, browser_secret: str | None) -> MicrosoftLoginTransaction:
    """Atomically consume the browser's transaction before any external token exchange."""
    if not browser_secret:
        raise ValueError("Missing browser transaction")
    transaction = (
        await db.execute(
            delete(MicrosoftLoginTransaction)
            .where(
                MicrosoftLoginTransaction.state_hash == _digest(state),
                MicrosoftLoginTransaction.browser_hash == _digest(browser_secret),
                MicrosoftLoginTransaction.expires_at > datetime.now(UTC),
            )
            .returning(MicrosoftLoginTransaction)
        )
    ).scalar_one_or_none()
    # Commit separately: failures later in login must never make the state reusable.
    await db.commit()
    if transaction is None:
        raise ValueError("Invalid or expired browser transaction")
    return transaction


def _get_jwks_client() -> PyJWKClient:
    """Get or create the JWKS client for Microsoft's signing keys."""
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/discovery/v2.0/keys"
        _jwks_client = PyJWKClient(jwks_url)
    return _jwks_client


async def exchange_code_for_tokens(auth_code: str, code_verifier: str) -> dict[str, Any]:
    """Exchange an authorization code for tokens via Microsoft's token endpoint.

    Args:
        auth_code: The authorization code from the redirect callback.

    Returns:
        Token response dict containing id_token, access_token, etc.

    Raises:
        httpx.HTTPStatusError: If token exchange fails.
        ValueError: If response doesn't contain expected tokens.
    """
    token_url = f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/oauth2/v2.0/token"

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            token_url,
            data={
                "client_id": settings.microsoft_client_id,
                "client_secret": settings.microsoft_client_secret,
                "code": auth_code,
                "code_verifier": code_verifier,
                "redirect_uri": settings.microsoft_redirect_uri,
                "grant_type": "authorization_code",
                "scope": "openid profile email",
            },
        )

    if response.status_code != 200:
        error_data = response.json()
        error_desc = error_data.get("error_description", "Token exchange failed")
        logger.error("Microsoft token exchange failed: %s", error_desc)
        raise ValueError(f"Token exchange failed: {error_desc}")

    token_data: dict[str, Any] = response.json()
    if "id_token" not in token_data:
        raise ValueError("No id_token in Microsoft token response")

    return token_data


def validate_and_decode_id_token(id_token: str, nonce: str) -> dict[str, Any]:
    """Validate and decode a Microsoft ID token.

    Verifies the RS256 signature against Microsoft's JWKS endpoint,
    checks audience (client_id) and issuer (tenant).

    Args:
        id_token: The JWT ID token from Microsoft.

    Returns:
        Decoded token claims dict.

    Raises:
        jwt.PyJWTError: If token validation fails.
    """
    jwks_client = _get_jwks_client()
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)

    claims = pyjwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.microsoft_client_id,
        issuer=f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/v2.0",
        options={"require": ["exp", "iss", "aud", "nonce"]},
    )

    token_nonce = claims.get("nonce")
    if not isinstance(token_nonce, str) or not secrets.compare_digest(token_nonce, nonce):
        raise pyjwt.InvalidTokenError("Invalid login nonce")

    return claims
