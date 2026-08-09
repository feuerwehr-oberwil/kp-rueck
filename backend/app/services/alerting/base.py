"""Provider-neutral outbound alerting (Ausalarmierung) contract.

An AlarmProvider pages people through an external alerting service (push, SMS,
call, pager). There is deliberately no provider-less fallback — paging needs a
service with delivery infrastructure. Providers are typed internal adapters
(kp-front rule: no runtime plugins); a new service means one new module in
this package implementing the protocol below, registered in ``__init__``.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol


class AlarmSendError(Exception):
    """Sending failed at the provider (network, auth, rejected payload)."""


class AlarmBlockedError(Exception):
    """This deployment refuses to alert at all, whatever the settings say.

    Deliberately NOT an AlarmSendError: nothing failed at the provider, we never went there,
    and the existing ``except AlarmSendError`` blocks turn everything into a 502 "provider
    failed" — which would send somebody debugging the alerting service at 02:00 over a policy
    decision. Staying outside that hierarchy lets it travel to the single handler in
    ``main.py`` that answers 403 with the reason, so no route needs its own check.

    It is never a silent no-op. Whoever pressed the button is told nobody was alarmed.
    """


@dataclass
class AlarmChannels:
    """Which delivery channels the operator selected."""

    push: bool = True
    sms: bool = False
    call: bool = False
    mail: bool = False


@dataclass
class AlarmResult:
    """Provider-neutral result of a send."""

    provider_alarm_id: int | None = None
    count_recipients: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class AlarmProvider(Protocol):
    """One external alerting service, addressed by external personnel ids."""

    # Provider slug — matches PersonnelExternalIdentity.provider
    slug: str
    # Human-readable name for UI/skip reasons ("DIVERA 24/7")
    display_name: str

    async def send_alarm(
        self,
        *,
        external_ids: list[str],
        title: str,
        text: str,
        foreign_id: str,
        priority: bool = False,
        address: str | None = None,
        lat: float | None = None,
        lng: float | None = None,
        channels: AlarmChannels,
    ) -> AlarmResult:
        """Send an alarm to the given provider-side ids. Raises AlarmSendError."""
        ...
