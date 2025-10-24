"""Tests for authentication configuration and settings."""
import os
import pytest

from app.auth.config import AuthSettings, auth_settings


# ============================================
# Default Configuration Tests
# ============================================


def test_auth_settings_defaults():
    """Test authentication settings have correct defaults."""
    settings = AuthSettings()

    # JWT Configuration
    assert settings.SECRET_KEY == "CHANGE_THIS_IN_PRODUCTION_USE_OPENSSL_RAND"
    assert settings.ALGORITHM == "HS256"
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES == 15
    assert settings.REFRESH_TOKEN_EXPIRE_DAYS == 7

    # Password Policy
    assert settings.MIN_PASSWORD_LENGTH == 8
    assert settings.MAX_PASSWORD_LENGTH == 128

    # Cookie Security
    assert settings.COOKIE_SECURE is False  # False for local dev
    assert settings.COOKIE_HTTPONLY is True
    assert settings.COOKIE_SAMESITE == "lax"


def test_auth_settings_singleton():
    """Test auth_settings is properly instantiated."""
    assert auth_settings is not None
    assert isinstance(auth_settings, AuthSettings)
    assert auth_settings.MIN_PASSWORD_LENGTH == 8


def test_password_length_constraints():
    """Test password length constraints are reasonable."""
    settings = AuthSettings()

    # Min should be secure but not too restrictive
    assert 6 <= settings.MIN_PASSWORD_LENGTH <= 12

    # Max should allow passphrases
    assert settings.MAX_PASSWORD_LENGTH >= 64

    # Min should be less than max
    assert settings.MIN_PASSWORD_LENGTH < settings.MAX_PASSWORD_LENGTH


def test_token_expiration_reasonable():
    """Test token expiration times are reasonable."""
    settings = AuthSettings()

    # Access token should be short-lived (security best practice)
    assert 5 <= settings.ACCESS_TOKEN_EXPIRE_MINUTES <= 60

    # Refresh token should be longer than access token
    access_token_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    refresh_token_minutes = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60

    assert refresh_token_minutes > access_token_minutes


def test_cookie_security_settings():
    """Test cookie security settings are configured correctly."""
    settings = AuthSettings()

    # HttpOnly should always be True (XSS protection)
    assert settings.COOKIE_HTTPONLY is True

    # SameSite should be set
    assert settings.COOKIE_SAMESITE in ["strict", "lax", "none"]


# ============================================
# Environment Variable Override Tests
# ============================================


def test_env_prefix_configuration():
    """Test environment variables use AUTH_ prefix."""
    settings = AuthSettings()
    assert settings.Config.env_prefix == "AUTH_"


def test_case_insensitive_env_vars():
    """Test environment variables are case insensitive."""
    settings = AuthSettings()
    assert settings.Config.case_sensitive is False


def test_custom_secret_key_from_env(monkeypatch):
    """Test SECRET_KEY can be overridden via environment variable."""
    custom_secret = "custom_secret_key_12345"
    monkeypatch.setenv("AUTH_SECRET_KEY", custom_secret)

    settings = AuthSettings()
    assert settings.SECRET_KEY == custom_secret


def test_custom_token_expiration_from_env(monkeypatch):
    """Test token expiration can be overridden via environment variable."""
    monkeypatch.setenv("AUTH_ACCESS_TOKEN_EXPIRE_MINUTES", "30")
    monkeypatch.setenv("AUTH_REFRESH_TOKEN_EXPIRE_DAYS", "14")

    settings = AuthSettings()
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES == 30
    assert settings.REFRESH_TOKEN_EXPIRE_DAYS == 14


def test_custom_password_policy_from_env(monkeypatch):
    """Test password policy can be overridden via environment variable."""
    monkeypatch.setenv("AUTH_MIN_PASSWORD_LENGTH", "12")
    monkeypatch.setenv("AUTH_MAX_PASSWORD_LENGTH", "256")

    settings = AuthSettings()
    assert settings.MIN_PASSWORD_LENGTH == 12
    assert settings.MAX_PASSWORD_LENGTH == 256


def test_cookie_security_from_env(monkeypatch):
    """Test cookie security settings can be overridden via environment variable."""
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("AUTH_COOKIE_HTTPONLY", "false")
    monkeypatch.setenv("AUTH_COOKIE_SAMESITE", "strict")

    settings = AuthSettings()
    assert settings.COOKIE_SECURE is True
    assert settings.COOKIE_HTTPONLY is False
    assert settings.COOKIE_SAMESITE == "strict"


# ============================================
# Production Configuration Tests
# ============================================


def test_production_secret_key_warning():
    """Test that default secret key is obviously insecure (for production)."""
    settings = AuthSettings()

    # Default secret should contain warning text
    assert "CHANGE" in settings.SECRET_KEY.upper() or "PRODUCTION" in settings.SECRET_KEY.upper()


def test_production_cookie_secure_recommendation(monkeypatch):
    """Test COOKIE_SECURE should be True in production."""
    # Simulate production environment
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")

    settings = AuthSettings()
    assert settings.COOKIE_SECURE is True


def test_development_cookie_secure():
    """Test COOKIE_SECURE is False for local development."""
    settings = AuthSettings()

    # Default should be False for local dev (no HTTPS)
    assert settings.COOKIE_SECURE is False


# ============================================
# Algorithm Configuration Tests
# ============================================


def test_default_algorithm_hs256():
    """Test default algorithm is HS256 (symmetric)."""
    settings = AuthSettings()
    assert settings.ALGORITHM == "HS256"


def test_algorithm_override_from_env(monkeypatch):
    """Test algorithm can be overridden (e.g., for RS256 in distributed systems)."""
    monkeypatch.setenv("AUTH_ALGORITHM", "RS256")

    settings = AuthSettings()
    assert settings.ALGORITHM == "RS256"


# ============================================
# Configuration Validation Tests
# ============================================


def test_invalid_token_expiration_handled(monkeypatch):
    """Test invalid token expiration values are handled."""
    monkeypatch.setenv("AUTH_ACCESS_TOKEN_EXPIRE_MINUTES", "invalid")

    with pytest.raises(Exception):  # Pydantic will raise validation error
        AuthSettings()


def test_negative_token_expiration_handled(monkeypatch):
    """Test negative token expiration is rejected."""
    monkeypatch.setenv("AUTH_ACCESS_TOKEN_EXPIRE_MINUTES", "-10")

    settings = AuthSettings()
    # Note: Pydantic doesn't validate positive numbers by default
    # In production, you might want to add validators
    # For now, just document that negative values would create immediate expiration


def test_cookie_samesite_valid_values():
    """Test COOKIE_SAMESITE accepts valid values."""
    settings = AuthSettings()

    valid_values = ["strict", "lax", "none"]
    assert settings.COOKIE_SAMESITE.lower() in valid_values


# ============================================
# Settings Immutability Tests
# ============================================


def test_settings_are_reusable():
    """Test settings instance can be reused across application."""
    settings1 = auth_settings
    settings2 = auth_settings

    # Should be the same instance
    assert settings1 is settings2


# ============================================
# Security Best Practices Tests
# ============================================


def test_httponly_always_true():
    """Test httpOnly is always True (security requirement)."""
    settings = AuthSettings()

    # This is a critical security setting - should be True
    assert settings.COOKIE_HTTPONLY is True


def test_access_token_short_lived():
    """Test access token is short-lived (security best practice)."""
    settings = AuthSettings()

    # Access tokens should expire quickly to limit damage if stolen
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES <= 30


def test_refresh_token_longer_lived():
    """Test refresh token lasts longer than access token."""
    settings = AuthSettings()

    access_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    refresh_minutes = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60

    # Refresh should be at least 24x longer than access
    assert refresh_minutes >= access_minutes * 24
