"""Divera 24/7 implementation of the AlarmProvider protocol.

Thin adapter over ``services.divera_alarm`` — all Divera API specifics
(notification_type safety, field caps, foreign_id idempotency) live there.
"""

from .. import divera_alarm
from .base import AlarmChannels, AlarmResult, AlarmSendError, MessageResult


class DiveraAlarmProvider:
    slug = "divera"
    display_name = "DIVERA 24/7"

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
        try:
            user_cluster_relation = [int(eid) for eid in external_ids]
        except ValueError as e:
            raise AlarmSendError(f"Ungültige Divera-ID: {e}") from e

        try:
            data = await divera_alarm.send_alarm(
                user_cluster_relation=user_cluster_relation,
                title=title,
                text=text,
                foreign_id=foreign_id,
                priority=priority,
                address=address,
                lat=lat,
                lng=lng,
                send_push=channels.push,
                send_sms=channels.sms,
                send_call=channels.call,
                send_mail=channels.mail,
            )
        except divera_alarm.DiveraAlarmError as e:
            raise AlarmSendError(str(e)) from e

        return AlarmResult(
            provider_alarm_id=data.get("id"),
            count_recipients=data.get("count_recipients"),
            raw=data,
        )

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
        """Post a Divera Mitteilung (``/api/v2/news``) — see the protocol docstring.

        ``to_everyone`` is passed through rather than inferred from "no groups
        given": a broadcast to the whole Feuerwehr is a decision, not a default.
        """
        try:
            data = await divera_alarm.send_news(
                title=title,
                text=text,
                foreign_id=foreign_id,
                group_ids=group_ids,
                to_everyone=to_everyone,
                send_push=channels.push,
                send_sms=channels.sms,
                send_call=channels.call,
                send_mail=channels.mail,
            )
        except divera_alarm.DiveraAlarmError as e:
            raise AlarmSendError(str(e)) from e

        return MessageResult(provider_message_id=data.get("id"), raw=data)
