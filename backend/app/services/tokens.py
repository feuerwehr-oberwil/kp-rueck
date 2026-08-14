"""Token generation and validation for check-in forms and reko forms."""

from dataclasses import dataclass
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
        return payload.get("form_type") == form_type

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


# ============================================
# VIEWER TOKENS
# ============================================


def generate_viewer_token(event_id: UUID, expires_hours: int = 24) -> str:
    """
    Generate a JWT token for read-only viewer access to an event.

    Args:
        event_id: UUID of the event to view
        expires_hours: Token expiration time in hours (default: 24)

    Returns:
        JWT token string containing event_id and expiration
    """
    expiration = datetime.now(UTC) + timedelta(hours=expires_hours)

    payload = {
        "event_id": str(event_id),
        "exp": expiration,
        "type": "viewer",
    }

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_viewer_token(token: str) -> UUID | None:
    """
    Validate viewer token and extract event_id.

    Args:
        token: The JWT token string to validate

    Returns:
        UUID of the event if token is valid, None otherwise
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

        # Check token type
        if payload.get("type") != "viewer":
            return None

        event_id_str = payload.get("event_id")
        if not event_id_str:
            return None

        return UUID(event_id_str)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError):
        return None


# ============================================
# ALARM INTAKE TOKENS
# ============================================


def generate_alarm_token(event_id: UUID, expires_hours: int = 720) -> str:
    """
    Generate a JWT token for public alarm intake scoped to an event.

    Long-lived by default (30 days) so a phone desk can post/bookmark the link
    for the duration of an event. Grants write access (create incidents), so it
    is paired with strict rate limiting and intake flagging on the endpoint side.

    Args:
        event_id: UUID of the event new alarms are created in
        expires_hours: Token expiration time in hours (default: 720 = 30 days)

    Returns:
        JWT token string containing event_id and expiration
    """
    expiration = datetime.now(UTC) + timedelta(hours=expires_hours)

    payload = {
        "event_id": str(event_id),
        "exp": expiration,
        "type": "alarm",
    }

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_alarm_token(token: str) -> UUID | None:
    """
    Validate alarm intake token and extract event_id.

    Args:
        token: The JWT token string to validate

    Returns:
        UUID of the event if token is valid, None otherwise
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

        # Check token type
        if payload.get("type") != "alarm":
            return None

        event_id_str = payload.get("event_id")
        if not event_id_str:
            return None

        return UUID(event_id_str)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError):
        return None


# ============================================
# FIELD (/feld) TOKENS
# ============================================


@dataclass(frozen=True, slots=True)
class FeldTokenClaims:
    """What a valid `/feld` token says about its holder.

    ``personnel_id`` is the optional person binding: when it is set, the token
    speaks for that one person and every `/feld` endpoint refuses to act as
    anybody else (`api/feld.py`). When it is ``None`` the token names only the
    event — which is what the shared poster QR and the Einsatzzettel slip carry,
    because neither knows yet who will drive.
    """

    event_id: UUID
    personnel_id: UUID | None = None


def generate_feld_token(event_id: UUID, personnel_id: UUID | None = None, expires_hours: int = 720) -> str:
    """
    Generate a JWT token for the `/feld` field surface.

    Long-lived by default (30 days), mirroring the alarm token: a storm Ereignis
    runs for days and this QR lives on a printed poster in the vehicle hall.

    **Scope, honestly.** Without ``personnel_id`` the token names the event and
    nothing else. The endpoints still run a second check — the personnel row the
    caller names must have an assignment in that event — but the caller names it
    themselves, and `GET /feld/personnel` hands any holder of the link the whole
    picker. So an event-scoped link is a credential for the *event*: whoever
    holds it can read, and write as, any crew in it. That is the price of one
    global QR on a wall, and it is the current behaviour of both mint sites
    (`api/feld.generate_feld_link`, `crud/print_jobs` for the Einsatzzettel).

    With ``personnel_id`` the token is bound to one person: the same endpoints
    additionally refuse any `personnel_id` that is not the one in the token, so
    such a link genuinely cannot reach another crew's Schadenplatz. Nothing
    mints one yet — issuing personal links means giving up the shared poster —
    but the binding is enforced the moment something does.

    Args:
        event_id: UUID of the event this field surface is for
        personnel_id: bind the token to one person (default: unbound, event-wide)
        expires_hours: Token expiration time in hours (default: 720 = 30 days)

    Returns:
        JWT token string containing the claims above and an expiration
    """
    expiration = datetime.now(UTC) + timedelta(hours=expires_hours)

    payload: dict[str, object] = {
        "event_id": str(event_id),
        "exp": expiration,
        "type": "feld",
    }
    if personnel_id is not None:
        payload["personnel_id"] = str(personnel_id)

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_feld_token(token: str) -> FeldTokenClaims | None:
    """
    Validate a `/feld` token and extract its claims.

    Args:
        token: The JWT token string to validate

    Returns:
        The token's claims if it is valid, None otherwise. A token whose
        `personnel_id` claim is present but unreadable is rejected outright
        rather than degraded to an event-wide one — a broken binding must never
        widen access.
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

        # Check token type — a checkin/viewer/reko_dashboard/alarm token must
        # never open this door, and vice versa.
        if payload.get("type") != "feld":
            return None

        event_id_str = payload.get("event_id")
        if not event_id_str:
            return None

        personnel_id_str = payload.get("personnel_id")
        return FeldTokenClaims(
            event_id=UUID(event_id_str),
            personnel_id=UUID(personnel_id_str) if personnel_id_str else None,
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError):
        return None
