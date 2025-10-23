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


settings = Settings()
