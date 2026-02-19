"""Authentication configuration and security settings."""

import logging
import os

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


def _is_production_environment() -> bool:
    """
    Detect production environment using multiple Railway indicators.

    Security: Use multiple checks to reduce risk of accidentally
    enabling auth bypass due to missing environment variables.
    """
    railway_indicators = [
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_PROJECT_ID",
        "RAILWAY_SERVICE_ID",
        "RAILWAY_STATIC_URL",
        "RAILWAY_PUBLIC_DOMAIN",
    ]
    return any(os.getenv(indicator) is not None for indicator in railway_indicators)


class AuthSettings(BaseSettings):
    """JWT and authentication settings."""

    # Development Mode
    BYPASS_AUTH_DEV: bool = False  # Set to True to disable authentication in development

    # JWT Configuration
    SECRET_KEY: str = "CHANGE_THIS_IN_PRODUCTION_USE_OPENSSL_RAND"  # openssl rand -hex 32
    ALGORITHM: str = "HS256"  # Use RS256 for distributed systems
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours for emergency operations (availability > security)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7  # Longer-lived refresh token

    # Password Policy
    MIN_PASSWORD_LENGTH: int = 12  # Increased from 8 for better security
    MAX_PASSWORD_LENGTH: int = 72  # Bcrypt has a hard limit of 72 bytes

    # Cookie Security
    COOKIE_SECURE: bool = False  # Will be overridden by property in production
    COOKIE_HTTPONLY: bool = True  # Prevent XSS attacks
    COOKIE_SAMESITE: str = "lax"  # Use "none" for cross-origin setups (requires COOKIE_SECURE=true)
    COOKIE_DOMAIN: str = ""  # Empty = use request host. Set to ".example.com" for subdomain sharing

    @model_validator(mode="after")
    def validate_security_settings(self) -> "AuthSettings":
        """
        Fail-fast validation at startup to prevent security misconfigurations.

        Security: This ensures the application won't start with dangerous settings.
        """
        is_production = _is_production_environment()

        # CRITICAL: Block auth bypass in production
        if is_production and self.BYPASS_AUTH_DEV:
            raise ValueError(
                "SECURITY ERROR: AUTH_BYPASS_AUTH_DEV=True is forbidden in production! "
                "Authentication bypass is only allowed in local development. "
                "Remove this environment variable or set it to False."
            )

        return self

    @field_validator("SECRET_KEY", mode="after")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """
        Validate secret key is strong enough for production use.

        Rejects weak default values and ensures minimum length.
        """
        # List of weak default patterns that must be rejected
        weak_defaults = [
            "change_this",
            "change-this",
            "openssl_rand",
            "secret",
            "password",
            "test",
            "demo",
        ]

        is_production = _is_production_environment()

        # Check if key contains any weak patterns (case-insensitive)
        v_lower = v.lower()
        for weak_pattern in weak_defaults:
            if weak_pattern in v_lower:
                # In production, reject weak keys entirely
                if is_production:
                    raise ValueError(
                        f"AUTH_SECRET_KEY contains weak pattern '{weak_pattern}'. "
                        "You MUST set a strong AUTH_SECRET_KEY environment variable in production. "
                        "Generate one with: openssl rand -hex 32"
                    )
                # In development, warn but allow (for local testing)
                logger.warning(
                    "AUTH_SECRET_KEY contains weak pattern '%s'. This is only acceptable in development!", weak_pattern
                )

        # Enforce minimum length (256 bits = 32 bytes = 64 hex chars recommended)
        if len(v) < 32:
            raise ValueError(
                f"AUTH_SECRET_KEY must be at least 32 characters long (current: {len(v)}). "
                "Generate a strong key with: openssl rand -hex 32"
            )

        return v

    @property
    def cookie_secure(self) -> bool:
        """
        Force secure cookies in production (HTTPS only).

        Always forced True in production (Railway). Configure via AUTH_COOKIE_SECURE.
        """
        if _is_production_environment():
            return True
        return self.COOKIE_SECURE

    @property
    def cookie_samesite(self) -> str:
        """
        Return appropriate SameSite value based on environment.

        Cross-origin setups (frontend/backend on different domains) need "none" + Secure=True.
        Same-origin setups use "lax" (the default) for better security.

        Configure via AUTH_COOKIE_SAMESITE env var.
        """
        return self.COOKIE_SAMESITE

    @property
    def cookie_domain(self) -> str | None:
        """
        Return cookie domain for production (enables subdomain sharing).

        Set AUTH_COOKIE_DOMAIN env var to share cookies across subdomains,
        e.g. ".example.com" for app.example.com + api.example.com.

        Returns None in development (cookie bound to exact host).
        """
        if self.COOKIE_DOMAIN:
            return self.COOKIE_DOMAIN
        return None

    @property
    def is_auth_bypassed(self) -> bool:
        """
        Check if authentication is bypassed for development.

        Returns True if BYPASS_AUTH_DEV is enabled AND NOT in production.
        In production (Railway), auth bypass is ALWAYS disabled for security.
        """
        is_production = _is_production_environment()

        # NEVER allow auth bypass in production - this is a security requirement
        if is_production:
            if self.BYPASS_AUTH_DEV:
                logger.critical("AUTH BYPASS BLOCKED - Cannot bypass authentication in production!")
            return False

        # Only allow bypass in development
        if self.BYPASS_AUTH_DEV:
            logger.warning("AUTH BYPASS ENABLED - Authentication is disabled for development!")
            return True
        return False

    class Config:
        env_prefix = "AUTH_"
        case_sensitive = False


auth_settings = AuthSettings()
