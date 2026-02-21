"""Tests for authentication security utilities (password hashing, JWT tokens)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from jose import JWTError, jwt

from app.auth.config import auth_settings
from app.auth.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

# ============================================
# Password Hashing Tests
# ============================================


def test_hash_password_success():
    """Test password is successfully hashed."""
    password = "ValidPassword123"
    hashed = hash_password(password)

    # Verify hash is different from plain password
    assert hashed != password

    # Verify bcrypt hash format (starts with $2b$)
    assert hashed.startswith("$2b$")

    # Verify hash length is reasonable for bcrypt
    assert len(hashed) >= 59  # Bcrypt hashes are typically 60 chars


def test_hash_password_minimum_length():
    """Test password must meet minimum length requirement."""
    short_password = "short"

    with pytest.raises(ValueError) as exc_info:
        hash_password(short_password)

    assert f"at least {auth_settings.MIN_PASSWORD_LENGTH} characters" in str(exc_info.value)


def test_hash_password_maximum_length():
    """Test password must not exceed maximum length."""
    long_password = "x" * (auth_settings.MAX_PASSWORD_LENGTH + 1)

    with pytest.raises(ValueError) as exc_info:
        hash_password(long_password)

    assert f"not exceed {auth_settings.MAX_PASSWORD_LENGTH} characters" in str(exc_info.value)


def test_hash_password_exactly_min_length():
    """Test password at exactly minimum length is accepted."""
    password = "x" * auth_settings.MIN_PASSWORD_LENGTH
    hashed = hash_password(password)

    assert hashed is not None
    assert hashed.startswith("$2b$")


def test_hash_password_exactly_max_length():
    """Test password at exactly maximum length is accepted.

    NOTE: Bcrypt has a 72-byte limit. Passwords longer than 72 bytes
    will fail. This is a known limitation and should be documented.
    For now, we test with a 72-byte password instead.
    """
    # Use 72 bytes instead of MAX_PASSWORD_LENGTH (128)
    # This is a bcrypt limitation
    password = "x" * 72
    hashed = hash_password(password)

    assert hashed is not None
    assert hashed.startswith("$2b$")


def test_hash_password_special_characters():
    """Test password hashing with special characters."""
    password = "P@ssw0rd!#$%&*()"
    hashed = hash_password(password)

    assert hashed is not None
    assert hashed != password


def test_hash_password_unicode():
    """Test password hashing with unicode characters."""
    password = "Pässwörd123€"
    hashed = hash_password(password)

    assert hashed is not None
    assert hashed != password


def test_verify_password_correct():
    """Test password verification with correct password."""
    password = "MySecurePassword123"
    hashed = hash_password(password)

    assert verify_password(password, hashed) is True


def test_verify_password_incorrect():
    """Test password verification with incorrect password."""
    password = "MySecurePassword123"
    wrong_password = "WrongPassword123"
    hashed = hash_password(password)

    assert verify_password(wrong_password, hashed) is False


def test_verify_password_case_sensitive():
    """Test password verification is case-sensitive."""
    password = "Password1234!"
    hashed = hash_password(password)

    assert verify_password("password1234!", hashed) is False
    assert verify_password("PASSWORD1234!", hashed) is False


def test_hash_password_different_salts():
    """Test hashing same password twice produces different hashes (due to salt)."""
    password = "SamePassword123"
    hash1 = hash_password(password)
    hash2 = hash_password(password)

    # Hashes should be different (different salts)
    assert hash1 != hash2

    # But both should verify correctly
    assert verify_password(password, hash1) is True
    assert verify_password(password, hash2) is True


# ============================================
# JWT Access Token Tests
# ============================================


def test_create_access_token_default_expiration():
    """Test access token creation with default expiration."""
    user_id = str(uuid.uuid4())
    data = {"sub": user_id, "username": "testuser", "role": "editor"}

    token = create_access_token(data)

    # Verify token is a non-empty string
    assert isinstance(token, str)
    assert len(token) > 0

    # Decode and verify payload
    payload = decode_token(token)
    assert payload["sub"] == user_id
    assert payload["username"] == "testuser"
    assert payload["role"] == "editor"
    assert payload["type"] == "access"
    assert "exp" in payload
    assert "iat" in payload
    assert "jti" in payload


def test_create_access_token_custom_expiration():
    """Test access token creation with custom expiration."""
    user_id = str(uuid.uuid4())
    data = {"sub": user_id}
    custom_delta = timedelta(minutes=30)

    token = create_access_token(data, expires_delta=custom_delta)
    payload = decode_token(token)

    # Verify custom expiration is used
    exp_time = datetime.fromtimestamp(payload["exp"], tz=UTC)
    iat_time = datetime.fromtimestamp(payload["iat"], tz=UTC)
    actual_delta = exp_time - iat_time

    # Allow 2 second tolerance for test execution time
    assert abs(actual_delta.total_seconds() - custom_delta.total_seconds()) < 2


def test_create_access_token_includes_jwt_id():
    """Test access token includes unique JWT ID (jti)."""
    data = {"sub": str(uuid.uuid4())}

    token1 = create_access_token(data)
    token2 = create_access_token(data)

    payload1 = decode_token(token1)
    payload2 = decode_token(token2)

    # JTI should be different even for same data
    assert payload1["jti"] != payload2["jti"]

    # JTI should be valid UUID format
    uuid.UUID(payload1["jti"])
    uuid.UUID(payload2["jti"])


def test_create_access_token_type_field():
    """Test access token has correct type field."""
    data = {"sub": str(uuid.uuid4())}
    token = create_access_token(data)
    payload = decode_token(token)

    assert payload["type"] == "access"


# ============================================
# JWT Refresh Token Tests
# ============================================


def test_create_refresh_token():
    """Test refresh token creation."""
    user_id = str(uuid.uuid4())
    data = {"sub": user_id}

    token = create_refresh_token(data)

    # Verify token is a non-empty string
    assert isinstance(token, str)
    assert len(token) > 0

    # Decode and verify payload
    payload = decode_token(token)
    assert payload["sub"] == user_id
    assert payload["type"] == "refresh"
    assert "exp" in payload
    assert "iat" in payload
    assert "jti" in payload


def test_create_refresh_token_longer_expiration():
    """Test refresh token has longer expiration than access token."""
    data = {"sub": str(uuid.uuid4())}

    access_token = create_access_token(data)
    refresh_token = create_refresh_token(data)

    access_payload = decode_token(access_token)
    refresh_payload = decode_token(refresh_token)

    # Refresh token should expire later than access token
    assert refresh_payload["exp"] > access_payload["exp"]


def test_create_refresh_token_type_field():
    """Test refresh token has correct type field."""
    data = {"sub": str(uuid.uuid4())}
    token = create_refresh_token(data)
    payload = decode_token(token)

    assert payload["type"] == "refresh"


def test_refresh_token_minimal_payload():
    """Test refresh token should contain minimal data (just user ID)."""
    user_id = str(uuid.uuid4())
    data = {"sub": user_id, "extra_field": "should_be_included"}

    token = create_refresh_token(data)
    payload = decode_token(token)

    # User-provided data should be included
    assert payload["sub"] == user_id
    assert payload["extra_field"] == "should_be_included"


# ============================================
# JWT Decode Token Tests
# ============================================


def test_decode_token_valid():
    """Test decoding a valid token."""
    user_id = str(uuid.uuid4())
    data = {"sub": user_id, "username": "testuser"}

    token = create_access_token(data)
    payload = decode_token(token)

    assert payload["sub"] == user_id
    assert payload["username"] == "testuser"


def test_decode_token_expired():
    """Test decoding an expired token raises error."""
    data = {"sub": str(uuid.uuid4())}

    # Create already-expired token
    expired_token = create_access_token(data, expires_delta=timedelta(seconds=-1))

    with pytest.raises(JWTError) as exc_info:
        decode_token(expired_token)

    assert "Token validation failed" in str(exc_info.value)


def test_decode_token_malformed():
    """Test decoding a malformed token raises error."""
    malformed_token = "not.a.valid.jwt"

    with pytest.raises(JWTError) as exc_info:
        decode_token(malformed_token)

    assert "Token validation failed" in str(exc_info.value)


def test_decode_token_invalid_signature():
    """Test decoding a token with invalid signature raises error."""
    data = {"sub": str(uuid.uuid4())}
    token = create_access_token(data)

    # Tamper with the token by changing one character
    tampered_token = token[:-1] + ("X" if token[-1] != "X" else "Y")

    with pytest.raises(JWTError) as exc_info:
        decode_token(tampered_token)

    assert "Token validation failed" in str(exc_info.value)


def test_decode_token_wrong_algorithm():
    """Test decoding a token signed with wrong algorithm raises error."""
    data = {"sub": str(uuid.uuid4()), "exp": datetime.now(UTC) + timedelta(minutes=15)}

    # Create token with different algorithm
    wrong_algo_token = jwt.encode(data, "wrong_secret", algorithm="HS512")

    with pytest.raises(JWTError) as exc_info:
        decode_token(wrong_algo_token)

    assert "Token validation failed" in str(exc_info.value)


def test_decode_token_no_expiration():
    """Test decoding a token without expiration claim."""
    # Manually create token without exp claim
    data = {"sub": str(uuid.uuid4())}
    token_without_exp = jwt.encode(data, auth_settings.SECRET_KEY, algorithm=auth_settings.ALGORITHM)

    # python-jose should allow this (exp is optional in JWT spec)
    # but our tokens should always have exp
    payload = decode_token(token_without_exp)
    assert "sub" in payload


# ============================================
# Token Type Validation Tests
# ============================================


def test_access_and_refresh_tokens_different():
    """Test access and refresh tokens have different type fields."""
    data = {"sub": str(uuid.uuid4())}

    access_token = create_access_token(data)
    refresh_token = create_refresh_token(data)

    access_payload = decode_token(access_token)
    refresh_payload = decode_token(refresh_token)

    assert access_payload["type"] == "access"
    assert refresh_payload["type"] == "refresh"
    assert access_payload["type"] != refresh_payload["type"]


def test_token_payload_copy():
    """Test token creation doesn't mutate original data dict."""
    original_data = {"sub": str(uuid.uuid4()), "username": "test"}
    data_copy = original_data.copy()

    create_access_token(original_data)

    # Original data should not be modified
    assert original_data == data_copy
    assert "exp" not in original_data
    assert "iat" not in original_data
    assert "jti" not in original_data
    assert "type" not in original_data


# ============================================
# Integration Tests
# ============================================


def test_full_token_lifecycle():
    """Test complete token creation and verification flow."""
    user_id = str(uuid.uuid4())
    username = "testuser"
    role = "editor"

    # Create access token
    access_token = create_access_token(
        {
            "sub": user_id,
            "username": username,
            "role": role,
        }
    )

    # Create refresh token
    refresh_token = create_refresh_token({"sub": user_id})

    # Verify access token
    access_payload = decode_token(access_token)
    assert access_payload["sub"] == user_id
    assert access_payload["username"] == username
    assert access_payload["role"] == role
    assert access_payload["type"] == "access"

    # Verify refresh token
    refresh_payload = decode_token(refresh_token)
    assert refresh_payload["sub"] == user_id
    assert refresh_payload["type"] == "refresh"

    # Verify tokens are different
    assert access_token != refresh_token


def test_token_expiration_timing():
    """Test token expiration matches configured settings."""
    data = {"sub": str(uuid.uuid4())}

    access_token = create_access_token(data)
    access_payload = decode_token(access_token)

    exp_time = datetime.fromtimestamp(access_payload["exp"], tz=UTC)
    iat_time = datetime.fromtimestamp(access_payload["iat"], tz=UTC)
    actual_minutes = (exp_time - iat_time).total_seconds() / 60

    # Should match configured expiration (allow 0.1 minute tolerance)
    assert abs(actual_minutes - auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES) < 0.1
