"""Security utilities: password hashing, token generation."""
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid

import bcrypt
from jose import JWTError, jwt

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
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against a hash.

    Args:
        plain_password: User-provided password
        hashed_password: Stored bcrypt hash

    Returns:
        True if password matches, False otherwise
    """
    password_bytes = plain_password.encode('utf-8')
    hashed_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.

    Args:
        data: Payload to encode (must include 'sub' claim for user ID)
        expires_delta: Custom expiration time (defaults to 15 minutes)

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
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),  # Issued at
        "jti": str(uuid.uuid4()),  # JWT ID (for revocation tracking if needed)
        "type": "access",
    })

    encoded_jwt = jwt.encode(to_encode, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """
    Create a JWT refresh token (longer expiration).

    Args:
        data: Payload to encode (minimal data, just user ID)

    Returns:
        Encoded JWT string
    """
    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + timedelta(days=auth_settings.REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "jti": str(uuid.uuid4()),
        "type": "refresh",
    })

    encoded_jwt = jwt.encode(to_encode, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> dict:
    """
    Decode and validate a JWT token.

    Args:
        token: JWT string

    Returns:
        Decoded payload

    Raises:
        JWTError: If token is invalid, expired, or malformed
    """
    try:
        payload = jwt.decode(token, auth_settings.SECRET_KEY, algorithms=[auth_settings.ALGORITHM])
        return payload
    except JWTError as e:
        raise JWTError(f"Token validation failed: {str(e)}")
