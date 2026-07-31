"""The settings the UI offers must be settings the API accepts.

`api/settings.py` allowlists writes against `DEFAULT_SETTINGS`. Nothing tied that dict to the
keys the Einstellungen page actually renders, so the two drifted: the page shipped editors for
`home_city`, `map_mode` and `map_style` while the API rejected all three, and every save failed
behind a generic toast. `map_mode` is the offline-map switch — the control that exists for an
internet outage was the one that could not be saved.

These tests are the tie. They read the frontend source rather than a copied list, because a
copied list drifts in exactly the same way as the thing it is meant to guard.
"""

import re
from pathlib import Path

import pytest

from app.services.settings import DEFAULT_SETTINGS

FRONTEND = Path(__file__).resolve().parents[3] / "frontend"
SETTINGS_PAGE = FRONTEND / "app" / "settings" / "page.tsx"


def _keys_rendered_by_settings_page() -> set[str]:
    """Keys from SETTING_CONFIGS in the settings page (`key: 'foo',` entries)."""
    source = SETTINGS_PAGE.read_text(encoding="utf-8")
    block = re.search(r"const SETTING_CONFIGS:.*?\n\];", source, re.DOTALL)
    assert block, "SETTING_CONFIGS not found — did the settings page move or get renamed?"
    return set(re.findall(r"key:\s*'([^']+)'", block.group(0)))


@pytest.mark.skipif(not SETTINGS_PAGE.exists(), reason="frontend sources not present")
def test_every_setting_the_page_offers_can_actually_be_saved():
    rendered = _keys_rendered_by_settings_page()
    assert rendered, "parsed zero keys — the regex no longer matches the page"
    missing = sorted(rendered - DEFAULT_SETTINGS.keys())
    assert not missing, (
        f"The settings page renders {missing}, but api/settings.py only accepts keys present "
        f"in DEFAULT_SETTINGS. Saving these returns 404 behind a generic error toast. "
        f"Add them to DEFAULT_SETTINGS (app/services/settings.py)."
    )


@pytest.mark.parametrize(
    "key",
    [
        # Read by map-view, location-input and route planning; nothing could write them.
        "firestation_latitude",
        "firestation_longitude",
        "firestation_name",
        # The offline-map switch, and the reason this whole file exists.
        "map_mode",
        "map_style",
        "home_city",
    ],
)
def test_settings_read_by_the_frontend_are_writable(key: str):
    assert key in DEFAULT_SETTINGS, f"{key} is read by the frontend but cannot be saved"


def test_seeded_settings_are_writable():
    """
    Anything the seed writes must also be settable afterwards.

    A seeded value the API refuses to update is worse than no default: the station sees a
    populated field, edits it, and is told the save failed with no way to tell why.
    """
    seed_source = (Path(__file__).resolve().parents[2] / "app" / "seed.py").read_text(encoding="utf-8")
    seeded = set(re.findall(r'\(\s*"([a-z_.]+)"\s*,\s*(?:"[^"]*"|secrets\.)', seed_source))
    # Only consider keys that look like settings rows, not unrelated tuples.
    candidates = {k for k in seeded if k in DEFAULT_SETTINGS or k.replace("_", "").isalpha()}
    missing = sorted(k for k in candidates if k not in DEFAULT_SETTINGS and "." not in k)
    # Known non-setting tuples in seed.py would show up here; assert on the settings we know
    # are seeded rather than on everything the regex finds.
    known_seeded_settings = {
        "polling_interval_ms",
        "training_mode",
        "auto_archive_timeout_hours",
        "notification_enabled",
        "alarm_webhook_secret",
        "map_mode",
        "firestation_name",
        "firestation_latitude",
        "firestation_longitude",
        "home_city",
    }
    really_missing = sorted(known_seeded_settings - DEFAULT_SETTINGS.keys())
    assert not really_missing, f"seeded but not writable: {really_missing} (found candidates: {missing})"
