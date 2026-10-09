"""The vendored roster-snapshot contract must stay identical to KP Front's.

`docs/roster-snapshot.schema.json` describes a personnel file another system publishes and an
app reads: a stable id, a display name, a Dienstgrad key, `active`, and `(provider,
external_id)` pairs that land in `personnel_external_identities`. It is a versioned capability
any station can point at any URL — one personnel provider among several, selectable,
disconnectable, never required.

**Why a copy and not a package.** `docs/RUNNING-BOTH.md` promises self-hosters separate
databases, separate images, separate releases, no shared library and no runtime coupling.
Neither app may import the other. So the copies stay copies, listed with their sha256 in
`shared/MANIFEST.json` beside the telemetry sanitiser and the alarm vocabulary. Editing the
contract is a two-repository change (`shared/README.md`).

**Where the copy is checked.** `tests/test_shared_files.py` holds this repository's copies to the
manifest, offline. CI's «Shared files match KP Front» job checks out both repositories and
compares them; it is the only thing that does. This file keeps what is about the contract
itself: no medical field, and the provider registry.

**Since the ingestion landed, the copy covers the code too.** `app/roster_snapshot.py` (the
contract module: parse + medical guard), `app/roster_snapshot_ingest.py` (fetch + reconcile:
matching, the deactivation cap, the outcome report), the reference producer
`scripts/roster_snapshot_from_csv.py` and its example input are byte-identical with KP Front's,
so one published file lands the same way in both products. KP Rück's own half is
`app/services/roster_snapshot_sync.py`.
"""

import json
from pathlib import Path

import pytest

from app.api.integrations import integrations

DOCS = Path(__file__).resolve().parents[2] / "docs"

#: Both halves of the contract, shared byte for byte with kp-front (`shared/MANIFEST.json`).
SCHEMAS = ("roster-snapshot.schema.json", "roster-snapshot-outcome.schema.json")

repo_only = pytest.mark.skipif(not DOCS.exists(), reason="repo root not available (running from the image)")


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
        for name in SCHEMAS
        for prop in names(json.loads((DOCS / name).read_text(encoding="utf-8")))
        if any(stem in prop.lower().replace("_", "").replace("-", "") for stem in stems)
    ]
    assert not offenders, (
        f"the vendored roster-snapshot contract grew a medical-shaped field: {offenders}. "
        f"Roster snapshots carry no medical data, ever. Remove the field — do not rename it."
    )


def test_the_registry_lists_the_provider_and_it_is_built() -> None:
    # Flipped to True in the change that implemented the ingestion (services/roster_snapshot_sync.py);
    # `configured` follows ROSTER_SNAPSHOT_SOURCE (tests/test_services/test_roster_snapshot_sync.py).
    entry = next(p for p in integrations().known_providers if p.provider == "roster-snapshot")
    assert entry.domain == "personnel"
    assert entry.implemented is True
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
