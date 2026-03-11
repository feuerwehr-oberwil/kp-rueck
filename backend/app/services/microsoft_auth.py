"""Microsoft Entra ID (OIDC) authentication service.

Handles the authorization code flow:
1. Exchange auth code for tokens
2. Validate ID token against Microsoft's JWKS
3. Extract user identity (email, display name)

This module is only used when MICROSOFT_CLIENT_ID etc. are configured.
"""

import logging

import httpx
import jwt as pyjwt
from jwt import PyJWKClient

from ..config import settings

logger = logging.getLogger(__name__)

# Lazy-initialized JWKS client (caches Microsoft's public keys)
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    """Get or create the JWKS client for Microsoft's signing keys."""
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/discovery/v2.0/keys"
        _jwks_client = PyJWKClient(jwks_url)
    return _jwks_client


async def exchange_code_for_tokens(auth_code: str) -> dict:
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

    token_data = response.json()
    if "id_token" not in token_data:
        raise ValueError("No id_token in Microsoft token response")

    return token_data


def validate_and_decode_id_token(id_token: str) -> dict:
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
    )

    return claims
