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


class MessageNotSupportedError(Exception):
    """This provider pages people but has no informational-message channel."""


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


@dataclass
class MessageResult:
    """Provider-neutral result of a Mitteilung."""

    provider_message_id: int | None = None
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

    async def send_message(
        self,
        *,
        title: str,
        text: str,
        foreign_id: str,
        channels: AlarmChannels,
        group_ids: list[int] | None = None,
        to_everyone: bool = False,
    ) -> MessageResult:
        """Send an informational message to selected groups — NOT an alarm.

        The distinction is the point: an alarm is siren-grade on every phone, a
        Mitteilung is a notification everybody reads when they get to it. The
        KP's standby message ("KP-Rück ist aktiv, Telefon mitnehmen") is the
        latter, and used to be a WhatsApp text pasted by hand.

        Recipients are explicit on purpose: ``group_ids`` names the Divera
        groups (Pikett, Zug 1, …), and reaching the WHOLE unit needs
        ``to_everyone=True``. Neither one set is an error — a message that
        defaults to the entire Feuerwehr is one forgotten argument away from
        waking 80 people.

        A provider whose service has no such concept raises
        :class:`MessageNotSupportedError` — it must not quietly downgrade to an
        alarm. Raises AlarmSendError on a provider failure.
        """
        ...
