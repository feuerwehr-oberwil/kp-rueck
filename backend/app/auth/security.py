"""Security utilities: password hashing, token generation."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from .config import auth_settings


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.

    Args:
        password: Plain text password

    Returns:
        Bcrypt hash string

    Raises:
        ValueError: If password doesn't meet policy
    """
    if len(password) < auth_settings.MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {auth_settings.MIN_PASSWORD_LENGTH} characters")

    if len(password) > auth_settings.MAX_PASSWORD_LENGTH:
        raise ValueError(f"Password must not exceed {auth_settings.MAX_PASSWORD_LENGTH} characters")

    # Hash password with bcrypt (12 rounds = cost factor)
    password_bytes = password.encode("utf-8")

    # Bcrypt has a hard limit of 72 bytes
    if len(password_bytes) > 72:
        raise ValueError("Password must not exceed 72 bytes when encoded as UTF-8")

    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against a hash.

    Args:
        plain_password: User-provided password
        hashed_password: Stored bcrypt hash

    Returns:
        True if password matches, False otherwise
    """
    password_bytes = plain_password.encode("utf-8")
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """
    Create a JWT access token.

    Args:
        data: Payload to encode (must include 'sub' claim for user ID)
        expires_delta: Custom expiration time (defaults to 8 hours)

    Returns:
        Encoded JWT string

    Example payload:
        {
            "sub": "user-uuid",
            "role": "editor",
            "username": "admin",
            "type": "access"
        }
    """
    to_encode = data.copy()

    # Set expiration
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update(
        {
            "exp": expire,
            "iat": datetime.now(UTC),  # Issued at
            "jti": str(uuid.uuid4()),  # JWT ID (for revocation tracking if needed)
            "type": "access",
        }
    )

    encoded_jwt: str = jwt.encode(to_encode, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict[str, Any]) -> str:
    """
    Create a JWT refresh token (longer expiration).

    Args:
        data: Payload to encode (minimal data, just user ID)

    Returns:
        Encoded JWT string
    """
    to_encode = data.copy()

    expire = datetime.now(UTC) + timedelta(days=auth_settings.REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode.update(
        {
            "exp": expire,
            "iat": datetime.now(UTC),
            "jti": str(uuid.uuid4()),
            "type": "refresh",
        }
    )

    encoded_jwt: str = jwt.encode(to_encode, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)
    return encoded_jwt


#: How long a WebSocket handshake token lives. It exists for exactly one
#: `io(...)` connect that happens milliseconds after it is fetched — a minute
#: absorbs a slow phone without turning the token into a second session.
WS_TOKEN_EXPIRE_SECONDS = 60


def create_ws_token(user_id: uuid.UUID, role: str) -> str:
    """A short-lived token for the Socket.IO connect (sweep 27 §P3.4).

    On a split-origin deployment (Railway staging, kp.fwo.li → kp-api.fwo.li)
    the `access_token` cookie is first-party to the FRONTEND origin — it never
    reaches the backend socket, so every connect was rejected under
    `ws_require_auth` and clients silently lived on the 5s polling fallback.
    The fix: the client fetches this token same-origin (cookie rides along
    through the proxy) and passes it in the Socket.IO `auth` payload.

    Deliberately its own `type` ("ws"): an access token must not double as a
    connect credential and this token must not open any HTTP endpoint — 60
    seconds and a role claim is all it is.
    """
    return jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "type": "ws",
            "exp": datetime.now(UTC) + timedelta(seconds=WS_TOKEN_EXPIRE_SECONDS),
            "iat": datetime.now(UTC),
            "jti": str(uuid.uuid4()),
        },
        auth_settings.SECRET_KEY,
        algorithm=auth_settings.ALGORITHM,
    )


def decode_token(token: str) -> dict[str, Any]:
    """
    Decode and validate a JWT token.

    Args:
        token: JWT string

    Returns:
        Decoded payload

    Raises:
        jwt.InvalidTokenError: If token is invalid, expired, or malformed
    """
    try:
        payload: dict[str, Any] = jwt.decode(token, auth_settings.SECRET_KEY, algorithms=[auth_settings.ALGORITHM])
        return payload
    except jwt.PyJWTError as e:
        raise jwt.InvalidTokenError(f"Token validation failed: {e!s}") from e
