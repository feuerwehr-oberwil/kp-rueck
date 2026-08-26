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
from ..environment import blocked_domains, blocked_reason, deployment_role, deployment_role_label
from ..services import alerting

router = APIRouter(prefix="/integrations", tags=["integrations"])


class ProviderCapability(BaseModel):
    """The active provider for one domain (None = built-in fallbacks only)."""

    provider: str | None = None
    display_name: str | None = None
    configured: bool = False
    capabilities: list[str] = Field(default_factory=list)
    #: True when the deployment role refuses this domain outright. Orthogonal to ``configured``:
    #: a staging copy is fully configured for alerting and still will not send. Reported here so
    #: an API caller sees the block, not only somebody looking at the UI.
    blocked: bool = False
    #: German sentence naming why, when ``blocked``.
    blocked_reason: str | None = None


class DeploymentRole(BaseModel):
    """What this instance is allowed to do to the outside world (see app/environment.py)."""

    role: str
    #: Short German label for a non-production role ("Staging – Übungssystem"), else None.
    label: str | None = None
    #: Effect domains this role refuses, including domains that are not provider domains
    #: (``sync``). Empty on production.
    blocked_domains: list[str] = Field(default_factory=list)


class KnownProvider(BaseModel):
    """One provider this build knows about, whether or not this station uses it.

    The four domain fields above answer *who is active here*. This list answers *what could I
    point at* — which is what makes a domain a choice rather than a vendor, and it is the only
    place a provider that nobody has configured can be discovered at all.

    ``implemented`` is false for a provider whose contract is published but whose ingestion is
    not built. An entry that is discoverable and honest about being inert is worth having; a
    registry that quietly implies everything listed works is not.
    """

    provider: str
    display_name: str
    domain: Literal["alarms", "alerting", "personnel", "vehicles"]
    configured: bool = False
    implemented: bool = True
    capabilities: list[str] = Field(default_factory=list)
    #: Repository-relative path to the published contract, when the provider has one.
    contract: str | None = None


def _default_builtin_alarm_paths() -> list[Literal["generic-webhook", "manual-intake", "operator"]]:
    """Default value for ``IntegrationsResponse.builtin_alarm_paths``."""
    return ["generic-webhook", "manual-intake", "operator"]


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
        default_factory=_default_builtin_alarm_paths
    )
    # Every provider this build knows about, configured or not — see KnownProvider.
    known_providers: list[KnownProvider] = Field(default_factory=list)
    # What this instance may do to the outside world, whatever the database says.
    deployment: DeploymentRole = Field(default_factory=lambda: DeploymentRole(role="production"))


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
            blocked=bool(blocked_reason("alerting")),
            blocked_reason=blocked_reason("alerting"),
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
        known_providers=[
            KnownProvider(
                provider="divera",
                display_name="DIVERA 24/7",
                domain="alarms",
                configured=divera,
                capabilities=["webhook", "poll", "pool", "auto-attach"],
            ),
            # FireHub needs no server-side key: the station points its webhook at us and
            # authenticates with the shared alarm secret, so there is nothing in the
            # environment to key `configured` off — it is a payload adapter over the generic
            # inbound path (start → pool alarm, end → retire), always available once a
            # webhook secret is set. Listed so the alarms domain reads as a choice of
            # dispatch systems, not just Divera.
            KnownProvider(
                provider="firehub",
                display_name="FireHub",
                domain="alarms",
                configured=False,
                capabilities=["webhook", "pool", "auto-attach", "lifecycle"],
            ),
            KnownProvider(
                provider=provider.slug if provider else "divera",
                display_name=provider.display_name if provider else "DIVERA 24/7",
                domain="alerting",
                configured=provider is not None,
                capabilities=["push", "sms", "call", "mail"],
            ),
            KnownProvider(
                provider="divera",
                display_name="DIVERA 24/7",
                domain="personnel",
                configured=divera,
                capabilities=["roster-sync"],
            ),
            # A roster file another system publishes, to a versioned schema any station can
            # point at any URL. Listed so the personnel domain reads as a choice rather than
            # one vendor — but `implemented=False`, because the contract is published and the
            # ingestion is not built. KP Front carries the identical schema files and the same
            # `roster.source: "snapshot"` selector; neither app reads the other.
            KnownProvider(
                provider="roster-snapshot",
                display_name="Publizierter Personenstamm",
                domain="personnel",
                configured=False,
                implemented=False,
                capabilities=["contract"],
                contract="docs/roster-snapshot.schema.json",
            ),
            KnownProvider(
                provider="traccar",
                display_name="Traccar",
                domain="vehicles",
                configured=traccar,
                capabilities=["gps-tracking", "status-automation"],
            ),
        ],
        deployment=DeploymentRole(
            role=deployment_role(),
            label=deployment_role_label(),
            blocked_domains=list(blocked_domains()),
        ),
    )


@router.get("", response_model=IntegrationsResponse)
async def get_integrations(current_user: CurrentUser) -> IntegrationsResponse:
    """Which providers are configured, per domain (viewer-readable)."""
    return integrations()
