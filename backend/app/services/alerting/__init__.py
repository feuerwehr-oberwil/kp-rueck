"""Provider registry for outbound alerting.

The active provider is derived from environment configuration (secrets are
env-only; the DB stores behavior, not credentials). Currently Divera is the
only implemented provider; adding another means one adapter module plus an
entry here.
"""

from ...config import settings
from .base import AlarmChannels, AlarmProvider, AlarmResult, AlarmSendError
from .divera import DiveraAlarmProvider

__all__ = [
    "AlarmChannels",
    "AlarmProvider",
    "AlarmResult",
    "AlarmSendError",
    "get_provider",
]


def get_provider() -> AlarmProvider | None:
    """The configured outbound alerting provider, or None when none is set up."""
    if settings.divera_access_key:
        return DiveraAlarmProvider()
    return None
