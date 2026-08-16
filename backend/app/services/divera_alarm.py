"""Outbound Divera 24/7 services: alarms (Ausalarmierung) and Mitteilungen.

Both live here because they are the same transport, the same validation quirk
and the same field caps — Divera's ``/api/v2/news`` is an alarm's quieter
sibling, not a separate integration. ``send_news`` below is the Mitteilung; it
is what an *informational* message ("KP-Rück ist aktiv, Telefon mitnehmen")
should use, because a full alarm is a siren-grade event on every phone.

The alarm half:

Sends alarms to individual people via the Divera v2 API, targeting them by their
``user_cluster_relation`` id with ``notification_type = 4`` (= selected users
only — NEVER 2, which is everyone). Hardened along the lines of the fwo-divera
client:

- treats HTTP 200 + ``success: false`` as a failure (Divera's documented quirk),
- retries transient network errors with backoff,
- never triggers the pager (``send_pager = False``) so it can't double-page via
  the fwo-divera e-Call bridge, which pages on every alarm it sees and only skips
  ``foreign_id`` prefixes it recognises.

Optional by design: if no access key is configured the caller gets a clear error
and nothing is sent. Installations that don't use Divera never reach this code.
"""

import asyncio
import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# Divera v2 Empfänger-Auswahl. 4 = selected users only.
# 2 = ALL of the location — must never be used for an ALARM. A Mitteilung is the
# one thing that legitimately goes to everybody (see NOTIFICATION_TYPE_ALL below).
NOTIFICATION_TYPE_SELECTED_USERS = 4
NOTIFICATION_TYPE_SELECTED_GROUPS = 3
NOTIFICATION_TYPE_ALL = 2

# Field caps enforced client-side (Divera truncates/ rejects beyond these).
MAX_TITLE = 50
MAX_TEXT = 1000
MAX_ADDRESS = 200

_RETRYABLE = (httpx.ConnectError, httpx.TimeoutException, httpx.ReadError)


class DiveraAlarmError(Exception):
    """Raised when an outbound alarm or Mitteilung cannot be sent."""


def _truncate(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    return value[:limit]


def _validate(data: dict[str, Any]) -> None:
    """Divera returns HTTP 200 with ``success: false`` on rejection."""
    if not data.get("success", False):
        errors = data.get("errors") or data.get("message") or data
        raise DiveraAlarmError(f"Divera rejected the alarm: {errors}")


async def _request_with_retry(
    method: str, url: str, *, params: dict[str, Any], json_body: dict[str, Any] | None = None
) -> Any:
    """One Divera HTTP call with retry + body-level validation.

    Returns the parsed ``data`` field (shape depends on the endpoint: an alarm
    object for POST/PUT, an items map/list for the GET list).
    """
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.request(method, url, params=params, json=json_body)
            resp.raise_for_status()
            data = resp.json()
            _validate(data)
            return data.get("data")
        except _RETRYABLE as exc:
            last_exc = exc
            logger.warning("Divera %s attempt %d failed: %s", method, attempt + 1, exc)
            await asyncio.sleep(0.5 * (2**attempt))
        except httpx.HTTPStatusError as exc:
            raise DiveraAlarmError(f"Divera returned HTTP {exc.response.status_code}") from exc

    raise DiveraAlarmError(f"Divera unreachable after retries: {last_exc}")


def _extract_alarm_ids(list_data: Any) -> list[int]:
    """Pull numeric alarm ids out of a v2 alarm-list ``data`` payload.

    Divera returns either ``{"items": {"<id>": {...}}}``, a bare ``{"<id>": {...}}``
    map, or a list of objects — handle all three.
    """
    if not list_data:
        return []
    container = list_data.get("items", list_data) if isinstance(list_data, dict) else list_data
    ids: list[int] = []
    if isinstance(container, dict):
        for key in container:
            try:
                ids.append(int(key))
            except (ValueError, TypeError):
                continue
    elif isinstance(container, list):
        for item in container:
            if isinstance(item, dict) and item.get("id") is not None:
                try:
                    ids.append(int(item["id"]))
                except (ValueError, TypeError):
                    continue
    return ids


async def _find_existing_alarm_id(foreign_id: str) -> int | None:
    """Return the most recent non-archived alarm id for this foreign_id, if any.

    v2 does NOT merge on POST (verified) — it would create duplicates — so we
    look for an existing alarm and update it instead.
    """
    params = {"accesskey": settings.divera_access_key, "foreign_id": foreign_id}
    list_data = await _request_with_retry("GET", f"{settings.divera_api_url}/alarms", params=params)
    ids = _extract_alarm_ids(list_data)
    return max(ids) if ids else None


async def send_alarm(
    *,
    user_cluster_relation: list[int],
    title: str,
    text: str,
    foreign_id: str,
    priority: bool = False,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    send_push: bool = True,
    send_sms: bool = False,
    send_call: bool = False,
    send_mail: bool = False,
) -> dict[str, Any]:
    """Create or update a Divera alarm targeting the given users.

    A stable ``foreign_id`` (e.g. ``kprueck-<incident_id>``) keeps re-sends on a
    single alarm per incident: we look up an existing alarm by foreign_id and PUT
    it, otherwise POST a new one. (v2 does not merge on POST — it duplicates.)

    Returns the Divera ``data`` object (id, count_recipients, ...).
    Raises :class:`DiveraAlarmError` on misconfiguration or Divera rejection.
    """
    if not settings.divera_access_key:
        raise DiveraAlarmError("Divera access key not configured")
    if not user_cluster_relation:
        raise DiveraAlarmError("No Divera recipients to alarm")

    alarm: dict[str, Any] = {
        "title": _truncate(title, MAX_TITLE) or "Alarm",
        "text": _truncate(text, MAX_TEXT) or "",
        "priority": bool(priority),
        # notification_type echoed on update too (Divera silently no-ops a PUT
        # that omits it). 4 = selected users only — never 2 (= everyone).
        "notification_type": NOTIFICATION_TYPE_SELECTED_USERS,
        "user_cluster_relation": user_cluster_relation,
        "send_push": send_push,
        "send_sms": send_sms,
        "send_call": send_call,
        "send_mail": send_mail,
        "send_pager": False,  # never page — avoids double-paging via the e-Call bridge
        "foreign_id": foreign_id,
    }
    if address:
        alarm["address"] = _truncate(address, MAX_ADDRESS)
    if lat is not None and lng is not None:
        alarm["lat"] = lat
        alarm["lng"] = lng

    payload = {
        "Alarm": alarm,
        "instructions": {"user_cluster_relation": {"mapping": "id"}},
    }
    base = settings.divera_api_url
    params = {"accesskey": settings.divera_access_key}

    existing_id = await _find_existing_alarm_id(foreign_id)
    if existing_id is not None:
        logger.info("Updating existing Divera alarm %s (foreign_id=%s)", existing_id, foreign_id)
        data = await _request_with_retry("PUT", f"{base}/alarms/{existing_id}", params=params, json_body=payload)
    else:
        data = await _request_with_retry("POST", f"{base}/alarms", params=params, json_body=payload)

    return data if isinstance(data, dict) else {}


async def send_news(
    *,
    title: str,
    text: str,
    foreign_id: str,
    group_ids: list[int] | None = None,
    user_cluster_relation: list[int] | None = None,
    to_everyone: bool = False,
    send_push: bool = True,
    send_sms: bool = False,
    send_call: bool = False,
    send_mail: bool = False,
) -> dict[str, Any]:
    """Post a Divera *Mitteilung* (``/api/v2/news``) — an informational message.

    The KP's standby message ("KP-Rück ist aktiv, Telefon mitnehmen") is exactly
    this: everybody should read it, nobody should be woken by a siren. Which is
    also why a Mitteilung MAY go to the whole Standort where an alarm may not —
    but never by accident: the caller has to say ``to_everyone=True``, because
    the difference between "die Gruppe Pikett" and "die ganze Feuerwehr" is one
    forgotten argument.

    Recipients, in order of precedence: ``group_ids`` (notification_type 3),
    ``user_cluster_relation`` (4), ``to_everyone`` (2). Nothing at all is an
    error rather than a silent broadcast.

    Never touches the pager, for the same reason the alarm doesn't: the
    fwo-divera e-Call bridge pages on everything it sees.

    Unlike an alarm this is always a POST — a Mitteilung is a moment, not a
    living object that later re-sends get folded into, so there is no
    lookup-then-update dance. ``foreign_id`` is still stamped so the message can
    be recognised in Divera later.

    Note for FREE-tier units: Divera allows one Mitteilung per five minutes.

    Returns the Divera ``data`` object. Raises :class:`DiveraAlarmError`.
    """
    if not settings.divera_access_key:
        raise DiveraAlarmError("Divera access key not configured")
    if not group_ids and not user_cluster_relation and not to_everyone:
        raise DiveraAlarmError("Keine Empfänger für die Mitteilung ausgewählt")

    if group_ids:
        notification_type = NOTIFICATION_TYPE_SELECTED_GROUPS
    elif user_cluster_relation:
        notification_type = NOTIFICATION_TYPE_SELECTED_USERS
    else:
        notification_type = NOTIFICATION_TYPE_ALL

    news: dict[str, Any] = {
        "title": _truncate(title, MAX_TITLE) or "Mitteilung",
        "text": _truncate(text, MAX_TEXT) or "",
        "notification_type": notification_type,
        "send_push": send_push,
        "send_sms": send_sms,
        "send_call": send_call,
        "send_mail": send_mail,
        "send_pager": False,  # never page — avoids double-paging via the e-Call bridge
        "foreign_id": foreign_id,
    }
    payload: dict[str, Any] = {"News": news}
    instructions: dict[str, Any] = {}
    if group_ids:
        news["group"] = group_ids
        instructions["group"] = {"mapping": "id"}
    elif user_cluster_relation:
        news["user_cluster_relation"] = user_cluster_relation
        instructions["user_cluster_relation"] = {"mapping": "id"}
    if instructions:
        payload["instructions"] = instructions

    params = {"accesskey": settings.divera_access_key}
    data = await _request_with_retry("POST", f"{settings.divera_api_url}/news", params=params, json_body=payload)
    return data if isinstance(data, dict) else {}
