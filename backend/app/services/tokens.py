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

# Retire old links whose field-device provenance cannot be established.
# Routine releases must retain this version so new links keep their lifetime.
FORM_CREDENTIAL_VERSION = 1


@dataclass(frozen=True, slots=True)
class FormTokenBinding:
    """A field-derived form lives and dies with its original device claim."""

    claim_id: UUID
    event_id: UUID
    personnel_id: UUID


@dataclass(frozen=True, slots=True)
class FormTokenClaims:
    field_binding: FormTokenBinding | None = None


def generate_form_token(
    incident_id: str,
    form_type: str = "reko",
    expires_hours: int = 24,
    *,
    field_binding: FormTokenBinding | None = None,
) -> str:
    """
    Generate a secure JWT token for Reko form access.

    SECURITY: Uses JWT with expiration instead of deterministic hash.
    Tokens expire after 24 hours by default to limit exposure.

    Args:
        incident_id: Incident UUID
        form_type: Type of form (e.g., 'reko')
        expires_hours: Token expiration time in hours (default: 24)
        field_binding: Device provenance for a credential minted from /feld

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
        "form_version": FORM_CREDENTIAL_VERSION,
    }
    if field_binding is not None:
        payload["field_claim_id"] = str(field_binding.claim_id)
        payload["field_event_id"] = str(field_binding.event_id)
        payload["field_personnel_id"] = str(field_binding.personnel_id)

    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token


def decode_form_token(token: str, incident_id: str, form_type: str = "reko") -> FormTokenClaims | None:
    """
    Verify JWT token is valid and matches incident and form type.

    SECURITY: Checks token signature, expiration, and incident_id match.

    Args:
        token: JWT token to validate
        incident_id: Expected incident UUID
        form_type: Expected form type (e.g., 'reko')

    Returns:
        Validated claims, or None when token signature, scope or binding is invalid
    """
    try:
        # Decode and verify token (automatically checks expiration)
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

        # Verify token type
        if payload.get("type") != "reko_form":
            return None
        version = payload.get("form_version")
        if type(version) is not int or version != FORM_CREDENTIAL_VERSION:
            return None

        # Verify incident_id matches
        if payload.get("incident_id") != incident_id:
            return None

        # Verify form_type matches
        if payload.get("form_type") != form_type:
            return None

        binding_keys = ("field_claim_id", "field_event_id", "field_personnel_id")
        if any(key in payload for key in binding_keys):
            # Partial or malformed provenance must never degrade to an unbound
            # standalone credential, which would bypass the database check.
            return FormTokenClaims(
                FormTokenBinding(
                    claim_id=UUID(payload["field_claim_id"]),
                    event_id=UUID(payload["field_event_id"]),
                    personnel_id=UUID(payload["field_personnel_id"]),
                )
            )
        return FormTokenClaims()

    except jwt.ExpiredSignatureError:
        # Token has expired
        return None
    except (jwt.InvalidTokenError, KeyError, ValueError, TypeError, AttributeError):
        # Invalid token format or missing fields
        return None


def validate_form_token(token: str, incident_id: str, form_type: str = "reko") -> bool:
    """Validate signature/scope; HTTP admissions also check field-claim revocation."""
    return decode_form_token(token, incident_id, form_type) is not None


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

    **unlocked** — ``unlocked=True`` plus a short-lived ``unlock_id``, no person
    yet. The database grant permits the picker and exactly one claim exchange.
    Rotation and logout-all revoke outstanding grants.

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
    unlock_id: UUID | None = None


def generate_feld_token(
    event_id: UUID,
    personnel_id: UUID | None = None,
    expires_hours: int = 720,
    *,
    unlocked: bool = False,
    claim_id: UUID | None = None,
    unlock_id: UUID | None = None,
    expires_minutes: int | None = None,
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
        unlock_id: the single-use ``feld_unlock_claims`` row for the picker
        expires_minutes: shorter lifetime for intermediate picker tokens

    Returns:
        JWT token string containing the claims above and an expiration
    """
    lifetime = timedelta(minutes=expires_minutes) if expires_minutes is not None else timedelta(hours=expires_hours)
    expiration = datetime.now(UTC) + lifetime

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
    if unlock_id is not None:
        payload["unlock_id"] = str(unlock_id)

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
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"], options={"require": ["exp"]})

        # Check token type — a checkin/viewer/alarm token must
        # never open this door, and vice versa.
        if payload.get("type") != "feld":
            return None

        event_id_str = payload.get("event_id")
        if not event_id_str:
            return None

        personnel_id_str = payload.get("personnel_id")
        claim_id_str = payload.get("claim_id")
        unlock_id_str = payload.get("unlock_id")
        unlocked = payload.get("unlocked", False)
        if not isinstance(unlocked, bool):
            return None
        # Accept exactly the three stages. Legacy unbound unlocked tokens had
        # no revocable grant and cannot safely be exchanged after this upgrade.
        if unlocked:
            bound = personnel_id_str is not None and claim_id_str is not None and unlock_id_str is None
            picker = personnel_id_str is None and claim_id_str is None and unlock_id_str is not None
            if not (bound or picker):
                return None
        elif any(value is not None for value in (personnel_id_str, claim_id_str, unlock_id_str)):
            return None
        if any(
            value is not None and not isinstance(value, str)
            for value in (event_id_str, personnel_id_str, claim_id_str, unlock_id_str)
        ):
            return None
        return FeldTokenClaims(
            event_id=UUID(event_id_str),
            personnel_id=UUID(personnel_id_str) if personnel_id_str is not None else None,
            unlocked=unlocked,
            claim_id=UUID(claim_id_str) if claim_id_str is not None else None,
            unlock_id=UUID(unlock_id_str) if unlock_id_str is not None else None,
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError):
        return None
