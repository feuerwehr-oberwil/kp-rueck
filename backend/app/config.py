"""Application configuration using pydantic-settings."""

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str = "postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck"

    @field_validator("database_url", mode="before")
    @classmethod
    def convert_postgres_url(cls, v: str) -> str:
        """Convert postgresql:// to postgresql+asyncpg:// for Railway compatibility."""
        if v.startswith("postgresql://") and not v.startswith("postgresql+asyncpg://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    # CORS
    cors_origins: list[str] | str = ["http://localhost:3000", "http://localhost:3001"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        """Parse CORS origins from comma-separated string or list."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

    # API
    api_v1_prefix: str = "/api"
    project_name: str = "KP Rück API"
    version: str = "1.0.0"
    description: str = "API for firefighting operations dashboard"

    # Uvicorn
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False  # Set to False in production

    # Security - MUST be set via environment variable
    secret_key: str  # No default - requires SECRET_KEY env var

    @field_validator("secret_key", mode="before")
    @classmethod
    def generate_or_validate_secret_key(cls, v: str | None) -> str:
        """
        Generate secure key for development or validate production key.

        In development: Auto-generates secure random key if not set.
        In production: Requires explicit strong key via env var.
        """
        import os
        import secrets

        is_production = os.getenv("RAILWAY_ENVIRONMENT") is not None

        # If no key provided
        if not v:
            if is_production:
                raise ValueError(
                    "SECRET_KEY environment variable is required in production. "
                    "Generate a strong key with: openssl rand -hex 32"
                )
            else:
                # Auto-generate secure key for local development
                generated_key = secrets.token_hex(32)  # 256-bit key
                print(f"🔑 Generated development SECRET_KEY: {generated_key[:8]}...")
                return generated_key

        # Validate provided key
        # List of weak default patterns that must be rejected
        weak_defaults = [
            "dev-secret-key",
            "change-in-production",
            "change_this",
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
                if is_production:
                    raise ValueError(
                        f"SECRET_KEY contains weak pattern '{weak_pattern}'. "
                        "You MUST set a strong SECRET_KEY environment variable in production. "
                        "Generate one with: openssl rand -hex 32"
                    )
                # In development, warn but allow (for local testing)
                print(
                    f"⚠️  WARNING: SECRET_KEY contains weak pattern '{weak_pattern}'. This is only acceptable in development!"
                )

        # Enforce minimum length (256 bits = 32 bytes = 64 hex chars recommended)
        if len(v) < 32:
            raise ValueError(
                f"SECRET_KEY must be at least 32 characters long (current: {len(v)}). "
                "Generate a strong key with: openssl rand -hex 32"
            )

        return v

    # Photo Storage
    photos_dir: str = "data/photos"  # Directory for photo uploads (use /mnt/data/photos on Railway)
    max_photo_size_mb: int = 10  # Maximum file size in megabytes
    max_photos_per_report: int = 20  # Maximum photos per Reko report
    allowed_photo_extensions: list[str] = [".jpg", ".jpeg", ".png", ".webp"]

    # Sync Configuration
    railway_url: str = ""  # Railway production URL (empty = local mode, no sync)
    sync_interval_minutes: int = 2  # Periodic sync interval
    sync_conflict_buffer_seconds: int = 5  # Timestamp buffer for conflict resolution (Local wins if within buffer)
    sync_timeout_seconds: int = 30  # HTTP timeout for sync requests

    # Traccar GPS Integration
    traccar_url: str = ""  # Traccar server URL (e.g., https://gps.fwo.li)
    traccar_email: str = ""  # Traccar account email for authentication
    traccar_password: str = ""  # Traccar account password for authentication

    # Divera API Integration (for polling as webhook fallback)
    divera_access_key: str = ""  # Divera247 API access key (empty = polling disabled)
    divera_api_url: str = "https://app.divera247.com/api/v2"  # Divera API base URL
    divera_poll_interval_seconds: int = 30  # How often to poll when users are connected
    divera_poll_max_alarms: int = 50  # Maximum number of recent alarms to fetch per poll

    @property
    def is_production(self) -> bool:
        """Check if we're in production mode (Railway)."""
        import os

        return os.getenv("RAILWAY_ENVIRONMENT") is not None

    @property
    def is_testing(self) -> bool:
        """Check if we're in test mode."""
        import os
        import sys

        # Check multiple indicators of test mode
        return (
            "pytest" in sys.modules  # pytest is running
            or os.getenv("PYTEST_CURRENT_TEST") is not None  # pytest env var
            or "test" in self.database_url.lower()  # test database
        )


settings = Settings()


def get_settings() -> Settings:
    """Get application settings (for dependency injection)."""
    return settings
