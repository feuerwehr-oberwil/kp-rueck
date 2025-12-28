"""Authentication configuration and security settings."""
import os
from datetime import timedelta
from pydantic import field_validator
from pydantic_settings import BaseSettings


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
    MIN_PASSWORD_LENGTH: int = 8
    MAX_PASSWORD_LENGTH: int = 72  # Bcrypt has a hard limit of 72 bytes

    # Cookie Security
    COOKIE_SECURE: bool = False  # Will be overridden by property in production
    COOKIE_HTTPONLY: bool = True  # Prevent XSS attacks
    COOKIE_SAMESITE: str = "none"  # Required for cross-site cookies (different domains)

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

        # Check if key contains any weak patterns (case-insensitive)
        v_lower = v.lower()
        for weak_pattern in weak_defaults:
            if weak_pattern in v_lower:
                # In production, reject weak keys entirely
                if os.getenv("RAILWAY_ENVIRONMENT") is not None:
                    raise ValueError(
                        f"AUTH_SECRET_KEY contains weak pattern '{weak_pattern}'. "
                        "You MUST set a strong AUTH_SECRET_KEY environment variable in production. "
                        "Generate one with: openssl rand -hex 32"
                    )
                # In development, warn but allow (for local testing)
                print(f"⚠️  WARNING: AUTH_SECRET_KEY contains weak pattern '{weak_pattern}'. This is only acceptable in development!")

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

        In production (Railway), cookies MUST be sent over HTTPS only.
        In development, we allow HTTP for local testing.
        """
        is_production = os.getenv("RAILWAY_ENVIRONMENT") is not None
        if is_production:
            return True  # Force HTTPS in production
        return self.COOKIE_SECURE  # Use configured value in development

    @property
    def cookie_samesite(self) -> str:
        """
        Return appropriate SameSite value based on environment.

        In production (Railway), we use cross-site cookies (different domains)
        so SameSite=None is required. This also requires Secure=True.

        In development (localhost), we use SameSite=Lax for better security
        since frontend and backend are on the same site (localhost).
        """
        is_production = os.getenv("RAILWAY_ENVIRONMENT") is not None
        if is_production:
            return "none"  # Required for cross-site cookies (kp.fwo.li ↔ fwo-kp-api.up.railway.app)
        return "lax"  # Same-site in development (localhost:3000 ↔ localhost:8000)

    @property
    def is_auth_bypassed(self) -> bool:
        """
        Check if authentication is bypassed for development.

        Returns True if BYPASS_AUTH_DEV is enabled AND NOT in production.
        In production (Railway), auth bypass is ALWAYS disabled for security.
        """
        is_production = os.getenv("RAILWAY_ENVIRONMENT") is not None

        # NEVER allow auth bypass in production - this is a security requirement
        if is_production:
            if self.BYPASS_AUTH_DEV:
                print("🚫 AUTH BYPASS BLOCKED - Cannot bypass authentication in production!")
            return False

        # Only allow bypass in development
        if self.BYPASS_AUTH_DEV:
            print("🔓 AUTH BYPASS ENABLED - Authentication is disabled for development!")
            return True
        return False

    class Config:
        env_prefix = "AUTH_"
        case_sensitive = False


auth_settings = AuthSettings()
