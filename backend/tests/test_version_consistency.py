"""The release version is duplicated across four packages – this fails when they drift.

KP Rück ships as four images released together under one version, so a station always runs a
matched set. `scripts/release.py` (via `just release X.Y.Z`) bumps them together; a hand-edit
of one would produce a release whose frontend and backend claim different versions.

Skipped when the repo root isn't present (running inside the backend image, where only
backend/ is copied).
"""

import json
import pathlib
import re

import pytest

from app.config import settings

ROOT = pathlib.Path(__file__).resolve().parents[2]
FRONTEND_PKG = ROOT / "frontend" / "package.json"
BACKEND_PYPROJECT = ROOT / "backend" / "pyproject.toml"
AGENT_PYPROJECT = ROOT / "tools" / "print-agent" / "pyproject.toml"

pytestmark = pytest.mark.skipif(not FRONTEND_PKG.exists(), reason="repo root not available (running from the image)")


def _toml_version(path: pathlib.Path) -> str:
    m = re.search(r'(?m)^version = "([^"]+)"', path.read_text())
    assert m, f"{path} has no version"
    return m.group(1)


def test_all_packages_share_one_version():
    frontend = json.loads(FRONTEND_PKG.read_text())["version"]
    backend = _toml_version(BACKEND_PYPROJECT)
    agent = _toml_version(AGENT_PYPROJECT)

    assert frontend == backend == agent == settings.version, (
        f"version drift: frontend={frontend}, backend={backend}, print-agent={agent}, "
        f"config.py={settings.version} – bump with `just release X.Y.Z`"
    )


def test_version_is_semver():
    assert re.fullmatch(r"\d+\.\d+\.\d+", settings.version), settings.version


def test_changelog_documents_the_current_version():
    """A released version must have notes; an in-progress bump must not be tagged yet."""
    changelog = (ROOT / "CHANGELOG.md").read_text()
    assert f"## [{settings.version}]" in changelog, f"CHANGELOG.md has no section for {settings.version}"


def test_install_template_pins_the_complete_release():
    template = (ROOT / ".env.example").read_text()
    assert re.search(r"(?m)^KP_RUECK_TAG=(.*)$", template).group(1) == settings.version
    compose = (ROOT / "docker-compose.yml").read_text()
    assert "KP_RUECK_TAG:-latest" not in compose
    assert compose.count("${KP_RUECK_TAG:?set exact release version KP_RUECK_TAG in .env}") == 4


def test_release_bump_updates_install_pin(tmp_path):
    import importlib.util

    spec = importlib.util.spec_from_file_location("release_script", ROOT / "scripts/release.py")
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    for relative, _, _ in release.VERSION_FILES:
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((ROOT / relative).read_text())
    release.ROOT = tmp_path
    release.bump_files("8.9.10", settings.version)
    assert "KP_RUECK_TAG=8.9.10\n" in (tmp_path / ".env.example").read_text()
