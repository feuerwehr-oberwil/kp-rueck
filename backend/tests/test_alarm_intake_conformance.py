"""The shared alarm-intake corpus must describe THIS app's behaviour truthfully.

``docs/alarm-intake-conformance.json`` is vendored byte-identical in kp-front. It answers one
question a self-hoster running both products asks exactly once, usually after being bitten:
*can I point my dispatch system at both with the same body?*

Two halves, asserted differently:

* ``cases`` — the portable subset. Every entry must get the same verdict from both apps, so
  this test simply checks the verdict against ours. kp-front's copy of this test checks the
  same list against theirs. Same list, two suites, one contract.
* ``divergent`` — payloads the two genuinely answer differently. This test asserts only the
  ``kp_rueck`` column. Recording them is the point: a divergence nothing pins is free to grow,
  and every entry here was found by reading the two models side by side rather than by anyone
  hitting it in production.

**What this test cannot do**: it never reads kp-front. Edit the corpus and this suite alone,
and both repositories stay green while their copies fork. The ``alarm-contract-drift`` job in
``.github/workflows/ci.yml`` is the only thing that compares them — same split as the telemetry
and roster-snapshot contracts, for the same reason.

**When a case here fails**, the fix is almost never to edit the corpus. A payload that changed
verdict means the intake contract moved, and the corpus is what tells you it moved on one side
only.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.alarms import RESERVED_ALARM_SOURCES, AlarmIn

CORPUS_PATH = Path(__file__).resolve().parent.parent.parent / "docs" / "alarm-intake-conformance.json"

# The corpus lives in the repository, not in the backend image: the dev container mounts
# `backend/` alone, so three levels up is `/` and the file is simply not there. Skipping keeps
# `docker exec … pytest` usable for the other 2'800 tests instead of aborting collection for the
# whole run — the same host-only treatment `test_openapi_committed.py` gets. CI runs from a
# checkout, so the contract is still enforced where it matters.
if not CORPUS_PATH.is_file():  # pragma: no cover - container-only path
    pytest.skip(f"Corpus not reachable at {CORPUS_PATH} — run this from a repository checkout", allow_module_level=True)

CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def _verdict(payload: dict) -> str:
    """What POST /api/alarms does with this body, as one word.

    Validation and the reserved-slug check are folded together on purpose: both happen before
    an alarm exists and both answer 4xx with nothing created, so a sender cannot tell them
    apart. See ``api/alarms.py`` — the reserved check runs on the parsed model.
    """
    try:
        alarm = AlarmIn(**payload)
    except ValidationError:
        return "reject"
    return "reject" if alarm.source in RESERVED_ALARM_SOURCES else "accept"


def test_reserved_sources_match_the_corpus() -> None:
    """The corpus carries the union both products reserve; ours must be exactly it."""
    assert set(CORPUS["reserved_sources"]) == RESERVED_ALARM_SOURCES


@pytest.mark.parametrize("case", CORPUS["cases"], ids=lambda c: c["name"])
def test_portable_case(case: dict) -> None:
    expected = "accept" if case["accept"] else "reject"
    actual = _verdict(case["payload"])
    assert actual == expected, (
        f"{case['name']}: expected {expected}, got {actual}.\n"
        f"Why this case exists: {case['why']}\n"
        "This is the PORTABLE subset — kp-front asserts the same list. A change here that is "
        "right for this app is still wrong until the same change lands there."
    )


@pytest.mark.parametrize("case", CORPUS["divergent"], ids=lambda c: c["name"])
def test_recorded_divergence(case: dict) -> None:
    actual = _verdict(case["payload"])
    assert actual == case["kp_rueck"], (
        f"{case['name']}: the corpus records kp_rueck={case['kp_rueck']}, this app now says {actual}.\n"
        f"{case['note']}\n"
        "If the two products just converged on this payload, move the entry into `cases` in "
        "BOTH repositories. If they diverged further, update the column — but say so in the "
        "note, because this list is the only record that the difference is deliberate."
    )
