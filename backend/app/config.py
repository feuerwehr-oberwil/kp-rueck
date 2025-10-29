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

    # Security
    secret_key: str = "dev-secret-key-change-in-production"  # Override via SECRET_KEY env var

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
