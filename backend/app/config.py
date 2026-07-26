"""Application configuration using pydantic-settings."""

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .telemetry.dsn import UPSTREAM_DSN


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
    version: str = "0.2.0"
    description: str = "API for firefighting operations dashboard"

    # Uvicorn
    # Binds all interfaces on purpose: the process only ever listens inside its container, and
    # the only thing that reaches it is Caddy on the compose network. Binding 127.0.0.1 instead
    # would make the container unreachable from the proxy — the service would simply not work.
    # What is actually exposed to the host is decided by `ports:` in docker-compose.yml, and the
    # backend publishes none. nosec B104: the finding does not apply to a containerised service.
    host: str = "0.0.0.0"  # nosec B104
    port: int = 8000
    reload: bool = False  # Set to False in production

    # Security - MUST be set via environment variable
    secret_key: str = ""  # Auto-generated in dev, required via env var in production

    @field_validator("secret_key", mode="before")
    @classmethod
    def generate_or_validate_secret_key(cls, v: str | None) -> str:
        """
        Generate secure key for development or validate production key.

        In development: Auto-generates secure random key if not set.
        In production: Requires explicit strong key via env var.
        """
        import secrets

        from app.environment import is_production_environment

        is_production = is_production_environment()

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

    # Demo Mode
    demo_mode: bool = False  # Set DEMO_MODE=true for public demo deployment
    demo_reset_hours: int = 2  # How often to reset demo data (hours)

    # Audit Log Retention
    # 0 = keep everything, and that is the default. The audit log is what the README calls a
    # defensible record; deleting it on a timer nobody was told about is the opposite of that.
    # It used to default to 90 days, so a deployment more than three months old had already
    # lost the trail for its earliest operations without anything saying so.
    # Set a positive number of days to prune (demo mode caps at 7 regardless).
    audit_retention_days: int = 0
    audit_cleanup_interval_hours: int = 24  # How often the cleanup job runs (hours)

    # Login throttling
    # A command post NATs every tablet and wall display behind ONE public IP,
    # so a per-IP limit that counts every attempt locks out the whole crew as
    # soon as a few people sign in within the same minute. Brute-force
    # protection therefore lives in the per-username FAILURE throttle below;
    # this per-IP ceiling only exists to blunt username spraying from a single
    # host and is set well above legitimate command-post traffic.
    login_rate_limit_per_ip: str = "30/minute"
    # Consecutive FAILED logins for one username from one IP before that pair
    # is locked out. Successful logins never consume budget and clear the
    # counter, so honest operators can never lock each other out.
    login_max_failed_attempts: int = 5
    login_failed_lockout_seconds: int = 300  # Lockout duration after the cap
    login_failed_window_seconds: int = 900  # Failures older than this are forgotten

    # SSO provisioning
    # Comma-separated emails (case-insensitive) that get role=editor on first
    # Microsoft login. Everyone else is provisioned as viewer — any tenant
    # member can reach the login, so write access must be an explicit grant.
    sso_editor_allowlist: str = ""

    # Alarm intake
    # Shared secret for POST /api/alarms and the Divera webhook. Set here it WINS over the
    # value in the settings table, so a deployment can be provisioned entirely from .env
    # instead of reading the auto-generated one back out of the database with SQL. Empty =
    # fall back to the DB value (auto-generated on first boot), which stays the default.
    alarm_webhook_secret: str = ""

    # Print Agent
    # Shared token for the print agent endpoints. Fail CLOSED: empty means the four agent
    # endpoints answer 403 for everyone, not that they are open. Setting it is the
    # deployment's opt-in to printing — see api/print.py::require_print_agent.
    print_agent_token: str = ""

    # WebSocket
    # Reject connects that carry no valid access_token cookie. Default ON.
    #
    # It defaulted to False through "Phase 1", which meant anything that could reach
    # /socket.io could join the operations room and receive live incident broadcasts —
    # addresses, crew assignments — without logging in. Only the admin room was role-gated,
    # and the Socket.IO CORS whitelist is not a control here: CORS is enforced by browsers,
    # and a script that omits or spoofs Origin is not a browser.
    #
    # Nothing legitimate connects anonymously: the client sends withCredentials, the
    # /display/* pages gate on isAuthenticated, and the public share-link board polls over
    # HTTP instead of using the socket. If some client of yours genuinely cannot log in, set
    # WS_REQUIRE_AUTH=false — the board degrades to ~5s polling rather than going blank.
    ws_require_auth: bool = True

    # Photo Storage
    photos_dir: str = "data/photos"  # Directory for photo uploads (use /mnt/data/photos on Railway)
    max_photo_size_mb: int = 10  # Maximum file size in megabytes
    max_photos_per_report: int = 20  # Maximum photos per Reko report
    allowed_photo_extensions: list[str] = [".jpg", ".jpeg", ".png", ".webp"]
    max_excel_import_mb: int = 25  # Maximum size for Excel data imports

    # Sync Configuration
    railway_url: str = ""  # Railway production URL (empty = local mode, no sync)
    sync_interval_minutes: int = 2  # Periodic sync interval
    sync_conflict_buffer_seconds: int = 5  # Timestamp buffer for conflict resolution (Local wins if within buffer)
    sync_timeout_seconds: int = 30  # HTTP timeout for sync requests

    # Traccar GPS Integration
    traccar_url: str = ""  # Traccar server URL (e.g., https://gps.example.com)
    traccar_email: str = ""  # Traccar account email for authentication
    traccar_password: str = ""  # Traccar account password for authentication

    # Master token for API access without login (e.g. configuring settings on Railway)
    master_token: str = ""  # Set MASTER_TOKEN env var; empty = disabled

    # Microsoft Entra ID (optional - if set, enables "Login with Microsoft")
    microsoft_client_id: str = ""  # Azure App Registration client ID
    microsoft_tenant_id: str = ""  # Azure Directory (tenant) ID
    microsoft_client_secret: str = ""  # Azure client secret VALUE (not the secret ID!)
    microsoft_redirect_uri: str = ""  # Must match Azure redirect URI exactly

    @property
    def microsoft_auth_enabled(self) -> bool:
        """Check if Microsoft Entra ID auth is configured."""
        return bool(
            self.microsoft_client_id
            and self.microsoft_tenant_id
            and self.microsoft_client_secret
            and self.microsoft_redirect_uri
        )

    # Divera API Integration (for polling as webhook fallback)
    divera_access_key: str = ""  # Divera247 API access key (empty = polling disabled)
    divera_api_url: str = "https://app.divera247.com/api/v2"  # Divera API base URL
    divera_poll_interval_seconds: int = 30  # How often to poll when users are connected
    divera_poll_max_alarms: int = 50  # Maximum number of recent alarms to fetch per poll

    # --- Telemetry (opt-in; see app/telemetry/) ---
    # The DEPLOYER's half of the switch, above whatever an admin later clicks in the UI:
    # KP_TELEMETRY_ENABLED=0 (or a blank DSN) compiles the forwarder out of this process, so
    # a station whose IT policy forbids outbound traffic can enforce that in the compose file
    # rather than trusting that nobody ticks a box. Consent is the SECOND gate, not the first.
    telemetry_enabled: bool = True
    # Points at our ingest by default (a public, write-only key — read app/telemetry/dsn.py
    # before assuming that's a mistake). Override to aim the same machinery at your own
    # GlitchTip and upstream never hears from you.
    telemetry_dsn: str = UPSTREAM_DSN
    # Minutes between flush attempts. Nothing waits on this; it exists so an offline station
    # drains its queue eventually, not so a crash reaches us quickly.
    telemetry_flush_minutes: int = 5

    @field_validator("telemetry_enabled", mode="before")
    @classmethod
    def _empty_telemetry_flag_is_false(cls, v: object) -> object:
        # compose passes an unset variable through as "" — the safe reading of "unset" here is
        # "don't send", not "crash the boot on a pydantic bool parse".
        if isinstance(v, str) and v.strip() == "":
            return False
        return v

    @property
    def is_production(self) -> bool:
        """Check if we're serving a real deployment (see app.environment)."""
        from app.environment import is_production_environment

        return is_production_environment()

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
