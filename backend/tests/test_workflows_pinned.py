"""The GitHub workflows run pinned code with named rights.

- Every action is pinned by a full commit SHA, with its version in a comment. A tag can be
  moved to other code; a commit cannot. Dependabot updates the SHA and the comment together.
- Every workflow declares `permissions:` at the top, so none falls back to the repository's
  default token rights.
"""

import re
from pathlib import Path

import pytest

WORKFLOWS = sorted((Path(__file__).resolve().parents[2] / ".github" / "workflows").glob("*.yml"))
pytestmark = pytest.mark.skipif(not WORKFLOWS, reason="workflow files unavailable")

USES = re.compile(r"^\s*(?:-\s*)?uses:\s*(\S+)[ \t]*(?:#[ \t]*(\S+))?", re.MULTILINE)
PINNED = re.compile(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}")
VERSION = re.compile(r"v\d+(\.\d+){0,2}")


def test_every_action_is_pinned_by_commit_and_names_its_version() -> None:
    unpinned = [
        f"{workflow.name}: {action}"
        for workflow in WORKFLOWS
        for action, version in USES.findall(workflow.read_text())
        # A workflow of this repository (`./.github/workflows/ci.yml`) runs at the same commit.
        if not action.startswith("./") and not (PINNED.fullmatch(action) and VERSION.fullmatch(version))
    ]
    assert not unpinned, f"pin by full SHA with a `# vX.Y.Z` comment: {unpinned}"


def test_every_workflow_declares_its_permissions() -> None:
    silent = [workflow.name for workflow in WORKFLOWS if not re.search(r"^permissions:", workflow.read_text(), re.M)]
    assert not silent, f"no top-level `permissions:` block: {silent}"
