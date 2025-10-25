"""Token generation and validation for check-in forms."""
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
