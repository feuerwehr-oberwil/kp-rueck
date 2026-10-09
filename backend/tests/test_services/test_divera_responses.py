"""Divera Rückmeldungen: parsing, classification, ETA, merge – on the shared X1 fixtures.

The two JSON files beside this test are the fixtures KP Front's half uses too
(same structure as Divera's real `/alarms` and `/pull/all`); the expected numbers come from
the shared spec. No network: the catalogue fetch and the poller run on httpx.MockTransport.
"""

import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

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


def _roster(*ucr_ids: int) -> dict[int, dr.RosterPerson]:
    return {u: dr.RosterPerson(personnel_id=uuid4(), name=f"Person {u}", role=None, tags=[]) for u in ucr_ids}


ROSTER = _roster(101, 102, 103, 104, 105, 106)


def _summary(*snapshots: dict[str, Any] | None, overrides: dr.Overrides = dr.NO_OVERRIDES, roster=None):
    return dr.summarize(((s, None) for s in snapshots), overrides, ROSTER if roster is None else roster)


def _kinds(summary: dict[str, Any]) -> dict[int, str]:
    return {p["ucr_id"]: p["kind"] for p in summary["people"]}


# --- parsing --------------------------------------------------------------------------------


def test_alarm_items_accepts_dict_and_list():
    as_dict = dr.alarm_items(ALARMS)
    as_list = dr.alarm_items({"success": True, "data": {"items": list(ALARMS["data"]["items"].values())}})
    assert [i["id"] for i in as_dict] == [4711, 4712]
    assert [i["id"] for i in as_list] == [4711, 4712]
    assert dr.alarm_items({"success": False, "data": {"items": {}}}) == []
    assert dr.alarm_items({"success": True, "data": {"items": "nonsense"}}) == []


def test_catalogue_names_times_and_alarm_order():
    assert CATALOGUE["11"] == {"name": "Komme", "time": 0, "sorting": 0}
    assert CATALOGUE["12"]["time"] == 10
    assert CATALOGUE["17"]["sorting"] == 3  # 4th button offered on an alarm
    assert CATALOGUE["20"]["sorting"] >= 100  # not offered on an alarm: after those


def test_snapshot_of_the_fixture_alarm():
    snap = dr.snapshot_from_alarm(ALARM_4711, CATALOGUE)
    assert snap is not None
    assert snap["addressed"] == list(range(101, 111))
    assert snap["read_count"] == 8
    assert "read" not in snap  # who opened it is a per-person receipt: only the number is kept
    assert snap["alarm_ts"] == 1791478800
    assert snap["answers"]["103"] == {"status_id": 12, "ts": 1791478890, "note": "5 min"}
    assert snap["answers"]["999"]["status_id"] == 12
    assert set(snap["statuses"]) == {"11", "12", "13", "17"}  # only what is referenced


def test_empty_answer_list_is_no_answers_and_never_crashes():
    snap = dr.snapshot_from_alarm(ALARM_4712, CATALOGUE)
    assert snap is not None
    assert snap["answers"] == {}
    assert dr.answered_status_ids(ALARM_4712) == set()
    summary = _summary(snap)
    assert summary["answered"] == 0
    assert summary["people"] == []
    assert summary["addressed"] == 1
    assert summary["unanswered"] == 1


def test_divera_spec_spelling_ucr_adressed_is_accepted():
    item = {k: v for k, v in ALARM_4711.items() if k != "ucr_addressed"}
    item["ucr_adressed"] = [1, 2, 3]
    assert dr.snapshot_from_alarm(item)["addressed"] == [1, 2, 3]


def test_an_alarm_without_any_response_fields_says_nothing():
    assert dr.snapshot_from_alarm({"id": 1, "title": "x"}) is None


def test_note_is_trimmed_and_capped():
    item = {"ucr_answered": {"11": {"5": {"ts": 1, "note": "  " + "x" * 200 + "  "}}}}
    note = dr.snapshot_from_alarm(item)["answers"]["5"]["note"]
    assert note == "x" * 80


# --- the spec's expected numbers ------------------------------------------------------------


def test_default_classification_matches_the_spec():
    summary = _summary(dr.snapshot_from_alarm(ALARM_4711, CATALOGUE))
    assert _kinds(summary) == {
        101: "coming",
        102: "coming",
        103: "coming",
        104: "not_coming",
        105: "not_coming",
        106: "other",
    }
    assert summary["counts"] == {"coming": 4, "not_coming": 2, "other": 1}
    assert (summary["addressed"], summary["answered"], summary["unanswered"], summary["read"]) == (10, 7, 3, 8)
    assert [(s["status_id"], s["count"]) for s in summary["statuses"]] == [(11, 2), (12, 2), (13, 2), (17, 1)]


def test_eta_is_answer_time_plus_status_time_for_coming_only():
    summary = _summary(dr.snapshot_from_alarm(ALARM_4711, CATALOGUE))
    people = {p["ucr_id"]: p for p in summary["people"]}
    assert people[103]["eta"] == datetime.fromtimestamp(1791479490, tz=UTC)
    assert people[103]["answered_at"] == datetime.fromtimestamp(1791478890, tz=UTC)
    assert people[101]["eta"] is None  # «Komme» has time 0
    assert people[104]["eta"] is None


def test_unmapped_ucr_is_counted_never_listed():
    summary = _summary(dr.snapshot_from_alarm(ALARM_4711, CATALOGUE))
    people = {p["ucr_id"]: p for p in summary["people"]}
    assert summary["unmapped"] == 1
    assert summary["counts"]["coming"] == 4  # still counted …
    assert 999 not in people  # … but no Divera id, status or note of somebody not on the roster
    assert people[101]["personnel_id"] == ROSTER[101].personnel_id


def test_notes_can_be_left_out():
    snap = dr.snapshot_from_alarm(ALARM_4711, CATALOGUE)
    with_notes = {p["ucr_id"]: p for p in _summary(snap)["people"]}
    without = {
        p["ucr_id"]: p for p in dr.summarize([(snap, None)], dr.NO_OVERRIDES, ROSTER, include_notes=False)["people"]
    }
    assert with_notes[104]["note"] == "Ferien"
    assert without[104]["note"] is None
    assert without[104]["kind"] == "not_coming"


def test_anybody_with_an_attendance_record_is_flagged():
    snap = dr.snapshot_from_alarm(ALARM_4711, CATALOGUE)
    attended = {ROSTER[101].personnel_id}
    people = {
        p["ucr_id"]: p for p in dr.summarize([(snap, None)], dr.NO_OVERRIDES, ROSTER, attended=attended)["people"]
    }
    assert people[101]["attended"] is True
    assert people[102]["attended"] is False


@pytest.mark.parametrize("ts", [10**14, 2**62])
def test_a_nonsense_timestamp_does_not_take_the_summary_down(ts):
    item = {"ucr_addressed": [101], "ucr_answered": {"12": {"101": {"ts": ts, "note": ""}}}}
    summary = _summary(dr.snapshot_from_alarm(item, CATALOGUE))
    person = summary["people"][0]
    assert person["answered_at"] is None
    assert person["eta"] is None
    assert person["kind"] == "coming"


def test_read_count_falls_back_to_count_read():
    item = {"ucr_addressed": [1, 2], "ucr_answered": [], "count_read": 2}
    assert dr.snapshot_from_alarm(item)["read_count"] == 2


def test_coming_people_are_listed_first_and_by_arrival():
    summary = _summary(dr.snapshot_from_alarm(ALARM_4711, CATALOGUE))
    order = [p["ucr_id"] for p in summary["people"]]
    assert order[:3] == [101, 102, 103]  # «Komme» first, then by estimated arrival
    assert order[3] == 106  # other before not_coming
    assert order[4:] == [104, 105]


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
    snap = dr.snapshot_from_alarm(ALARM_4711, CATALOGUE)
    by_name = dr.parse_overrides(json.dumps({"rückruf ERBETEN": "coming"}))
    assert _kinds(_summary(snap, overrides=by_name))[106] == "coming"

    both = dr.parse_overrides(json.dumps({"Rückruf erbeten": "coming", "17": "not_coming"}))
    assert _kinds(_summary(snap, overrides=both))[106] == "not_coming"


def test_id_override_applies_without_a_catalogue():
    snap = dr.snapshot_from_alarm(ALARM_4711, None)
    summary = _summary(snap, overrides=dr.parse_overrides('{"13": "not_coming"}'))
    people = {p["ucr_id"]: p for p in summary["people"]}
    assert people[104]["kind"] == "not_coming"
    assert people[101]["kind"] == "other"  # unknown id, no name: other
    assert people[101]["status_name"] == "Status 11"


@pytest.mark.parametrize("raw", [None, "", "  ", "not json", "[1,2]", '{"13": "maybe"}', '{"13": 5}'])
def test_a_broken_override_means_none(raw):
    assert dr.parse_overrides(raw) == dr.NO_OVERRIDES


# --- merge ----------------------------------------------------------------------------------


def test_latest_answer_wins_within_one_alarm():
    item = copy.deepcopy(ALARM_4711)
    item["ucr_answered"]["13"]["101"] = {"ts": 1791479000, "note": "doch nicht"}  # later than «Komme»
    summary = _summary(dr.snapshot_from_alarm(item, CATALOGUE))
    people = {p["ucr_id"]: p for p in summary["people"]}
    assert people[101]["kind"] == "not_coming"
    assert people[101]["note"] == "doch nicht"
    assert summary["answered"] == 7  # still one person


def test_several_alarms_merge_latest_answer_per_person():
    first = dr.snapshot_from_alarm(ALARM_4711, CATALOGUE)
    nachalarm = dr.snapshot_from_alarm(
        {
            "id": 4713,
            "ucr_addressed": [104, 111],
            "ucr_answered": {"11": {"104": {"ts": 1791479500, "note": "jetzt doch"}}, "13": {"111": {"ts": 5}}},
            "ucr_read": [111],
        },
        CATALOGUE,
    )
    summary = dr.summarize(
        [(first, datetime(2026, 10, 8, 20, 0, tzinfo=UTC)), (nachalarm, datetime(2026, 10, 8, 20, 5, tzinfo=UTC))],
        dr.NO_OVERRIDES,
        ROSTER,
    )
    people = {p["ucr_id"]: p for p in summary["people"]}
    assert people[104]["kind"] == "coming"  # the Nachalarm answer is newer
    assert summary["alarm_count"] == 2
    assert summary["addressed"] == 11  # union
    assert summary["read"] == 8  # counts only: the larger of the two alarms' numbers
    assert summary["answered"] == 8
    assert summary["updated_at"] == datetime(2026, 10, 8, 20, 5, tzinfo=UTC)


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
