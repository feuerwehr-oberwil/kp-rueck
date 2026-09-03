"""Tests for the Divera intake path: member/group import and the alarm poller.

Both services are the station's only automatic route from Divera into the board — the
Mannschaft comes in through `divera_members`, the alarms through `divera_poller` (the
fallback for a webhook that never arrived). Neither is watched by anyone while it runs, so
what matters is not the happy path but how a bad upstream answer is absorbed: a 500, a
timeout, a rejected access key, a payload shaped differently than last release. All of those
must end as a log line and an empty result, never as a half-imported Mannschaft or a crashed
poll loop.

The HTTP layer is stubbed with `httpx.MockTransport`, so the real httpx client code still
runs (params, `raise_for_status`, timeouts) but no socket is opened — which the suite-wide
`block_outbound_http` fixture would refuse anyway.
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.config import settings
from app.models import Personnel, PersonnelExternalIdentity, User
from app.services.divera_members import (
    build_sync_preview,
    execute_sync,
    fetch_divera_groups,
    fetch_divera_members,
)
from app.services.divera_poller import DiveraPoller

# ============================================
# Stubbing the Divera HTTP layer
# ============================================


def _stub_client_class(handler: Callable[[httpx.Request], httpx.Response]) -> type[httpx.AsyncClient]:
    """An `httpx.AsyncClient` drop-in that answers from `handler` instead of the network.

    The two fetchers build their own client inside the function (`httpx.AsyncClient(timeout=…)`),
    so the only seam is the name on the httpx module. Subclassing rather than mocking keeps the
    real request/response machinery in the test — a 4xx still has to travel through
    `raise_for_status`, and the accesskey still has to survive query encoding.
    """

    class _StubClient(httpx.AsyncClient):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    return _StubClient


def _json_handler(payload: dict[str, Any], status: int = 200) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=payload)

    return handler


def _pull_payload(
    *,
    consumer: dict[str, Any] | None = None,
    group: Any = None,
    success: bool = True,
) -> dict[str, Any]:
    """A `pull/all` answer in the shape Divera actually returns."""
    cluster: dict[str, Any] = {}
    if consumer is not None:
        cluster["consumer"] = consumer
    if group is not None:
        cluster["group"] = group
    return {"success": success, "data": {"cluster": cluster}}


@pytest.fixture
def divera_key(monkeypatch):
    """Give the services a configured access key (they refuse to call out without one)."""
    monkeypatch.setattr(settings, "divera_access_key", "test-access-key")
    return "test-access-key"


# ============================================
# fetch_divera_members — HTTP contract
# ============================================


async def test_members_fetch_sends_the_access_key_to_pull_all(monkeypatch, divera_key):
    """The access key is the whole authentication — it travels as a query param, not a header."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_pull_payload(consumer={}))

    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(handler))

    assert await fetch_divera_members() == []

    assert seen[0].url.path.endswith("/pull/all")
    assert seen[0].url.params["accesskey"] == divera_key


async def test_members_fetch_without_a_key_never_calls_out(monkeypatch):
    """An unconfigured station must fail before the request, not with a 403 from Divera."""
    monkeypatch.setattr(settings, "divera_access_key", "")

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("fetch_divera_members called Divera without an access key")

    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(handler))

    with pytest.raises(ValueError, match="access key"):
        await fetch_divera_members()


async def test_members_fetch_raises_on_a_rejected_key(monkeypatch, divera_key):
    """Divera answers a bad key with HTTP 200 and `success: false`, so the status code alone
    would import an empty Mannschaft — and with `remove_stale` that deletes everyone."""
    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(_json_handler({"success": False})))

    with pytest.raises(ValueError, match="success=false"):
        await fetch_divera_members()


async def test_members_fetch_propagates_a_server_error(monkeypatch, divera_key):
    """A 5xx must surface as an exception (the API layer turns it into a 502), never as []."""
    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(_json_handler({}, status=503)))

    with pytest.raises(httpx.HTTPStatusError):
        await fetch_divera_members()


# ============================================
# fetch_divera_members — name mapping
# ============================================


async def test_members_are_mapped_to_lastname_first(monkeypatch, divera_key):
    """Divera hands out `stdformat_name` as "Lastname, Firstname"; the board shows
    "Lastname Firstname" so the list sorts and searches by last name."""
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _stub_client_class(
            _json_handler(
                _pull_payload(
                    consumer={
                        "11": {"stdformat_name": " Muster , Hans ", "firstname": "Hans", "lastname": "Muster"},
                        # No comma in stdformat_name: taken as-is, not split.
                        "12": {"stdformat_name": "Einzelname", "firstname": "", "lastname": ""},
                        # No stdformat_name: assembled from the two parts.
                        "13": {"stdformat_name": "", "firstname": "Anna", "lastname": "Beispiel"},
                        # Lastname only still yields a usable person.
                        "14": {"stdformat_name": "", "firstname": "", "lastname": "Nurnachname"},
                    }
                )
            )
        ),
    )

    members = await fetch_divera_members()

    assert {m["divera_id"]: m["name"] for m in members} == {
        11: "Muster Hans",
        12: "Einzelname",
        13: "Beispiel Anna",
        14: "Nurnachname",
    }


async def test_members_without_a_usable_identity_are_skipped(monkeypatch, divera_key):
    """A nameless or unkeyed entry is dropped rather than imported as a blank person — a
    magnet with no name on it is worse than a missing one."""
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _stub_client_class(
            _json_handler(
                _pull_payload(
                    consumer={
                        "21": {"stdformat_name": "", "firstname": "", "lastname": ""},  # no name at all
                        "not-a-number": {"lastname": "Schlüssel"},  # id is not an int
                        "23": "kein dict",  # value is not an object
                        "24": {"firstname": "Nur", "lastname": ""},  # firstname alone is not enough
                        "25": {"lastname": "Gültig", "firstname": "Person"},
                    }
                )
            )
        ),
    )

    assert await fetch_divera_members() == [{"divera_id": 25, "name": "Gültig Person"}]


async def test_members_fetch_survives_a_payload_without_a_cluster(monkeypatch, divera_key):
    """A successful answer with nothing in it is an empty Mannschaft, not a KeyError."""
    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(_json_handler({"success": True})))

    assert await fetch_divera_members() == []


# ============================================
# fetch_divera_groups
# ============================================


async def test_groups_come_back_sorted_by_name(monkeypatch, divera_key):
    """The list is picked from in a dropdown when addressing a Mitteilung, so it is sorted
    case-insensitively by name rather than by Divera's id order."""
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _stub_client_class(
            _json_handler(
                _pull_payload(
                    consumer={},
                    group={
                        "3": {"name": "Zug 2"},
                        "1": {"name": "atemschutz"},
                        "2": {"name": "Pikett"},
                    },
                )
            )
        ),
    )

    assert await fetch_divera_groups() == [
        {"divera_id": 1, "name": "atemschutz"},
        {"divera_id": 2, "name": "Pikett"},
        {"divera_id": 3, "name": "Zug 2"},
    ]


async def test_groups_accept_the_legacy_list_shape(monkeypatch, divera_key):
    """Older Divera payloads return groups as a list of objects carrying their own id."""
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _stub_client_class(
            _json_handler(_pull_payload(consumer={}, group=[{"id": 7, "name": "Pikett"}, {"id": 8, "name": "Zug 1"}]))
        ),
    )

    assert await fetch_divera_groups() == [
        {"divera_id": 7, "name": "Pikett"},
        {"divera_id": 8, "name": "Zug 1"},
    ]


async def test_groups_fall_back_to_the_shortname_and_drop_the_nameless(monkeypatch, divera_key):
    """Some groups only carry a shortname; a group with neither is not addressable and is dropped."""
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _stub_client_class(
            _json_handler(
                _pull_payload(
                    consumer={},
                    group={
                        "1": {"shortname": "AS"},
                        "2": {"name": "", "shortname": ""},
                        "x": {"name": "Unbrauchbare Id"},
                        "4": "kein dict",
                    },
                )
            )
        ),
    )

    assert await fetch_divera_groups() == [{"divera_id": 1, "name": "AS"}]


async def test_groups_fetch_refuses_without_a_key_and_on_a_rejected_key(monkeypatch):
    """Same two guards as the member fetch — the group list feeds the same alarm path."""
    monkeypatch.setattr(settings, "divera_access_key", "")
    with pytest.raises(ValueError, match="access key"):
        await fetch_divera_groups()

    monkeypatch.setattr(settings, "divera_access_key", "test-access-key")
    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(_json_handler({"success": False})))
    with pytest.raises(ValueError, match="success=false"):
        await fetch_divera_groups()


# ============================================
# build_sync_preview
# ============================================


def _person(name: str, divera_user_id: int | None = None) -> Personnel:
    """An unsaved Personnel row — the preview compares in memory and never touches the DB."""
    return Personnel(id=uuid4(), name=name, status="available", divera_user_id=divera_user_id)


def test_preview_marks_an_unknown_member_as_new():
    preview = build_sync_preview([{"divera_id": 1, "name": "Neu Person"}], [])

    assert preview["new"] == [{"member": {"divera_id": 1, "name": "Neu Person"}, "status": "new", "existing_id": None}]
    assert preview["unchanged"] == []
    assert preview["not_in_divera"] == []


def test_preview_matches_across_case_accents_and_spacing():
    """The two sides are maintained by different people; "Müller  hans" from the board and
    "Muller, Hans" from Divera are the same firefighter, and matching them is what keeps the
    sync from creating a duplicate magnet every run."""
    existing = [_person("müller  hans")]

    preview = build_sync_preview([{"divera_id": 5, "name": "Muller Hans"}], existing)

    assert preview["new"] == []
    assert preview["not_in_divera"] == []
    assert preview["unchanged"][0]["existing_id"] == str(existing[0].id)


def test_preview_reports_people_divera_no_longer_lists():
    """Someone who left the Feuerwehr shows up here — as a proposal, never as a deletion:
    only `execute_sync(remove_stale=True)` acts on it."""
    stays = _person("Bleibt Person")
    gone = _person("Weg Person")

    preview = build_sync_preview([{"divera_id": 1, "name": "Bleibt Person"}], [stays, gone])

    assert [item["existing_id"] for item in preview["not_in_divera"]] == [str(gone.id)]
    assert preview["not_in_divera"][0]["member"]["divera_id"] == 0


def test_preview_pairs_two_namesakes_with_two_different_people():
    """A station with two "Meier Hans" must end with both matched, not with one matched twice
    and the other proposed for deletion."""
    first = _person("Meier Hans")
    second = _person("Meier Hans")

    preview = build_sync_preview(
        [{"divera_id": 1, "name": "Meier Hans"}, {"divera_id": 2, "name": "Meier Hans"}],
        [first, second],
    )

    matched = {item["existing_id"] for item in preview["unchanged"]}
    assert matched == {str(first.id), str(second.id)}
    assert preview["not_in_divera"] == []


def test_a_surplus_namesake_is_folded_onto_an_already_matched_person():
    """Three "Meier Hans" in Divera, two on the board: the third has nowhere to go and is
    reported as unchanged against the first rather than as new. Deliberate — inventing a third
    magnet out of an unresolvable name collision would be worse. The cost, worth knowing before
    debugging it in the field, is that `execute_sync` then writes the surplus member's Divera id
    onto that first person (last write wins), so one of the two namesakes ends up addressable
    under the wrong id."""
    first = _person("Meier Hans")
    second = _person("Meier Hans")

    preview = build_sync_preview(
        [{"divera_id": i, "name": "Meier Hans"} for i in (1, 2, 3)],
        [first, second],
    )

    assert preview["new"] == []
    assert len(preview["unchanged"]) == 3
    assert [item["existing_id"] for item in preview["unchanged"]].count(str(first.id)) == 2


def test_preview_flags_whether_a_match_is_already_linked():
    """`divera_linked` is what tells the operator (and execute_sync) that a person is still
    missing the id that makes them addressable for an outbound alarm."""
    linked = _person("Verknuepft Person", divera_user_id=4242)
    unlinked = _person("Offen Person")

    preview = build_sync_preview(
        [{"divera_id": 4242, "name": "Verknuepft Person"}, {"divera_id": 99, "name": "Offen Person"}],
        [linked, unlinked],
    )

    flags = {item["existing_id"]: item["divera_linked"] for item in preview["unchanged"]}
    assert flags == {str(linked.id): True, str(unlinked.id): False}


def test_preview_treats_a_renamed_person_as_a_departure_and_an_arrival():
    """Documents a real limitation: matching is by name only, so a marriage or a corrected
    spelling in Divera reads as "one person left, one arrived" — the Divera id already stored
    on the person is never consulted. Running the sync with `remove_stale` then deletes the
    old row and creates a new one, losing its history."""
    person = _person("Alt Name", divera_user_id=555)

    preview = build_sync_preview([{"divera_id": 555, "name": "Neu Name"}], [person])

    assert preview["new"][0]["member"]["name"] == "Neu Name"
    assert preview["not_in_divera"][0]["existing_id"] == str(person.id)
    assert preview["unchanged"] == []


# ============================================
# execute_sync — the write side
# ============================================


@pytest.fixture
def mock_request():
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


@pytest_asyncio.fixture
async def intake_user(db_session: AsyncSession) -> User:
    user = User(id=uuid4(), username="intake_editor", password_hash="", role="editor")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _names_in_db(db: AsyncSession) -> set[str]:
    return set((await db.execute(select(Personnel.name))).scalars().all())


async def test_stale_personnel_survive_unless_removal_was_asked_for(
    db_session: AsyncSession, intake_user: User, mock_request
):
    """The default is additive. Divera dropping someone (or answering with a short list) must
    not silently empty the board."""
    person = _person("Verschwunden Person")
    db_session.add(person)
    await db_session.commit()

    preview = {
        "new": [],
        "unchanged": [],
        "not_in_divera": [{"member": {"divera_id": 0, "name": person.name}, "existing_id": str(person.id)}],
    }
    result = await execute_sync(db_session, preview, remove_stale=False, current_user=intake_user, request=mock_request)

    assert result["deleted"] == 0
    assert "Verschwunden Person" in await _names_in_db(db_session)


async def test_removal_deletes_exactly_the_people_divera_dropped(
    db_session: AsyncSession, intake_user: User, mock_request
):
    gone = _person("Weg Person")
    stays = _person("Bleibt Person")
    db_session.add_all([gone, stays])
    await db_session.commit()

    preview = {
        "new": [],
        "unchanged": [{"member": {"divera_id": 1, "name": "Bleibt Person"}, "existing_id": str(stays.id)}],
        "not_in_divera": [{"member": {"divera_id": 0, "name": "Weg Person"}, "existing_id": str(gone.id)}],
    }
    result = await execute_sync(db_session, preview, remove_stale=True, current_user=intake_user, request=mock_request)

    assert result == {"created": 0, "deleted": 1, "linked": 1, "unchanged": 1}
    names = await _names_in_db(db_session)
    assert "Weg Person" not in names
    assert "Bleibt Person" in names


async def test_a_member_without_a_divera_id_is_created_but_not_linked(
    db_session: AsyncSession, intake_user: User, mock_request
):
    """`divera_id` 0 is what the preview puts on entries it could not identify. The person is
    still worth creating, but writing an identity row for id 0 would make them a target for
    outbound alarms addressed to nobody."""
    preview = {
        "new": [{"member": {"divera_id": 0, "name": "Ohne Id"}, "status": "new"}],
        "unchanged": [],
        "not_in_divera": [],
    }
    result = await execute_sync(db_session, preview, remove_stale=False, current_user=intake_user, request=mock_request)

    assert result["created"] == 1
    assert result["linked"] == 0
    person = (await db_session.execute(select(Personnel).where(Personnel.name == "Ohne Id"))).scalar_one()
    assert person.divera_user_id is None
    identities = (
        (
            await db_session.execute(
                select(PersonnelExternalIdentity).where(PersonnelExternalIdentity.personnel_id == person.id)
            )
        )
        .scalars()
        .all()
    )
    assert identities == []


async def test_an_already_linked_match_is_not_relinked(db_session: AsyncSession, intake_user: User, mock_request):
    """Nothing to write means nothing is counted — an unchanged sync must report linked 0, so
    the operator can tell a no-op run from one that changed the Mannschaft."""
    person = _person("Schon Verknuepft", divera_user_id=606)
    db_session.add(person)
    await db_session.commit()

    preview = {
        "new": [],
        "unchanged": [
            {"member": {"divera_id": 606, "name": person.name}, "existing_id": str(person.id), "divera_linked": True}
        ],
        "not_in_divera": [],
    }
    result = await execute_sync(db_session, preview, remove_stale=False, current_user=intake_user, request=mock_request)

    assert result["linked"] == 0
    assert result["unchanged"] == 1


async def test_an_unidentifiable_match_is_counted_but_left_alone(
    db_session: AsyncSession, intake_user: User, mock_request
):
    """A match whose member carries no usable Divera id is still an unchanged person — it is
    counted, but nothing is written to it. Skipping the write is what keeps id 0 out of the
    identity table."""
    person = _person("Ohne Divera Id")
    db_session.add(person)
    await db_session.commit()

    preview = {
        "new": [],
        "unchanged": [
            {"member": {"divera_id": 0, "name": person.name}, "existing_id": str(person.id), "divera_linked": False}
        ],
        "not_in_divera": [],
    }
    result = await execute_sync(db_session, preview, remove_stale=False, current_user=intake_user, request=mock_request)

    assert result == {"created": 0, "deleted": 0, "linked": 0, "unchanged": 1}
    await db_session.refresh(person)
    assert person.divera_user_id is None


# ============================================
# DiveraPoller — configuration
# ============================================


def _alarm_payload(*items: dict[str, Any], success: bool = True) -> dict[str, Any]:
    """An `/alarms` answer in Divera's id-keyed map shape."""
    return {"success": success, "data": {"items": {str(item.get("id", i)): item for i, item in enumerate(items)}}}


def _poller_with(handler: Callable[[httpx.Request], httpx.Response]) -> DiveraPoller:
    """A poller wired straight to a stub transport, without the background loop.

    `_fetch_and_process_alarms` is the whole risk surface; driving it directly keeps the
    upstream-answer tests free of timing."""
    poller = DiveraPoller()
    poller._http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=30.0)
    return poller


class _Sink:
    """Stands in for the app's alarm sink: records what the poller handed over."""

    def __init__(self, *, is_new: bool = True) -> None:
        self.received: list[schemas.DiveraWebhookPayload] = []
        self._is_new = is_new
        self.called = asyncio.Event()

    async def __call__(self, payload: schemas.DiveraWebhookPayload) -> bool:
        self.received.append(payload)
        self.called.set()
        return self._is_new


async def _wait_until(predicate: Callable[[], bool], deadline_seconds: float = 2.0) -> None:
    async with asyncio.timeout(deadline_seconds):
        while not predicate():
            await asyncio.sleep(0.01)


async def test_a_station_without_a_key_never_starts_polling(monkeypatch):
    """No credential is a normal state (most stations run webhook-only), so it is a quiet
    no-op — not an error, and not a task that fails on every interval."""
    monkeypatch.setattr(settings, "divera_access_key", "")
    poller = DiveraPoller()
    sink = _Sink()

    await poller.start_polling(sink)

    assert poller.is_configured is False
    assert poller.is_polling is False
    assert poller.stats == {
        "configured": False,
        "polling": False,
        "last_poll": None,
        "poll_count": 0,
        "error_count": 0,
    }


async def test_stopping_a_poller_that_never_started_is_harmless():
    await DiveraPoller().stop_polling()


async def test_a_poller_without_a_client_does_not_call_the_sink():
    """`_fetch_and_process_alarms` can be reached after `stop_polling` closed the client."""
    poller = DiveraPoller()
    sink = _Sink()

    await poller._fetch_and_process_alarms(sink)

    assert sink.received == []


# ============================================
# DiveraPoller — bad upstream answers
# ============================================


async def test_a_server_error_is_logged_with_its_status_and_re_raised(caplog):
    """The loop counts the error and keeps polling; the status code has to be in the log,
    because a 403 (key revoked) and a 502 (Divera down) call for different reactions."""
    poller = _poller_with(_json_handler({}, status=503))
    sink = _Sink()

    with caplog.at_level(logging.ERROR, logger="app.services.divera_poller"), pytest.raises(httpx.HTTPStatusError):
        await poller._fetch_and_process_alarms(sink)

    assert "503" in caplog.text
    assert sink.received == []


async def test_a_timeout_is_logged_as_a_request_failure(caplog):
    """A hanging Divera is the common failure — it must not be swallowed as "no alarms"."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    poller = _poller_with(handler)
    sink = _Sink()

    with caplog.at_level(logging.ERROR, logger="app.services.divera_poller"), pytest.raises(httpx.RequestError):
        await poller._fetch_and_process_alarms(sink)

    assert "request failed" in caplog.text
    assert sink.received == []


async def test_a_rejected_key_produces_a_warning_and_no_alarms(caplog):
    """Divera answers a rejected accesskey with 200 + `success: false`."""
    poller = _poller_with(_json_handler({"success": False, "message": "invalid accesskey"}))
    sink = _Sink()

    with caplog.at_level(logging.WARNING, logger="app.services.divera_poller"):
        await poller._fetch_and_process_alarms(sink)

    assert "success=false" in caplog.text
    assert sink.received == []


async def test_an_empty_payload_is_a_normal_quiet_poll(caplog):
    """No alarms is the state 99 % of polls are in — nothing logged, nothing handed on."""
    poller = _poller_with(_json_handler({"success": True, "data": {"items": {}}}))
    sink = _Sink()

    with caplog.at_level(logging.WARNING, logger="app.services.divera_poller"):
        await poller._fetch_and_process_alarms(sink)

    assert sink.received == []
    assert caplog.text == ""


async def test_a_payload_of_alarms_already_seen_reports_nothing_new(caplog):
    """The poller is a webhook fallback, so the usual answer repeats alarms the board already
    has. The sink returning False must stay silent — an "n new alarm(s)" line per interval
    would bury the one poll that actually found something."""
    poller = _poller_with(_json_handler(_alarm_payload({"id": 1, "title": "Brand"}, {"id": 2, "title": "BMA"})))
    sink = _Sink(is_new=False)

    with caplog.at_level(logging.INFO, logger="app.services.divera_poller"):
        await poller._fetch_and_process_alarms(sink)

    assert [a.id for a in sink.received] == [1, 2]
    assert "new alarm" not in caplog.text


async def test_new_alarms_are_reported_once_per_poll(caplog):
    poller = _poller_with(_json_handler(_alarm_payload({"id": 1, "title": "Brand"}, {"id": 2, "title": "BMA"})))
    sink = _Sink(is_new=True)

    with caplog.at_level(logging.INFO, logger="app.services.divera_poller"):
        await poller._fetch_and_process_alarms(sink)

    assert "found 2 new alarm(s)" in caplog.text


# ============================================
# DiveraPoller — parsing
# ============================================


async def test_closed_and_archived_alarms_never_reach_the_board():
    """Polling asks for recent alarms, which includes ones the Einsatzleiter already closed
    in Divera. Re-importing those would reopen them on the board."""
    poller = _poller_with(
        _json_handler(
            _alarm_payload(
                {"id": 1, "title": "Abgeschlossen", "closed": True},
                {"id": 2, "title": "Archiviert", "archived": True},
                {"id": 3, "title": "Laufend"},
            )
        )
    )
    sink = _Sink()

    await poller._fetch_and_process_alarms(sink)

    assert [a.id for a in sink.received] == [3]


async def test_alarms_arrive_newest_first_and_capped_at_the_configured_maximum(monkeypatch):
    """The cap is what keeps a first poll after a long outage from replaying a whole shift, so
    the sort has to run before the cap — otherwise the cap keeps the oldest alarms."""
    monkeypatch.setattr(settings, "divera_poll_max_alarms", 2)
    poller = _poller_with(
        _json_handler(
            _alarm_payload(
                {"id": 1, "title": "Alt", "ts_create": 100},
                {"id": 2, "title": "Neu", "ts_create": 300},
                {"id": 3, "title": "Mittel", "ts_create": 200},
            )
        )
    )
    sink = _Sink()

    await poller._fetch_and_process_alarms(sink)

    assert [a.id for a in sink.received] == [2, 3]


async def test_alarm_fields_are_mapped_from_both_divera_spellings():
    """`foreign_id`/`number` and `ts_create`/`date` are the same field under two names,
    depending on how the alarm was raised in Divera."""
    poller = _poller_with(
        _json_handler(
            _alarm_payload(
                {
                    "id": 7,
                    "foreign_id": "E-2026-7",
                    "title": "Zimmerbrand",
                    "text": "1. OG",
                    "address": "Hauptstrasse 1, Oberwil",
                    "lat": 47.5,
                    "lng": 7.55,
                    "group": ["Zug 1"],
                    "vehicle": ["TLF"],
                    "date": 1700000000,
                }
            )
        )
    )
    sink = _Sink()

    await poller._fetch_and_process_alarms(sink)

    alarm = sink.received[0]
    assert (alarm.id, alarm.number, alarm.title) == (7, "E-2026-7", "Zimmerbrand")
    assert (alarm.address, alarm.lat, alarm.lng) == ("Hauptstrasse 1, Oberwil", 47.5, 7.55)
    assert (alarm.group, alarm.vehicle) == (["Zug 1"], ["TLF"])
    assert alarm.ts_create == 1700000000


async def test_one_unparseable_alarm_does_not_drop_the_rest_of_the_batch(caplog):
    """Divera adding or breaking a field must cost one alarm, not the whole poll."""
    poller = _poller_with(
        _json_handler(
            _alarm_payload(
                {"id": "keine-zahl", "title": "Kaputt"},
                {"id": 2, "title": "Heil"},
            )
        )
    )
    sink = _Sink()

    with caplog.at_level(logging.WARNING, logger="app.services.divera_poller"):
        await poller._fetch_and_process_alarms(sink)

    assert [a.id for a in sink.received] == [2]
    assert "Failed to parse alarm" in caplog.text


async def test_a_sink_that_raises_does_not_abort_the_batch(caplog):
    """One alarm that fails to become an Einsatz (bad address, DB hiccup) must not hide the
    alarms behind it in the same poll."""
    poller = _poller_with(_json_handler(_alarm_payload({"id": 1, "title": "Erste"}, {"id": 2, "title": "Zweite"})))
    seen: list[int] = []

    async def sink(payload: schemas.DiveraWebhookPayload) -> bool:
        if payload.id == 1:
            raise RuntimeError("kaputt")
        seen.append(payload.id)
        return True

    with caplog.at_level(logging.ERROR, logger="app.services.divera_poller"):
        await poller._fetch_and_process_alarms(sink)

    assert seen == [2]
    assert "Error processing polled alarm 1" in caplog.text


# ============================================
# DiveraPoller — the background loop
# ============================================


async def test_the_loop_polls_counts_and_stops(monkeypatch, divera_key):
    """The lifecycle the websocket manager drives: first board connects → start, last one
    leaves → stop. A long interval keeps this to exactly one round."""
    monkeypatch.setattr(settings, "divera_poll_interval_seconds", 60)
    monkeypatch.setattr(
        httpx, "AsyncClient", _stub_client_class(_json_handler(_alarm_payload({"id": 1, "title": "Brand"})))
    )
    poller = DiveraPoller()
    sink = _Sink()

    await poller.start_polling(sink)
    assert poller.is_polling is True

    await asyncio.wait_for(sink.called.wait(), timeout=2.0)
    await _wait_until(lambda: poller._poll_count == 1)

    stats = poller.stats
    assert stats["configured"] is True
    assert stats["poll_count"] == 1
    assert stats["error_count"] == 0
    assert stats["last_poll"] is not None

    await poller.stop_polling()
    assert poller.is_polling is False
    assert poller._http_client is None


async def test_a_second_start_does_not_open_a_second_loop(monkeypatch, divera_key):
    """Every websocket connect passes through here; without the guard a busy evening would
    stack one polling task per board."""
    monkeypatch.setattr(settings, "divera_poll_interval_seconds", 60)
    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(_json_handler(_alarm_payload())))
    poller = DiveraPoller()

    await poller.start_polling(_Sink())
    first_task = poller._polling_task
    await poller.start_polling(_Sink())

    assert poller._polling_task is first_task

    await poller.stop_polling()


async def test_a_failing_poll_is_counted_and_the_loop_keeps_running(monkeypatch, divera_key):
    """Divera being unreachable must not end polling — the next alarm may be the one that
    matters, and nobody restarts a dead task at 3am."""
    monkeypatch.setattr(settings, "divera_poll_interval_seconds", 60)
    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(_json_handler({}, status=500)))
    poller = DiveraPoller()

    await poller.start_polling(_Sink())
    await _wait_until(lambda: poller._error_count == 1)

    assert poller.is_polling is True
    assert poller.stats["poll_count"] == 0  # a failed round is not counted as a poll
    assert poller.stats["last_poll"] is None

    await poller.stop_polling()


async def test_stopping_mid_request_is_a_shutdown_not_an_error(monkeypatch, divera_key):
    """The last board disconnecting cancels the task while a request may be in flight. The
    cancellation has to leave the loop, not be counted as a Divera failure — otherwise the
    error count in `/api/divera/status` climbs by one on every quiet evening and stops meaning
    anything."""
    monkeypatch.setattr(settings, "divera_poll_interval_seconds", 60)
    in_flight = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        in_flight.set()
        await asyncio.Event().wait()  # never answers; the cancel lands here
        raise AssertionError("unreachable")

    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(handler))
    poller = DiveraPoller()

    await poller.start_polling(_Sink())
    await asyncio.wait_for(in_flight.wait(), timeout=2.0)
    await poller.stop_polling()

    assert poller.is_polling is False
    assert poller.stats["error_count"] == 0
    assert poller.stats["poll_count"] == 0
