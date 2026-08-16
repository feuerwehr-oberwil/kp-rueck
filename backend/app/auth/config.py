"""Authentication configuration and security settings."""

import logging

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings

from app.environment import is_production_environment

logger = logging.getLogger(__name__)


def _is_production_environment() -> bool:
    """
    Detect a real deployment: an explicit ENVIRONMENT=production (self-host) or any
    Railway indicator. See app.environment for why both.
    """
    return is_production_environment()


def _configured_origins() -> list[str]:
    """The CORS origins as configured, normalised to a list."""
    # Imported lazily: app.auth.config is pulled in very early, and a module-level import of
    # app.config would instantiate the app settings as a side effect of importing auth.
    from app.config import settings

    raw = settings.cors_origins
    # cors_origins is `list[str] | str`; the field validator normally splits the string form,
    # but the annotation still permits a raw string, so handle both rather than trusting it.
    candidates = raw.split(",") if isinstance(raw, str) else raw
    return [origin.strip() for origin in candidates if origin.strip()]


def _tls_terminating_domain() -> str:
    """The `DOMAIN` from `.env`, i.e. Caddy's site address – empty on a LAN install.

    Non-empty means the shipped compose stack hands Caddy a real hostname, and Caddy answers
    it on 443 with an automatic certificate. There is no shape of that stack where a DOMAIN is
    set and browsers still arrive over plain http://, so this beats every other TLS signal we
    have – including CORS_ORIGINS.
    """
    from app.config import settings

    return settings.domain.strip()


def _browsers_arrive_over_plain_http() -> bool:
    """
    True when every configured CORS origin is `http://` – the deployment is not on TLS.

    CORS_ORIGINS is the one value in the config that has to describe how browsers actually
    reach the board (get it wrong and every API call fails), so its scheme is the most
    reliable TLS signal we have. ENVIRONMENT=production says nothing about it: the shipped
    compose stack sets ENVIRONMENT=production and still serves plain HTTP whenever DOMAIN is
    empty, which is the normal trusted-LAN install.

    Mixed schemes deliberately read as "TLS somewhere" and do NOT downgrade – an https origin
    means at least one browser arrives over TLS and would lose its cookie.

    Read this together with `_tls_terminating_domain`: "get it wrong and every API call fails"
    is NOT true on the compose stack, where Caddy makes everything same-origin and CORS is
    never exercised at all. See `cookie_secure` for what that costs.
    """
    origins = _configured_origins()

    # No origins configured tells us nothing – leave the decision to the environment.
    if not origins:
        return False

    return all(origin.lower().startswith("http://") for origin in origins)


class AuthSettings(BaseSettings):
    """JWT and authentication settings."""

    # Development Mode
    BYPASS_AUTH_DEV: bool = False  # Set to True to disable authentication in development

    # JWT Configuration
    # S105 suppressed: the placeholder IS the point – validation rejects it in production.
    SECRET_KEY: str = "CHANGE_THIS_IN_PRODUCTION_USE_OPENSSL_RAND"  # noqa: S105  (openssl rand -hex 32)
    ALGORITHM: str = "HS256"  # Use RS256 for distributed systems
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours for emergency operations (availability > security)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7  # Longer-lived refresh token

    # Password Policy
    MIN_PASSWORD_LENGTH: int = 12  # Increased from 8 for better security
    MAX_PASSWORD_LENGTH: int = 72  # Bcrypt has a hard limit of 72 bytes

    # Cookie Security
    # None = decide from the environment (secure on a deployment, plain in development).
    # Set explicitly to opt out – see the cookie_secure property.
    COOKIE_SECURE: bool | None = None
    COOKIE_HTTPONLY: bool = True  # Prevent XSS attacks
    COOKIE_SAMESITE: str = "lax"  # Use "none" for cross-origin setups (requires COOKIE_SECURE=true)
    COOKIE_DOMAIN: str = ""  # Empty = use request host. Set to ".example.com" for subdomain sharing

    @field_validator("COOKIE_SECURE", mode="before")
    @classmethod
    def blank_means_unset(cls, v: object) -> object:
        """Treat `AUTH_COOKIE_SECURE=` (blank) as "not configured".

        Operators copy .env.example and leave keys they don't need empty. Without this,
        pydantic rejects the empty string and the backend refuses to boot with a parsing
        error – a hostile failure for something that is supposed to be optional.
        """
        if isinstance(v, str) and not v.strip():
            return None
        return v

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
        Secure cookies on a real deployment – unless the operator explicitly opts out.

        A station on a trusted LAN runs plain HTTP with no domain (docker-compose with an
        empty DOMAIN). A browser silently DROPS a Secure cookie over http://, so forcing it
        there makes login impossible with no visible error – the failure looks like "the PIN
        doesn't work". `AUTH_COOKIE_SECURE=false` is the deliberate escape hatch; leaving it
        unset keeps the secure default, so nothing is weakened by accident.

        Requiring that escape hatch is what made the shipped LAN install unloggable-in out of
        the box: ENVIRONMENT=production plus an empty DOMAIN meant Secure cookies over http://,
        and the only cure was a variable you find in SETUP.md §7 *after* being bitten. So when
        the operator made no choice, the CORS origins decide – they already have to match the
        URL browsers use. An explicit setting always wins over that inference.

        DOMAIN vetoes that inference, because the "CORS_ORIGINS cannot stay wrong for long"
        premise it rests on is false on the compose stack: Caddy serves the board, the API and
        the socket from ONE origin, so the browser never sends a cross-origin request and a
        wrong CORS_ORIGINS has no symptom whatsoever. `just init` derives the two together, but
        SETUP.md §1 also documents editing `.env` by hand – set DOMAIN=kp.example.ch, forget
        the CORS_ORIGINS=http://localhost:8080 default underneath it, and the board would have
        served login cookies without Secure over the public internet, silently and forever.
        """
        if self.COOKIE_SECURE is not None:
            if _is_production_environment() and not self.COOKIE_SECURE:
                logger.warning(
                    "AUTH_COOKIE_SECURE=false: login cookies are sent over plain HTTP. "
                    "Only acceptable on a trusted LAN, never on an internet-facing deployment."
                )
            return self.COOKIE_SECURE

        if _browsers_arrive_over_plain_http():
            domain = _tls_terminating_domain()
            if domain:
                # Not dangerous any more – but still a real misconfiguration, and the only
                # place it is ever visible. Name both values: the operator has to be able to
                # go and fix the one that is wrong without guessing which.
                logger.error(
                    "DOMAIN=%s means Caddy serves this deployment over HTTPS, but CORS_ORIGINS "
                    "is plain http:// only (%s). Keeping Secure on login cookies regardless. "
                    "Fix CORS_ORIGINS to https://%s – a direct cross-origin API client is "
                    "being told the wrong address.",
                    domain,
                    ", ".join(_configured_origins()),
                    domain,
                )
            else:
                # Only worth saying on a deployment: in development the answer is False anyway.
                if _is_production_environment():
                    logger.warning(
                        "CORS_ORIGINS is plain http:// only, so this deployment looks like it "
                        "serves the board without TLS – login cookies are sent WITHOUT Secure. "
                        "That is fine on a trusted LAN and wrong on anything internet-facing. "
                        "Set AUTH_COOKIE_SECURE=true to override (and put the board behind TLS)."
                    )
                return False

        return _is_production_environment()

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
