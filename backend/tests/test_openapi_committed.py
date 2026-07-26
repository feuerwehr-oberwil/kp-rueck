"""`docs/openapi.json` is the committed API contract – this fails when it drifts from the code.

The point of committing it is that an integrator writing a dispatch adapter against
`POST /api/alarms`, or a print agent against the job queue, can read the request and response
shapes without booting Postgres and the backend first. That only holds while the file is
current, and a stale one is worse than none: it advertises an API that isn't there, confidently.

Regenerate with `just openapi` and commit the result in the same change that adds, renames or
reshapes a route. `scripts/release.py` regenerates it too, because the schema stamps the
version.

Skipped when the repo root isn't present (running inside the backend image, where only
backend/ is copied).
"""

import json
import pathlib

import pytest

from app.main import app

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMMITTED = ROOT / "docs" / "openapi.json"

pytestmark = pytest.mark.skipif(not COMMITTED.exists(), reason="repo root not available (running from the image)")


def test_committed_openapi_matches_the_app():
    live = app.openapi()
    committed = json.loads(COMMITTED.read_text(encoding="utf-8"))

    live_paths, committed_paths = set(live["paths"]), set(committed.get("paths", {}))
    missing = sorted(live_paths - committed_paths)
    stale = sorted(committed_paths - live_paths)
    assert not missing and not stale, (
        f"docs/openapi.json is out of date – missing: {missing}, no longer served: {stale}. "
        f"Regenerate with `just openapi` and commit it."
    )

    assert committed == live, (
        "docs/openapi.json has the right paths but differs in detail (schemas, params, or the "
        "version stamp) – regenerate with `just openapi` and commit it."
    )
