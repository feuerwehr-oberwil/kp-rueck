"""The vendored roster-snapshot contract must stay identical to KP Front's.

`docs/roster-snapshot.schema.json` describes a personnel file another system publishes and an
app reads: a stable id, a display name, a Dienstgrad key, `active`, and `(provider,
external_id)` pairs that land in `personnel_external_identities`. It is a versioned capability
any station can point at any URL — one personnel provider among several, selectable,
disconnectable, never required.

**Why a copy and not a package.** `docs/RUNNING-BOTH.md` promises self-hosters separate
databases, separate images, separate releases, no shared library and no runtime coupling.
Neither app may import the other. So the copies stay copies and a checksum holds them together,
exactly as `test_telemetry_vendored.py` does for the sanitiser and the shared alarm-keyword
vocabulary does for its own file. Editing the contract is a two-repository change.

**What this catches and what it cannot.** It compares the local files against literals recorded
here, which catches an edit on this side. It does not read KP Front — edit the schema there,
update only that repository's literal, and both suites stay green while the two copies diverge.
The cross-repo diff jobs in `.github/workflows/ci.yml` — `telemetry-drift` and
`alarm-keyword-drift` — are the only things that actually compare the two checkouts, and **this
pair is in neither**. A third job of the same shape (same `SIBLING_REPO` knob, same skip-not-
fail behaviour for forks) is what would close it; it was left out of the change that published
the contract, because nothing implements the contract yet and a job is easier to add than to
argue about later. Add it when the ingestion lands, at the latest.

**Nothing in this application reads a snapshot yet.** The contract is published and the
capability registry lists the provider with `implemented: False`; the ingestion is separate,
later work. This test is here so the artifact cannot drift in the meantime — a checked-in file
nobody compares is the failure that makes checked-in files worthless.
"""

import hashlib
import json
from pathlib import Path

import pytest

from app.api.integrations import integrations

DOCS = Path(__file__).resolve().parents[2] / "docs"

# sha256 of each vendored file, as it exists in feuerwehr-oberwil/kp-front.
# Regenerate there with `just roster-schema`, copy both files across, run BOTH suites, and
# update the hashes in BOTH repositories in the same change.
VENDORED = {
    "roster-snapshot.schema.json": "85c9cfab43c64f096a6b260f4892240fe0b7890acc7741b8be544698ef102cc0",
    "roster-snapshot-outcome.schema.json": "131cedd7246ccac71f9e1017af8e61bebe998dc09f04cc47df8d5d9bac9e78a9",
}

repo_only = pytest.mark.skipif(not DOCS.exists(), reason="repo root not available (running from the image)")


@repo_only
@pytest.mark.parametrize("name", sorted(VENDORED))
def test_vendored_schema_matches_the_recorded_hash(name: str) -> None:
    path = DOCS / name
    assert path.exists(), f"{name} is missing — the vendored copy must not be deleted"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == VENDORED[name], (
        f"docs/{name} no longer matches the hash recorded here.\n"
        f"Copy the file across from kp-front, run BOTH test suites, and update the hash in BOTH "
        f"repositories in the same change. Do NOT just update the hash — see this module's docstring."
    )


@repo_only
def test_both_halves_of_the_contract_are_pinned() -> None:
    # Pinning the document but not the outcome report would leave half the contract free to move.
    assert set(VENDORED) == {"roster-snapshot.schema.json", "roster-snapshot-outcome.schema.json"}


@repo_only
def test_the_contract_carries_no_medical_field() -> None:
    """The one guarantee worth restating on this side rather than trusting across a repo boundary.

    A personnel file is where Arztuntersuchungen, Tauglichkeiten and Impfungen live in most
    fire-service systems, and none of them belong in a payload an incident tool reads. KP Front
    holds the full category guard (German, English, French, Italian stems, run over the schema,
    the example and every incoming document). This is the blunt version of it: if a medically
    named property ever arrives here in a vendored copy, this fails even if nobody re-ran the
    other repository's suite.
    """
    stems = (
        "untersuch",
        "tauglich",
        "impf",
        "vakzin",
        "diagnos",
        "medikament",
        "medizin",
        "allerg",
        "eignung",
        "arzt",
        "gesundheit",
        "krank",
        "blut",
        "attest",
        "schwanger",
        "medical",
        "health",
        "fitness",
        "examination",
        "vaccin",
        "medication",
        "disabilit",
        "pregnan",
        "illness",
        "blood",
        "medecin",
        "idoneita",
    )

    def names(node: object) -> list[str]:
        """Every property and $defs name a schema introduces. Never `description`/`title` —
        those are prose, and the contract's own docstrings discuss the banned words."""
        found: list[str] = []
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("properties", "$defs") and isinstance(value, dict):
                    found.extend(str(prop) for prop in value)
                    for sub in value.values():
                        found.extend(names(sub))
                elif key not in ("description", "title"):
                    found.extend(names(value))
        elif isinstance(node, list):
            for item in node:
                found.extend(names(item))
        return found

    offenders = [
        f"{name}: {prop}"
        for name in sorted(VENDORED)
        for prop in names(json.loads((DOCS / name).read_text(encoding="utf-8")))
        if any(stem in prop.lower().replace("_", "").replace("-", "") for stem in stems)
    ]
    assert not offenders, (
        f"the vendored roster-snapshot contract grew a medical-shaped field: {offenders}. "
        f"Roster snapshots carry no medical data, ever. Remove the field — do not rename it."
    )


def test_the_registry_lists_the_provider_and_admits_it_is_not_built() -> None:
    entry = next(p for p in integrations().known_providers if p.provider == "roster-snapshot")
    assert entry.domain == "personnel"
    assert entry.configured is False
    assert entry.implemented is False, (
        "flip this to True only in the change that actually implements snapshot ingestion — a "
        "registry that claims a working provider is worse than one that omits it"
    )
    assert entry.contract == "docs/roster-snapshot.schema.json"


def test_the_provider_did_not_displace_the_ones_that_work() -> None:
    known = integrations().known_providers
    assert {(p.provider, p.domain) for p in known} >= {
        ("divera", "alarms"),
        ("divera", "personnel"),
        ("traccar", "vehicles"),
        ("roster-snapshot", "personnel"),
    }
    # The personnel domain now has more than one candidate — which is the point of the list.
    assert len([p for p in known if p.domain == "personnel"]) >= 2
