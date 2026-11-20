"""The GitHub workflows run pinned code with named rights.

- Every action is pinned by a full commit SHA, with its exact version in a comment on the
  same line. A tag can be moved to other code; a commit cannot. Dependabot updates the SHA and
  the comment together.
- Every workflow declares `permissions:` at the top, so none falls back to the repository's
  default token rights.

The check reads the text, line by line, and is strict on purpose: any `uses` key in any YAML
spelling (quoted, or inside `{ }`) must be followed by a pinned reference and the comment.
"""

import re
from pathlib import Path

import pytest

WORKFLOWS = sorted((Path(__file__).resolve().parents[2] / ".github" / "workflows").glob("*.yml"))
pytestmark = pytest.mark.skipif(not WORKFLOWS, reason="workflow files unavailable")

USES = re.compile(r"""(?<![\w-])["']?uses["']?\s*:\s*["']?(?P<action>[^\s"'}#]+)""")
PINNED_LINE = re.compile(r"""[\w.-]+/[\w./-]+@[0-9a-f]{40}["']?\s*\}?\s+#\s*v\d+\.\d+\.\d+\s*$""")


def unpinned(text: str) -> list[str]:
    """The action references in a workflow's text that are not `owner/repo@<sha> # vX.Y.Z`."""
    found = []
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        for match in USES.finditer(line):
            action = match.group("action")
            # A workflow of this repository (`./.github/workflows/ci.yml`) runs at the same commit.
            if not action.startswith("./") and not PINNED_LINE.search(line[match.start("action") :]):
                found.append(action)
    return found


@pytest.mark.parametrize(
    "line",
    [
        "      - uses: actions/checkout@v7",
        "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
        "      - {uses: actions/checkout@v7}",
        '      - "uses": actions/checkout@v7',
        "        uses: 'actions/checkout@v7' # v7.0.1",
    ],
)
def test_the_check_catches_an_unpinned_action(line: str) -> None:
    assert unpinned(line)


@pytest.mark.parametrize(
    "line",
    [
        "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
        '        uses: "docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6" # v4.7.0',
        "    uses: ./.github/workflows/ci.yml",
        "      # uses: actions/checkout@v7",
    ],
)
def test_the_check_accepts_a_pinned_action(line: str) -> None:
    assert unpinned(line) == []


def test_every_action_is_pinned_by_commit_and_names_its_version() -> None:
    found = {workflow.name: unpinned(workflow.read_text()) for workflow in WORKFLOWS}
    found = {name: actions for name, actions in found.items() if actions}
    assert not found, f"pin by full SHA with a `# vX.Y.Z` comment on the same line: {found}"


def test_every_workflow_declares_its_permissions() -> None:
    silent = [
        workflow.name
        for workflow in WORKFLOWS
        if not re.search(r"""^["']?permissions["']?\s*:""", workflow.read_text(), re.MULTILINE)
    ]
    assert not silent, f"no top-level `permissions:` block: {silent}"
