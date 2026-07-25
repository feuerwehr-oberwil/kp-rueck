#!/usr/bin/env python3
"""Bump every place the version lives, and open a CHANGELOG section for it.

    python3 scripts/release.py 0.2.0        # or: just release 0.2.0

KP Rück ships as four images (backend, frontend, tileserver, print-agent) that are released
together under ONE version – a station runs the set, not a mix – so this bumps all of them at
once. The pytest in backend/tests/test_version_consistency.py fails if they ever drift.

Touches only the version files and the CHANGELOG – no staging, no commit, no tag. Review the
diff, then:

    just release-tag 0.2.0
    git push --follow-tags

Idempotent: re-running with a version whose CHANGELOG section already exists leaves the
changelog alone and only normalises the version files.
"""

from __future__ import annotations

import datetime
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO_URL = "https://github.com/feuerwehr-oberwil/kp-rueck"
CHANGELOG = ROOT / "CHANGELOG.md"

# (path, regex matching the version line, replacement template with {v})
VERSION_FILES = [
    ("frontend/package.json", r'"version":\s*"[^"]+"', '"version": "{v}"'),
    ("backend/pyproject.toml", r'(?m)^version = "[^"]+"', 'version = "{v}"'),
    ("backend/app/config.py", r'(?m)^(\s*version: str = )"[^"]+"', r'\g<1>"{v}"'),
    ("tools/print-agent/pyproject.toml", r'(?m)^version = "[^"]+"', 'version = "{v}"'),
]

# The tileserver image has no version file of its own – it is a thin wrapper around an
# upstream tileserver-gl tag plus our init script, and rides along on the release version.


def fail(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(1)


def current_version() -> str:
    pkg = (ROOT / "frontend" / "package.json").read_text()
    m = re.search(r'"version":\s*"([^"]+)"', pkg)
    if not m:
        fail("frontend/package.json has no version field")
    return m.group(1)  # type: ignore[union-attr]


def bump_files(version: str, previous: str) -> None:
    for rel, pattern, replacement in VERSION_FILES:
        path = ROOT / rel
        text = path.read_text()
        new, count = re.subn(pattern, replacement.replace("{v}", version), text, count=1)
        if count != 1:
            fail(f"{rel}: no version line matching /{pattern}/")
        if new != text:
            path.write_text(new)
        print(f"  {rel:<28} {previous} → {version}")


def relock() -> None:
    """uv.lock records each project's own version too – re-lock so the next `uv run` doesn't
    quietly rewrite it and leave the release commit trailing a dirty file."""
    if not shutil.which("uv"):
        print("  uv.lock                      SKIPPED (uv not on PATH – run `uv lock` yourself)")
        return
    for project in ("backend", "tools/print-agent"):
        if (ROOT / project / "uv.lock").exists():
            subprocess.run(["uv", "lock", "--quiet"], cwd=ROOT / project, check=True)
            print(f"  {project}/uv.lock{'':<14} re-locked")


def bump_changelog(version: str, previous: str) -> None:
    text = CHANGELOG.read_text()

    if f"## [{version}]" in text:
        print(f"  CHANGELOG.md                 section [{version}] already written – left as is")
    else:
        if "## [Unreleased]" not in text:
            fail("CHANGELOG.md has no '## [Unreleased]' section")
        body = text.split("## [Unreleased]", 1)[1].split("\n## [", 1)[0].strip()
        if not body:
            fail(
                "CHANGELOG.md '## [Unreleased]' is empty – draft the notes first "
                "(`just changelog`), curate them, then bump"
            )
        today = datetime.date.today().isoformat()
        text = text.replace("## [Unreleased]", f"## [Unreleased]\n\n## [{version}] – {today}", 1)
        print(f"  CHANGELOG.md                 [Unreleased] → [{version}]")

    unreleased_link = f"[Unreleased]: {REPO_URL}/compare/v{version}...HEAD"
    if f"\n[{version}]: " not in text:
        # The very first release has nothing to compare against – link the tag itself.
        first = f"[{version}]: {REPO_URL}/releases/tag/v{version}"
        older = f"[{version}]: {REPO_URL}/compare/v{previous}...v{version}"
        version_link = first if previous == version else older
        if re.search(r"^\[Unreleased\]: ", text, flags=re.MULTILINE):
            text = re.sub(
                r"^\[Unreleased\]: .*$",
                f"{unreleased_link}\n{version_link}",
                text,
                count=1,
                flags=re.MULTILINE,
            )
        else:
            text = text.rstrip("\n") + f"\n\n{unreleased_link}\n{version_link}\n"
    else:
        text = re.sub(r"^\[Unreleased\]: .*$", unreleased_link, text, count=1, flags=re.MULTILINE)

    CHANGELOG.write_text(text)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: release.py <version>   e.g. release.py 0.2.0")
    version = sys.argv[1].lstrip("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail(f"'{version}' is not a MAJOR.MINOR.PATCH version")

    previous = current_version()
    if previous == version:
        print(f"note: version is already {version} – re-running to normalise the other files")

    bump_files(version, previous)
    relock()
    bump_changelog(version, previous)

    print(
        f"\nBumped to {version}. Review the diff, then:\n"
        f"  just release-tag {version}\n"
        f"  git push --follow-tags\n"
        f"\nPushing the tag runs .github/workflows/release.yml: the CI gate, then the four\n"
        f"GHCR images and the GitHub Release (notes taken from the CHANGELOG section)."
    )


if __name__ == "__main__":
    main()
