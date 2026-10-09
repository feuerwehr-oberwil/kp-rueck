"""Reaktionszeiten — the computation shared by the PDF table and the Kennzahlen view."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.services.reaction_times import event_figures, p90, stage_times

T0 = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)


def _inc(status: str = "incoming", priority: str = "medium", created: datetime | None = T0, title: str = "Keller"):
    return SimpleNamespace(id=uuid4(), status=status, priority=priority, title=title, created_at=created)


def _t(inc, to_status: str, minutes: float, from_status: str | None = None):
    return SimpleNamespace(
        incident_id=inc.id, from_status=from_status, to_status=to_status, timestamp=T0 + timedelta(minutes=minutes)
    )


class TestStageTimes:
    def test_no_transitions_reaches_nothing(self):
        inc = _inc()
        times = stage_times([inc], [])[inc.id]
        assert (times.reko, times.dispatched, times.on_scene, times.closed) == (None, None, None, None)

    def test_plain_walk_through_the_columns(self):
        inc = _inc(status="complete")
        times = stage_times(
            [inc],
            [_t(inc, "reko", 2), _t(inc, "enroute", 5), _t(inc, "active", 12), _t(inc, "complete", 80)],
        )[inc.id]
        assert times.reko == 120
        assert times.dispatched == 300
        assert times.on_scene == 720
        assert times.closed == 80 * 60

    def test_skipped_column_still_counts_as_dispatched(self):
        # Dragged straight from Eingegangen to «Im Einsatz»: dispatched and on scene at once.
        inc = _inc(status="active")
        times = stage_times([inc], [_t(inc, "active", 7)])[inc.id]
        assert times.dispatched == 420
        assert times.on_scene == 420

    def test_closed_without_going_out_has_no_reaction_time(self):
        inc = _inc(status="complete")
        times = stage_times([inc], [_t(inc, "complete", 3)])[inc.id]
        assert times.dispatched is None
        assert times.on_scene is None
        assert times.closed == 180

    def test_reentry_keeps_the_first_reach(self):
        inc = _inc(status="active")
        times = stage_times(
            [inc],
            # unordered on purpose: the store hands them back in any order
            [_t(inc, "active", 85), _t(inc, "returning", 60), _t(inc, "active", 25)],
        )[inc.id]
        assert times.on_scene == 25 * 60

    def test_reopened_and_still_open_is_not_closed(self):
        inc = _inc(status="active")
        times = stage_times([inc], [_t(inc, "active", 10), _t(inc, "complete", 40), _t(inc, "active", 50)])[inc.id]
        assert times.closed is None
        assert times.on_scene == 600

    def test_reopened_and_closed_again_counts_the_last_closing(self):
        inc = _inc(status="complete")
        times = stage_times(
            [inc],
            [_t(inc, "active", 10), _t(inc, "complete", 40), _t(inc, "active", 50), _t(inc, "complete", 90)],
        )[inc.id]
        assert times.closed == 90 * 60

    def test_created_enroute_without_records_is_dispatched_at_eingang(self):
        # /feld «Wir übernehmen»: born `enroute`, no transition row for it.
        inc = _inc(status="enroute")
        times = stage_times([inc], [])[inc.id]
        assert times.dispatched == 0
        assert times.on_scene is None

    def test_created_enroute_then_arrived(self):
        inc = _inc(status="active")
        times = stage_times([inc], [_t(inc, "active", 25, from_status="enroute")])[inc.id]
        # Disponiert at Eingang, not at the crew's arrival 25 minutes later.
        assert times.dispatched == 0
        assert times.on_scene == 25 * 60

    def test_plain_incoming_without_records_reaches_nothing(self):
        inc = _inc(status="incoming")
        times = stage_times([inc], [])[inc.id]
        assert (times.reko, times.dispatched, times.on_scene) == (None, None, None)

    def test_misdrag_put_right_within_two_minutes_is_not_a_dispatch(self):
        inc = _inc(status="enroute")
        times = stage_times(
            [inc],
            [
                _t(inc, "enroute", 1, from_status="incoming"),
                _t(inc, "incoming", 1.5, from_status="enroute"),
                _t(inc, "enroute", 20, from_status="incoming"),
            ],
        )[inc.id]
        assert times.dispatched == 20 * 60

    def test_moving_back_after_two_minutes_keeps_the_dispatch(self):
        inc = _inc(status="enroute")
        times = stage_times(
            [inc],
            [
                _t(inc, "enroute", 5, from_status="incoming"),
                _t(inc, "incoming", 9, from_status="enroute"),
                _t(inc, "enroute", 30, from_status="incoming"),
            ],
        )[inc.id]
        assert times.dispatched == 5 * 60

    def test_moving_on_quickly_is_progress_not_a_correction(self):
        inc = _inc(status="active")
        times = stage_times(
            [inc], [_t(inc, "enroute", 5, from_status="incoming"), _t(inc, "active", 5.5, from_status="enroute")]
        )[inc.id]
        assert times.dispatched == 5 * 60
        assert times.on_scene == 5.5 * 60

    def test_transition_before_creation_clamps_to_zero(self):
        inc = _inc(status="enroute")
        times = stage_times([inc], [_t(inc, "enroute", -3)])[inc.id]
        assert times.dispatched == 0

    def test_naive_timestamps_are_read_as_utc(self):
        inc = _inc(status="enroute", created=datetime(2026, 6, 1, 9, 0))
        times = stage_times([inc], [_t(inc, "enroute", 4)])[inc.id]
        assert times.dispatched == 240

    def test_incident_without_created_at(self):
        inc = _inc(created=None)
        assert stage_times([inc], [_t(inc, "enroute", 4)])[inc.id].dispatched is None


class TestPercentiles:
    def test_p90_is_nearest_rank(self):
        assert p90([]) is None
        assert p90([5]) == 5
        assert p90([1, 2]) == 2
        assert p90(list(range(1, 11))) == 9
        assert p90(list(range(1, 21))) == 18


class TestEventFigures:
    def test_empty_event(self):
        figures = event_figures([], [])
        assert (figures.total, figures.waiting, figures.in_progress, figures.done) == (0, 0, 0, 0)
        assert [p.priority for p in figures.by_priority] == ["high", "medium", "low"]
        assert figures.overall.dispatched.count == 0
        assert figures.overall.dispatched.median_seconds is None
        assert figures.oldest_waiting_high is None

    def test_counts_medians_and_oldest_waiting_high(self):
        h1 = _inc(status="complete", priority="high")
        h2 = _inc(status="active", priority="high")
        h_wait_old = _inc(status="incoming", priority="high", created=T0 - timedelta(minutes=30), title="Alt")
        h_wait_new = _inc(status="reko", priority="high", created=T0 - timedelta(minutes=5), title="Neu")
        m1 = _inc(status="enroute", priority="medium")
        legacy = _inc(status="incoming", priority="")  # unknown priority reads as low
        transitions = [
            _t(h1, "enroute", 2),
            _t(h1, "active", 10),
            _t(h1, "complete", 60),
            _t(h2, "enroute", 6),
            _t(h2, "active", 20),
            _t(m1, "enroute", 15),
        ]
        figures = event_figures([h1, h2, h_wait_old, h_wait_new, m1, legacy], transitions)

        assert (figures.total, figures.waiting, figures.in_progress, figures.done) == (6, 3, 2, 1)
        high, medium, low = figures.by_priority
        assert (high.total, high.waiting, high.in_progress, high.done) == (4, 2, 1, 1)
        assert high.dispatched.count == 2
        assert high.dispatched.median_seconds == 4 * 60
        assert high.dispatched.p90_seconds == 6 * 60
        assert high.on_scene.median_seconds == 15 * 60
        assert high.closed.count == 1
        assert medium.dispatched.median_seconds == 15 * 60
        assert low.total == 1
        assert low.waiting == 1
        assert figures.overall.dispatched.count == 3

        assert figures.oldest_waiting_high is not None
        assert figures.oldest_waiting_high.incident_id == h_wait_old.id
        assert figures.oldest_waiting_high.title == "Alt"
