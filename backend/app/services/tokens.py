"""Token generation and validation for check-in forms and reko forms."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import jwt

from ..config import get_settings

settings = get_settings()


def generate_checkin_token(event_id: UUID) -> str:
    """
    Generate a JWT token for check-in session scoped to an event.

    Args:
        event_id: UUID of the event this check-in is for

    Returns:
        JWT token string containing event_id and expiration
    """
    # Token expires in 24 hours
    expiration = datetime.now(timezone.utc) + timedelta(hours=24)

    payload = {
        "event_id": str(event_id),
        "exp": expiration,
        "type": "checkin",
    }

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_checkin_token(token: str) -> Optional[UUID]:
    """
    Validate check-in token and extract event_id.

    Args:
        token: The JWT token string to validate

    Returns:
        UUID of the event if token is valid, None otherwise
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

        # Check token type
        if payload.get("type") != "checkin":
            return None

        event_id_str = payload.get("event_id")
        if not event_id_str:
            return None

        return UUID(event_id_str)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError):
        return None


# ============================================
# REKO FORM TOKENS
# ============================================


def generate_form_token(incident_id: str, form_type: str = "reko") -> str:
    """
    Generate a reusable token for a form type.

    Tokens are deterministic for same incident+type (allows sharing).

    Args:
        incident_id: Incident UUID
        form_type: Type of form (e.g., 'reko')

    Returns:
        URL-safe token string
    """
    # Deterministic token based on incident + form type + secret_key
    data = f"{incident_id}:{form_type}:{settings.secret_key}"
    hash_obj = hashlib.sha256(data.encode())
    return hash_obj.hexdigest()[:32]


def validate_form_token(token: str, incident_id: str, form_type: str = "reko") -> bool:
    """
    Verify token matches incident and form type.

    Args:
        token: Token to validate
        incident_id: Incident UUID
        form_type: Type of form (e.g., 'reko')

    Returns:
        True if token is valid, False otherwise
    """
    expected = generate_form_token(incident_id, form_type)
    return secrets.compare_digest(token, expected)
