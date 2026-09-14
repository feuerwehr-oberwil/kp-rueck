"""Golden-file tests for the assignment slip.

The slip is the one artefact that leaves the building: a crew carries it to an address and
treats it as ground truth, and `docs/AUSFALL_SOP.md` falls back to it when nothing else
works. It had no test at all, and by 2026-07 it had drifted into printing the alarm time in
unlabelled UTC (one to two hours early), a person's name under a "Tel:" label, no incident
reference, and no exercise marker — while the board-snapshot formatter beside it had one.

Rendering a known payload and comparing the whole output is the cheapest way to keep a
document honest: any change to what the paper says has to be stated in the expected text.

Stdlib only, like the rest of the agent. `escpos` is an optional extra (see pyproject), so
it is stubbed here — these tests are about the characters, not the wire protocol.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))


class _FakePrinter:
    """Captures what would be sent to the printer, decoded back to text."""

    def __init__(self) -> None:
        self.chunks: list[str] = []
        self.cut_count = 0

    def set(self, **_kwargs) -> None:
        # Font/alignment don't change the characters, which is what these tests assert on.
        pass

    def _raw(self, data: bytes) -> None:
        self.chunks.append(data.decode("cp437", errors="replace"))

    def cut(self) -> None:
        self.cut_count += 1

    @property
    def text(self) -> str:
        return "".join(self.chunks)


@pytest.fixture(autouse=True)
def _stub_escpos():
    """`escpos` is an optional dependency; the formatter only needs its type at import."""
    if "escpos.printer" not in sys.modules:
        escpos = types.ModuleType("escpos")
        printer = types.ModuleType("escpos.printer")
        printer.Network = object
        escpos.printer = printer
        sys.modules.setdefault("escpos", escpos)
        sys.modules["escpos.printer"] = printer
    yield


def _render(payload: dict) -> str:
    import formatters

    p = _FakePrinter()
    formatters.format_assignment_slip(p, payload)
    return p.text


def _payload(**overrides) -> dict:
    base = {
        "incident_id": "3f2b1c8e-9a4d-4e11-8c77-51d0a9b6e2f4",
        "training_flag": False,
        "type": "brandbekaempfung",
        "priority": "high",
        "location": "Hauptstrasse 12, Oberwil",
        "description": "Rauch aus dem Dachstock",
        "contact": "Frau Meier",
        "contact_phone": "061 401 22 33",
        # Naive UTC, exactly what the backend serialises: `datetime.utcnow()` written into a
        # timezone=True column. 12:32 UTC is 14:32 in Zurich in July.
        "created_at": "2026-07-30T12:32:00",
        "crew": [{"name": "Müller Hans", "role": "Offizier"}],
        "vehicles": [{"name": "TLF", "radio_call_sign": "Omega 1"}],
        "materials": [{"name": "Tauchpumpe Gr."}],
    }
    base.update(overrides)
    return base


class TestTheAlarmTime:
    def test_is_converted_to_station_local_time(self):
        """The slip showed UTC. In Switzerland that is an alarm time 1–2 h in the past."""
        assert "Alarmiert: 30.07.2026 14:32" in _render(_payload())
        assert "12:32" not in _render(_payload())

    def test_says_which_clock_it_means(self):
        """An unlabelled time on paper is a time somebody has to guess about."""
        assert "Alarmiert: 30.07.2026 14:32 Ortszeit" in _render(_payload())

    def test_an_explicitly_utc_timestamp_lands_on_the_same_local_time(self):
        """Whether the backend emits `+00:00` or a naive string must not change the paper."""
        naive = _render(_payload(created_at="2026-07-30T12:32:00"))
        aware = _render(_payload(created_at="2026-07-30T12:32:00+00:00"))
        assert "Alarmiert: 30.07.2026 14:32" in naive
        assert "Alarmiert: 30.07.2026 14:32" in aware

    def test_an_unparseable_timestamp_omits_the_line_rather_than_inventing_one(self):
        out = _render(_payload(created_at="not a timestamp"))
        assert "Alarmiert:" not in out


class TestTheExerciseMarker:
    def test_a_training_slip_says_so_at_the_top(self):
        """A training slip and a real one were indistinguishable once torn off."""
        out = _render(_payload(training_flag=True))
        assert "UEBUNG - KEIN ECHTER EINSATZ" in out
        # Above the address, because that is the first thing read.
        assert out.index("UEBUNG") < out.index("Hauptstrasse 12")

    def test_and_repeats_it_at_the_end(self):
        """The top can be torn off; the marker has to survive that."""
        assert _render(_payload(training_flag=True)).count("UEBUNG - KEIN ECHTER EINSATZ") == 2

    def test_a_real_slip_carries_no_marker(self):
        assert "UEBUNG" not in _render(_payload())


class TestTheContact:
    def test_the_phone_number_is_printed_under_the_phone_label(self):
        out = _render(_payload())
        assert "Tel: 061 401 22 33" in out

    def test_the_reporter_is_named_as_a_person_not_as_a_number(self):
        """`contact` is a NAME; it used to be printed as `Tel: Frau Meier`."""
        out = _render(_payload())
        assert "Meldende(r): Frau Meier" in out
        assert "Tel: Frau Meier" not in out

    def test_a_missing_number_omits_only_that_line(self):
        out = _render(_payload(contact_phone=""))
        assert "Meldende(r): Frau Meier" in out
        assert "Tel:" not in out


class TestTheFooter:
    def test_carries_a_reference_to_the_incident(self):
        """The id was in the payload all along and never rendered, so a radio call about
        "the slip" had no way to say which incident it meant."""
        assert "Ref: 3f2b1c8e" in _render(_payload())

    def test_marks_the_end_so_a_truncated_slip_is_visible(self):
        """A thermal print that runs out of paper just stops. Without a terminator, a slip
        missing its crew list is indistinguishable from one with no crew assigned."""
        out = _render(_payload())
        assert out.rstrip().endswith("--- ENDE ---")

    def test_the_stamp_is_local_and_labelled_too(self):
        """The footer stamp (`_stamp`: content-capture time, print time as fallback) has to
        say which clock it means, same as the alarm time above it."""
        assert "Ortszeit" in _render(_payload())

    def test_the_stamp_converts_a_queued_jobs_capture_time(self):
        """`printed_at` is aware UTC from the backend; the paper shows station-local time."""
        out = _render(_payload(printed_at="2026-07-30T13:05:00+00:00"))
        assert "30.07.2026 15:05 Ortszeit" in out


class TestTheWholeSlip:
    def test_still_carries_every_operational_section(self):
        """Guards the sections a crew reads, so a refactor cannot quietly drop one."""
        out = _render(_payload())
        for expected in (
            "Hauptstrasse 12, Oberwil",
            "BRANDEINSATZ",
            "Rauch aus dem Dachstock",
            "FAHRZEUGE",
            "TLF",
            "Omega 1",
            "BESATZUNG",
            "Müller Hans",
            "MATERIAL",
            "Tauchpumpe Gr.",
        ):
            assert expected in out, f"missing from the slip: {expected}"

    def test_cuts_the_paper_exactly_once(self):
        import formatters

        p = _FakePrinter()
        formatters.format_assignment_slip(p, _payload())
        assert p.cut_count == 1

    def test_an_empty_payload_still_produces_a_terminated_slip(self):
        """A slip with nothing on it must still be recognisably complete."""
        out = _render({})
        assert "KEIN STANDORT" in out
        assert out.rstrip().endswith("--- ENDE ---")
