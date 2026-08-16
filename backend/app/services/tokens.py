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

    A field token comes in three strengths, and which one you hold decides what
    you may do (plan 26, decisions 13 and 18):

    **link** — ``unlocked=False``, no person. What the poster QR and the printed
    Einsatzzettel carry. On its own it opens *nothing*: it is the right to be
    asked for the Feld-Code, and that is all. This is what makes a forwarded
    link or a three-week-old slip in a vehicle harmless.

    **unlocked** — ``unlocked=True``, no person yet. Minted by the code exchange.
    It may read the person picker so somebody can find their own name, and
    nothing else.

    **bound** — ``unlocked=True`` plus ``personnel_id`` and ``claim_id``. Minted
    when the person picks themselves. Every endpoint refuses to act as anybody
    else, so from here on the device provably cannot speak for another crew.
    ``claim_id`` points at the ``feld_device_claims`` row, which is what makes
    "alle Geräte abmelden" possible at all — a JWT cannot otherwise be recalled.
    """

    event_id: UUID
    personnel_id: UUID | None = None
    unlocked: bool = False
    claim_id: UUID | None = None


def generate_feld_token(
    event_id: UUID,
    personnel_id: UUID | None = None,
    expires_hours: int = 720,
    *,
    unlocked: bool = False,
    claim_id: UUID | None = None,
) -> str:
    """
    Generate a JWT token for the `/feld` field surface.

    Long-lived by default (30 days), mirroring the alarm token: a storm Ereignis
    runs for days and this QR lives on a printed poster in the vehicle hall.

    **What each strength is worth** — see ``FeldTokenClaims``. The default, with
    no arguments beyond the event, is the weakest one on purpose: that is what
    the poster QR and the Einsatzzettel carry, and it opens nothing until
    somebody types the Feld-Code. Handing out the stronger forms is the job of
    the exchange in `api/feld.py`, which is the only place that has seen the
    code.

    Args:
        event_id: UUID of the event this field surface is for
        personnel_id: bind the token to one person (default: unbound)
        expires_hours: Token expiration time in hours (default: 720 = 30 days)
        unlocked: the Feld-Code has been entered on this device
        claim_id: the ``feld_device_claims`` row this token lives or dies with

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
    if unlocked:
        payload["unlocked"] = True
    if claim_id is not None:
        payload["claim_id"] = str(claim_id)

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def validate_feld_token(token: str) -> FeldTokenClaims | None:
    """
    Validate a `/feld` token and extract its claims.

    Args:
        token: The JWT token string to validate

    Returns:
        The token's claims if it is valid, None otherwise. A token whose
        `personnel_id` or `claim_id` is present but unreadable is rejected
        outright rather than degraded to a weaker one — a broken binding must
        never widen access, and a bound token that quietly fell back to
        "unlocked, no person" would be exactly that.
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
        claim_id_str = payload.get("claim_id")
        return FeldTokenClaims(
            event_id=UUID(event_id_str),
            personnel_id=UUID(personnel_id_str) if personnel_id_str else None,
            unlocked=bool(payload.get("unlocked", False)),
            claim_id=UUID(claim_id_str) if claim_id_str else None,
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError):
        return None
