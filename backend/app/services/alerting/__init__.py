"""Provider registry for outbound alerting.

The active provider is derived from environment configuration (secrets are
env-only; the DB stores behavior, not credentials). Currently Divera is the
only implemented provider; adding another means one adapter module plus an
entry here.

This is also the seam at which a deployment role can refuse to alert at all —
one guard here rather than a check in every route, so a new caller cannot
forget it (see ``get_provider``).
"""

from typing import Any

from ...config import settings
from ...environment import blocked_reason, is_domain_blocked
from .base import AlarmBlockedError, AlarmChannels, AlarmProvider, AlarmResult, AlarmSendError
from .divera import DiveraAlarmProvider

__all__ = [
    "AlarmBlockedError",
    "AlarmChannels",
    "AlarmProvider",
    "AlarmResult",
    "AlarmSendError",
    "get_provider",
]


class BlockedAlarmProvider:
    """Stands in front of the configured provider when the deployment role refuses alerting.

    It keeps the real provider's identity, so the registry and the UI still report *which*
    service this station would page through — the block is about the effect, not about the
    configuration. Sending raises instead of returning a fake success: an operator who presses
    the button must be told nobody was alarmed.
    """

    def __init__(self, provider: AlarmProvider) -> None:
        self.slug = provider.slug
        self.display_name = provider.display_name

    async def send_alarm(self, **kwargs: Any) -> AlarmResult:
        reason = blocked_reason("alerting") or "Ausalarmierung ist auf diesem System gesperrt."
        raise AlarmBlockedError(reason)


def _configured_provider() -> AlarmProvider | None:
    """The provider this station has credentials for, ignoring any deployment-role block."""
    if settings.divera_access_key:
        return DiveraAlarmProvider()
    return None


def get_provider() -> AlarmProvider | None:
    """The outbound alerting provider, or None when none is set up.

    On a deployment whose role blocks alerting, the real provider is wrapped so that every
    send — incident alarm, setup test alarm, anything added later — fails loudly at this one
    place. The DB setting ``alerting.enabled`` cannot re-open it; that setting arrives with a
    copied database and is exactly what the role exists to overrule.
    """
    provider = _configured_provider()
    if provider is not None and is_domain_blocked("alerting"):
        return BlockedAlarmProvider(provider)
    return provider
