"""The shared alarm keyword vocabulary must stay identical to kp-front's, and stay wired in.

Both products read the same dispatch system and had independently grown the same two tables —
19 title keywords onto the same categories, 41 priority keywords in the same order — as
literals in their own source. Nothing compared them, so `GASLECK` existed here and not there
and no test anywhere could have said so.

There is no shared package and there will not be one: `docs/RUNNING-BOTH.md` promises
self-hosters separate databases, separate images, separate releases, no shared library and no
runtime coupling. So the copies stay copies and this test compares them — the same trick as
`test_telemetry_vendored.py` and the committed `openapi.json`.

**What this test catches.**

* An edit to either vendored file on this side (the checksums).
* The vocabulary being *un*wired — someone pasting the literal back into `divera_intake.py`
  while the JSON sits there unread. A checksum alone cannot see that, and it is the failure
  that turns a checked-in file into decoration.
* kp-front adding a category this side has no `IncidentType` for. The app degrades rather than
  refusing to boot (`_incident_type`), so this test is the only thing that makes the gap loud
  — without it the new category silently files under `diverse_einsaetze` forever.
* A category key that no longer satisfies the `valid_incident_type` CHECK constraint, which
  would otherwise surface as an IntegrityError at the moment an alarm arrives.

**What it does NOT catch.** It never reads kp-front. Edit one repository, update that
repository's own checksum, and both suites stay green while the vocabularies diverge — which
is exactly the drift this file exists to prevent. Only the `alarm-keyword-drift` job in
`.github/workflows/ci.yml` actually compares the two checkouts. Keep both: this one is fast
and offline, that one is true.

It also says nothing about *matching*. kp-front matches every keyword as a plain substring
while this module requires letter boundaries for GAS/VU/LIFT. That difference is recorded as
data in the shared file, and no test here asserts the two products classify a given alarm the
same way. They may not, and settling that is a decision about the alarm path rather than a
housekeeping one.

**When this fails**, the fix is never to update a hash on its own. Copy the file across, run
both suites, and update the hash in both repositories in the same change.
"""

import hashlib
import json
from pathlib import Path

import pytest

from app import alarm_keywords, models, schemas
from app.services import divera_intake

APP = Path(alarm_keywords.__file__).resolve().parent

# sha256 of each vendored file, as it exists in feuerwehr-oberwil/kp-front.
# Regenerate with:  shasum -a 256 backend/app/alarm_keywords.py backend/app/data/alarm_keywords.json
VENDORED = {
    "alarm_keywords.py": "0cf503ae3d98d07cc4645890b41d77e93c746e4302282364c50917cb63834cdd",
    "data/alarm_keywords.json": "7cef662c7eb41e54bab668828bad05975339f5d4de8691b1b6ca6ef0bee102de",
}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def raw() -> dict:
    return json.loads((APP / "data" / "alarm_keywords.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(VENDORED))
def test_vendored_file_matches_the_recorded_hash(name: str):
    path = APP / name
    assert path.exists(), f"{name} is missing — the vendored copy must not be deleted"
    assert _sha256(path) == VENDORED[name], (
        f"app/{name} no longer matches the hash recorded here.\n"
        f"Copy the file across, run BOTH test suites, and update the hash in BOTH repositories "
        f"in the same change. Do NOT just update the hash — see this module's docstring."
    )


def test_both_halves_are_pinned():
    # A guard on the guard: pinning the JSON but not the loader (or the reverse) would leave
    # half of the shared contract free to move.
    assert set(VENDORED) == {"alarm_keywords.py", "data/alarm_keywords.json"}


def test_schema_version_is_the_one_this_code_understands(raw):
    assert raw["schema_version"] == 1
    assert alarm_keywords.SCHEMA_VERSION == 1


def test_incident_type_mapping_is_derived_from_the_file_not_retyped(raw):
    """`INCIDENT_TYPE_MAPPING` must BE the shared vocabulary, not a copy that agrees today."""
    expected = [(keyword, schemas.IncidentType(category)) for keyword, category in raw["keyword_to_category"]["pairs"]]
    assert list(divera_intake.INCIDENT_TYPE_MAPPING.items()) == expected, (
        "INCIDENT_TYPE_MAPPING no longer matches app/data/alarm_keywords.json. If someone "
        "re-inlined the map, put it back behind alarm_keywords.KEYWORD_TO_CATEGORY — a "
        "checked-in file nothing reads is worse than no file."
    )


def test_priority_keywords_are_derived_from_the_file_not_retyped(raw):
    expected = [kw for group in raw["high_priority_keywords"]["groups"] for kw in group["keywords"]]
    assert list(alarm_keywords.HIGH_PRIORITY_KEYWORDS) == expected


def test_every_category_in_the_shared_file_is_a_real_incident_type():
    """The cross-product guard: kp-front may add a category, and this side must survive it."""
    known = {t.value for t in schemas.IncidentType}
    missing = sorted(alarm_keywords.CATEGORY_KEYS - known)
    assert not missing, (
        f"app/data/alarm_keywords.json routes to categories with no IncidentType: {missing}. "
        f"Add the enum members (and the valid_incident_type CHECK constraint + a migration) in "
        f"the same change that vendors the file."
    )


def test_every_category_survives_the_check_constraint():
    """`incidents.type` carries a CHECK constraint listing the allowed values verbatim.

    The enum and the constraint are two copies of one vocabulary living in different places
    (schemas/incidents.py and models.py + its migration). A category that passes the enum but
    not the constraint fails at INSERT — i.e. when a real alarm arrives, not in CI.
    """
    constraint = next(
        c for c in models.Incident.__table__.constraints if getattr(c, "name", None) == "valid_incident_type"
    )
    allowed = str(constraint.sqltext)
    for category in sorted(alarm_keywords.CATEGORY_KEYS):
        assert f"'{category}'" in allowed, (
            f"category {category!r} is in the shared keyword file and in IncidentType, but not in "
            f"the valid_incident_type CHECK constraint — an alarm of that type would fail to insert."
        )


def test_the_fallback_is_reachable():
    assert alarm_keywords.FALLBACK_CATEGORY in {t.value for t in schemas.IncidentType}
    assert divera_intake.detect_incident_type("nichts davon") == schemas.IncidentType.DIVERSE_EINSAETZE


def test_keywords_are_uppercase_and_unique():
    # The matchers uppercase the title before comparing, so a lowercase entry here would be
    # dead data that silently never fires.
    keywords = [kw for kw, _ in alarm_keywords.KEYWORD_TO_CATEGORY]
    assert keywords == [kw.upper() for kw in keywords]
    assert len(keywords) == len(set(keywords)), "a duplicate keyword makes the later entry unreachable"
    assert all(alarm_keywords.HIGH_PRIORITY_KEYWORDS), "an empty keyword matches everything"
    assert list(alarm_keywords.HIGH_PRIORITY_KEYWORDS) == [kw.upper() for kw in alarm_keywords.HIGH_PRIORITY_KEYWORDS]


def test_the_word_bounded_set_comes_from_the_shared_file():
    # Recorded there so kp-front can see what we do differently. If this stops being read from
    # the file, the divergence goes back to being folklore.
    assert divera_intake._WORD_BOUNDED_KEYWORDS == alarm_keywords.KP_RUECK_WORD_BOUNDED
    assert alarm_keywords.KP_RUECK_WORD_BOUNDED.issubset(alarm_keywords.HIGH_PRIORITY_KEYWORDS), (
        "a word-bounded keyword that is not in the priority list is dead configuration"
    )


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Brand Wohnhaus", schemas.IncidentType.BRANDBEKAEMPFUNG),
        ("FEUER3", schemas.IncidentType.BRANDBEKAEMPFUNG),
        ("VU Strasse", schemas.IncidentType.STRASSENRETTUNG),
        ("BMA Schulhaus", schemas.IncidentType.BMA_UNECHTE_ALARME),
        ("Ölspur Hauptstrasse", schemas.IncidentType.OELWEHR),
        ("Tierrettung Katze", schemas.IncidentType.GERETTETE_TIERE),
        ("Katzenwäsche", schemas.IncidentType.DIVERSE_EINSAETZE),
    ],
)
def test_classification_end_to_end(title: str, expected: schemas.IncidentType):
    # Proves the file is loaded and matched, not merely present.
    assert divera_intake.detect_incident_type(title) == expected


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Wohnungsbrand", schemas.IncidentPriority.HIGH),
        ("Person in Lift", schemas.IncidentPriority.HIGH),
        ("Gasleck Industriestrasse", schemas.IncidentPriority.HIGH),
        ("Fahrzeug in der Gasse", schemas.IncidentPriority.LOW),  # word-bounded GAS must not fire
        ("Wasser im Keller", schemas.IncidentPriority.LOW),
    ],
)
def test_priority_end_to_end(title: str, expected: schemas.IncidentPriority):
    assert divera_intake.infer_priority_from_text(title) == expected
