"""Provider capability registry.

Single source of truth for which external providers are configured, per
domain. Derived purely from environment configuration (secrets are env-only)
so the answer can never drift from what the backend can actually do. The
frontend renders provider names and gates provider UI from this instead of
hard-coding vendors.

Built-in fallbacks (manual intake form, generic alarm webhook) are always
available and deliberately NOT listed as providers.
"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..auth.dependencies import CurrentUser
from ..config import settings
from ..services import alerting

router = APIRouter(prefix="/integrations", tags=["integrations"])


class ProviderCapability(BaseModel):
    """The active provider for one domain (None = built-in fallbacks only)."""

    provider: str | None = None
    display_name: str | None = None
    configured: bool = False
    capabilities: list[str] = Field(default_factory=list)


class IntegrationsResponse(BaseModel):
    """Per-domain provider capabilities."""

    # Inbound alarm delivery into the pool
    alarms: ProviderCapability
    # Outbound alerting (Ausalarmierung)
    alerting: ProviderCapability
    # Personnel roster sync
    personnel: ProviderCapability
    # Vehicle GPS tracking
    vehicles: ProviderCapability
    # Always-available built-in ingest paths (not providers)
    builtin_alarm_paths: list[Literal["generic-webhook", "manual-intake", "operator"]] = Field(
        default_factory=lambda: ["generic-webhook", "manual-intake", "operator"]
    )


def integrations() -> IntegrationsResponse:
    """Derive the capability registry from environment configuration."""
    divera = bool(settings.divera_access_key)
    traccar = bool(settings.traccar_url and settings.traccar_email and settings.traccar_password)
    provider = alerting.get_provider()

    return IntegrationsResponse(
        alarms=ProviderCapability(
            provider="divera" if divera else None,
            display_name="DIVERA 24/7" if divera else None,
            configured=divera,
            capabilities=["webhook", "poll", "pool", "auto-attach"] if divera else [],
        ),
        alerting=ProviderCapability(
            provider=provider.slug if provider else None,
            display_name=provider.display_name if provider else None,
            configured=provider is not None,
            capabilities=["push", "sms", "call", "mail"] if provider else [],
        ),
        personnel=ProviderCapability(
            provider="divera" if divera else None,
            display_name="DIVERA 24/7" if divera else None,
            configured=divera,
            capabilities=["roster-sync"] if divera else [],
        ),
        vehicles=ProviderCapability(
            provider="traccar" if traccar else None,
            display_name="Traccar" if traccar else None,
            configured=traccar,
            capabilities=["gps-tracking", "status-automation"] if traccar else [],
        ),
    )


@router.get("", response_model=IntegrationsResponse)
async def get_integrations(current_user: CurrentUser):
    """Which providers are configured, per domain (viewer-readable)."""
    return integrations()
