"""Authentication configuration and security settings."""
from datetime import timedelta
from pydantic_settings import BaseSettings


class AuthSettings(BaseSettings):
    """JWT and authentication settings."""

    # JWT Configuration
    SECRET_KEY: str = "CHANGE_THIS_IN_PRODUCTION_USE_OPENSSL_RAND"  # openssl rand -hex 32
    ALGORITHM: str = "HS256"  # Use RS256 for distributed systems
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120  # 2 hours for firefighting operations
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7  # Longer-lived refresh token

    # Password Policy
    MIN_PASSWORD_LENGTH: int = 8
    MAX_PASSWORD_LENGTH: int = 72  # Bcrypt has a hard limit of 72 bytes

    # Cookie Security
    COOKIE_SECURE: bool = False  # HTTPS only in production (set to False for local dev)
    COOKIE_HTTPONLY: bool = True  # Prevent XSS attacks
    COOKIE_SAMESITE: str = "lax"  # CSRF protection

    class Config:
        env_prefix = "AUTH_"
        case_sensitive = False


auth_settings = AuthSettings()
