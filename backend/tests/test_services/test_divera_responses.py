"""Divera Rückmeldungen as yes/no: parsing, classification, merge – on the shared X1 fixtures.

The two JSON files beside this test are the fixtures KP Front's half uses too (same structure
as Divera's real `/alarms` and `/pull/all`). Fixture alarm 4711: 101, 102 «Komme», 103 and
999 (not on the roster) «Komme in 10 min», 104, 105 «Komme nicht», 106 «Rückruf erbeten».
No network: the catalogue fetch and the poller run on httpx.MockTransport.
"""

import copy
import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest

from app.config import settings
from app.services import divera_responses as dr
from app.services.divera_poller import DiveraPoller

HERE = Path(__file__).parent
ALARMS: dict[str, Any] = json.loads((HERE / "divera_alarms_responses.json").read_text(encoding="utf-8"))
PULL_ALL: dict[str, Any] = json.loads((HERE / "divera_pull_all.json").read_text(encoding="utf-8"))
CATALOGUE = dr.parse_status_catalogue(PULL_ALL["data"]["cluster"])
ALARM_4711 = ALARMS["data"]["items"]["4711"]
ALARM_4712 = ALARMS["data"]["items"]["4712"]

PIDS: dict[int, UUID] = {u: uuid4() for u in range(101, 107)}  # 999 is not on the roster
ROSTER = {pid: dr.RosterPerson(personnel_id=pid, name=f"Person {u}", role=None, tags=[]) for u, pid in PIDS.items()}
BY_PID = {pid: u for u, pid in PIDS.items()}


def _stored(item: dict[str, Any], overrides: dr.Overrides = dr.NO_OVERRIDES, catalogue=CATALOGUE) -> dict[str, Any]:
    parsed = dr.parse_alarm(item, catalogue)
    assert parsed is not None
    return dr.classify_alarm(parsed, overrides, PIDS)


def _summary(*snapshots: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    rows = [(s, dr.alarm_time(s, None), None) for s in snapshots]
    return dr.summarize(rows, ROSTER, **kwargs)


def _kinds(summary: dict[str, Any]) -> dict[int, str]:
    return {BY_PID[p["personnel_id"]]: p["kind"] for p in summary["people"]}


# --- parsing --------------------------------------------------------------------------------


def test_alarm_items_accepts_dict_and_list():
    as_dict = dr.alarm_items(ALARMS)
    as_list = dr.alarm_items({"success": True, "data": {"items": list(ALARMS["data"]["items"].values())}})
    assert [i["id"] for i in as_dict] == [4711, 4712]
    assert [i["id"] for i in as_list] == [4711, 4712]
    assert dr.alarm_items({"success": False, "data": {"items": {}}}) == []
    assert dr.alarm_items({"success": True, "data": {"items": "nonsense"}}) == []


def test_parse_keeps_the_latest_status_per_person_and_drops_time_and_note():
    parsed = dr.parse_alarm(ALARM_4711, CATALOGUE)
    assert parsed["alarm_ts"] == 1791478800
    assert parsed["answers"] == {101: 11, 102: 11, 103: 12, 999: 12, 104: 13, 105: 13, 106: 17}
    assert set(parsed["statuses"]) == {"11", "12", "13", "17"}


def test_the_stored_form_is_yes_no_only():
    stored = _stored(ALARM_4711)
    assert stored == {
        "v": dr.SNAPSHOT_VERSION,
        "alarm_ts": 1791478800,
        "people": dict(
            sorted(
                {
                    str(PIDS[101]): "coming",
                    str(PIDS[102]): "coming",
                    str(PIDS[103]): "coming",
                    str(PIDS[104]): "not_coming",
                    str(PIDS[105]): "not_coming",
                }.items()
            )
        ),
        "unmapped": {"coming": 1, "not_coming": 0},  # 999
    }
    # Nothing else: no Divera ids, status ids, names, answer times, notes, read receipts.
    text = json.dumps(stored)
    for absent in ("ucr", "status", '"ts"', "note", "read", "addressed", "Ferien", "Magazin", "1791478860"):
        assert absent not in text


def test_empty_answer_list_is_no_answers_and_never_crashes():
    stored = _stored(ALARM_4712)
    assert stored["people"] == {}
    assert stored["unmapped"] == {"coming": 0, "not_coming": 0}
    assert dr.answered_status_ids(ALARM_4712) == set()
    summary = _summary(stored)
    assert summary["counts"] == {"coming": 0, "not_coming": 0}
    assert summary["people"] == []


def test_an_alarm_without_an_answer_field_says_nothing():
    assert dr.parse_alarm({"id": 1, "title": "x", "ucr_addressed": [1]}) is None


# --- the spec's expected numbers, reduced to yes/no ---------------------------------------


def test_default_classification_matches_the_spec():
    summary = _summary(_stored(ALARM_4711))
    assert _kinds(summary) == {101: "coming", 102: "coming", 103: "coming", 104: "not_coming", 105: "not_coming"}
    # 999 counts (not on the roster), 106 «Rückruf erbeten» is neither and is not counted at all.
    assert summary["counts"] == {"coming": 4, "not_coming": 2}
    assert summary["unmapped"] == 1


def test_people_carry_nothing_but_who_and_yes_no():
    person = _summary(_stored(ALARM_4711))["people"][0]
    assert set(person) == {"personnel_id", "name", "role", "tags", "kind", "attended"}


def test_coming_first_then_by_name():
    order = [BY_PID[p["personnel_id"]] for p in _summary(_stored(ALARM_4711))["people"]]
    assert order == [101, 102, 103, 104, 105]


def test_anybody_with_an_attendance_record_is_flagged():
    summary = _summary(_stored(ALARM_4711), attended={PIDS[101]})
    flags = {BY_PID[p["personnel_id"]]: p["attended"] for p in summary["people"]}
    assert flags[101] is True
    assert flags[102] is False


def test_somebody_removed_from_the_roster_is_counted_not_named():
    roster = {pid: p for pid, p in ROSTER.items() if pid != PIDS[101]}
    summary = dr.summarize([(_stored(ALARM_4711), None, None)], roster)
    assert summary["counts"]["coming"] == 4
    assert PIDS[101] not in {p["personnel_id"] for p in summary["people"]}


@pytest.mark.parametrize("ts", [10**14, 2**62])
def test_a_nonsense_alarm_time_does_not_take_the_summary_down(ts):
    item = {"date": ts, "ucr_answered": {"12": {"101": {"ts": ts, "note": ""}}}}
    stored = _stored(item)
    assert dr.alarm_time(stored, None) is None
    assert _kinds(_summary(stored)) == {101: "coming"}


# --- classification -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "minutes", "kind"),
    [
        ("Komme", 0, "coming"),
        ("Komme in 10 min", 10, "coming"),
        ("Komme nicht", 0, "not_coming"),
        ("Nicht einsatzbereit", 0, "not_coming"),
        ("Einsatzbereit", 0, "coming"),
        ("Verfügbar", 0, "coming"),
        ("Indisponible", 0, "not_coming"),
        ("Je viens", 0, "coming"),
        ("J’arrive", 0, "coming"),
        ("Ferien", 0, "not_coming"),
        ("Rückruf erbeten", 0, "other"),
        ("Später", 15, "coming"),  # oddly named, but a time means «coming»
        (None, 0, "other"),
    ],
)
def test_name_heuristic(name, minutes, kind):
    assert dr.classify(7, name, minutes) == kind


def test_override_by_name_then_by_id_and_id_wins():
    by_name = dr.parse_overrides(json.dumps({"rückruf ERBETEN": "coming"}))
    assert _kinds(_summary(_stored(ALARM_4711, by_name)))[106] == "coming"

    both = dr.parse_overrides(json.dumps({"Rückruf erbeten": "coming", "17": "not_coming"}))
    assert _kinds(_summary(_stored(ALARM_4711, both)))[106] == "not_coming"


def test_without_a_catalogue_only_id_overrides_classify():
    stored = _stored(ALARM_4711, dr.parse_overrides('{"13": "not_coming"}'), catalogue=None)
    assert _kinds(_summary(stored)) == {104: "not_coming", 105: "not_coming"}  # the rest is unknown → dropped


@pytest.mark.parametrize("raw", [None, "", "  ", "not json", "[1,2]", '{"13": "maybe"}', '{"13": 5}'])
def test_a_broken_override_means_none(raw):
    assert dr.parse_overrides(raw) == dr.NO_OVERRIDES


# --- merge ----------------------------------------------------------------------------------


def test_latest_answer_wins_within_one_alarm():
    item = copy.deepcopy(ALARM_4711)
    item["ucr_answered"]["13"]["101"] = {"ts": 1791479000, "note": "doch nicht"}  # later than «Komme»
    assert _kinds(_summary(_stored(item)))[101] == "not_coming"


def test_the_newer_alarm_wins_per_person_whatever_the_order():
    first = _stored(ALARM_4711)
    nachalarm = _stored(
        {
            "id": 4713,
            "date": 1791479400,  # ten minutes later
            "ucr_answered": {"11": {"104": {"ts": 5}}, "13": {"101": {"ts": 5}, "999": {"ts": 5}}},
        }
    )
    for order in ((first, nachalarm), (nachalarm, first)):
        summary = _summary(*order)
        kinds = _kinds(summary)
        assert kinds[104] == "coming"  # «komme nicht» on the first alarm, «komme» on the Nachalarm
        assert kinds[101] == "not_coming"
        assert summary["alarm_count"] == 2
        # Unmapped have no identity to merge on: per class the larger alarm's number.
        assert summary["unmapped"] == 2  # coming 1 (first alarm) + not_coming 1 (Nachalarm)


# --- catalogue cache: rare, never per request -----------------------------------------------


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_catalogue_is_fetched_once_and_only_when_answers_need_it(monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "unit-key")
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json=PULL_ALL)

    clock = [1000.0]
    monkeypatch.setattr(dr.time, "monotonic", lambda: clock[0])
    cache = dr.StatusCatalogueCache()
    async with _client(handler) as client:
        assert await cache.ensure(client, set()) is None  # no answers → no fetch
        assert calls == []
        first = await cache.ensure(client, {11})
        assert await cache.ensure(client, {11, 12}) is first  # known ids: no refetch
        clock[0] += 60
        await cache.ensure(client, {11, 99})  # unknown id, but inside the 15-min backoff
        assert len(calls) == 1
        clock[0] += dr.CATALOGUE_RETRY_SECONDS
        await cache.ensure(client, {11, 99})  # a status added in Divera: fetched again
        assert len(calls) == 2
        clock[0] += dr.CATALOGUE_RETRY_SECONDS
        await cache.ensure(client, {11})  # all known and fresh: nothing
        assert len(calls) == 2
    assert first["13"]["name"] == "Komme nicht"


async def test_the_catalogue_fetch_has_its_own_short_timeout(monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "unit-key")
    seen: list[Any] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.extensions.get("timeout"))
        return httpx.Response(200, json=PULL_ALL)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=30.0) as client:
        await dr.StatusCatalogueCache().ensure(client, {11})
    assert seen[0]["read"] == dr.CATALOGUE_TIMEOUT_SECONDS


async def test_catalogue_from_the_members_sync_is_reused(monkeypatch):
    cache = dr.StatusCatalogueCache()
    cache.remember(PULL_ALL["data"]["cluster"])

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("fetched although the members sync already had it")

    async with _client(handler) as client:
        assert (await cache.ensure(client, {11}))["11"]["name"] == "Komme"


async def test_a_failed_catalogue_fetch_is_not_retried_every_poll(monkeypatch, caplog):
    monkeypatch.setattr(settings, "divera_access_key", "unit-key-never-logged")
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(401, json={"success": False})

    cache = dr.StatusCatalogueCache()
    async with _client(handler) as client:
        assert await cache.ensure(client, {11}) is None
        assert await cache.ensure(client, {11}) is None
    assert calls == 1
    assert "unit-key-never-logged" not in caplog.text


# --- poller: same `/alarms` answer, no extra request ----------------------------------------


async def test_the_poller_hands_the_responses_of_the_same_answer_to_the_sink(monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "unit-key")
    monkeypatch.setattr(dr, "status_catalogue", dr.StatusCatalogueCache())
    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        if request.url.path.endswith("/alarms"):
            return httpx.Response(200, json=ALARMS)
        return httpx.Response(200, json=PULL_ALL)

    stored: dict[int, dict[str, Any]] = {}

    async def sink(snapshots):
        stored.update(snapshots)

    async def on_alarm(_payload) -> bool:
        return False

    poller = DiveraPoller()
    poller.responses_sink = sink
    poller._http_client = _client(handler)
    try:
        await poller._fetch_and_process_alarms(on_alarm)
        await poller._fetch_and_process_alarms(on_alarm)
    finally:
        await poller._http_client.aclose()

    assert set(stored) == {4711, 4712}  # closed alarms too: their answers still belong to the incident
    assert stored[4711]["statuses"]["13"]["name"] == "Komme nicht"
    # two polls → two /alarms, and the catalogue exactly once
    assert requests.count("/api/v2/alarms") == 2
    assert requests.count("/api/v2/pull/all") == 1
