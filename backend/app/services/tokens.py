"""Token generation and validation for check-in forms and reko forms."""

from datetime import UTC, datetime, timedelta
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
    expiration = datetime.now(UTC) + timedelta(hours=24)

    payload = {
        "event_id": str(event_id),
        "exp": expiration,
        "type": "checkin",
    }

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_checkin_token(token: str) -> UUID | None:
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


def generate_form_token(incident_id: str, form_type: str = "reko", expires_hours: int = 24) -> str:
    """
    Generate a secure JWT token for Reko form access.

    SECURITY: Uses JWT with expiration instead of deterministic hash.
    Tokens expire after 24 hours by default to limit exposure.

    Args:
        incident_id: Incident UUID
        form_type: Type of form (e.g., 'reko')
        expires_hours: Token expiration time in hours (default: 24)

    Returns:
        JWT token string with expiration
    """
    import uuid

    # Token expires in 24 hours (or specified duration)
    expiration = datetime.now(UTC) + timedelta(hours=expires_hours)

    payload = {
        "incident_id": incident_id,
        "form_type": form_type,
        "exp": expiration,
        "iat": datetime.now(UTC),  # Issued at
        "jti": str(uuid.uuid4()),  # Unique JWT ID for token tracking
        "type": "reko_form",
    }

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_form_token(token: str, incident_id: str, form_type: str = "reko") -> bool:
    """
    Verify JWT token is valid and matches incident and form type.

    SECURITY: Checks token signature, expiration, and incident_id match.

    Args:
        token: JWT token to validate
        incident_id: Expected incident UUID
        form_type: Expected form type (e.g., 'reko')

    Returns:
        True if token is valid and matches, False otherwise
    """
    try:
        # Decode and verify token (automatically checks expiration)
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

        # Verify token type
        if payload.get("type") != "reko_form":
            return False

        # Verify incident_id matches
        if payload.get("incident_id") != incident_id:
            return False

        # Verify form_type matches
        if payload.get("form_type") != form_type:
            return False

        return True

    except jwt.ExpiredSignatureError:
        # Token has expired
        return False
    except (jwt.InvalidTokenError, KeyError, ValueError):
        # Invalid token format or missing fields
        return False


# ============================================
# REKO DASHBOARD TOKENS
# ============================================


def generate_reko_dashboard_token(event_id: UUID) -> str:
    """
    Generate a JWT token for Reko Dashboard access scoped to an event.

    Args:
        event_id: UUID of the event this dashboard is for

    Returns:
        JWT token string containing event_id and expiration
    """
    # Token expires in 24 hours
    expiration = datetime.now(UTC) + timedelta(hours=24)

    payload = {
        "event_id": str(event_id),
        "exp": expiration,
        "type": "reko_dashboard",
    }

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_reko_dashboard_token(token: str) -> UUID | None:
    """
    Validate Reko Dashboard token and extract event_id.

    Args:
        token: The JWT token string to validate

    Returns:
        UUID of the event if token is valid, None otherwise
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

        # Check token type
        if payload.get("type") != "reko_dashboard":
            return None

        event_id_str = payload.get("event_id")
        if not event_id_str:
            return None

        return UUID(event_id_str)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError):
        return None
