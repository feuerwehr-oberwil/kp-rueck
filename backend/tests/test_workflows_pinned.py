"""The GitHub workflows run pinned code with named rights.

- Every action is pinned by a full commit SHA, with its exact version in a comment on the
  same line. A tag can be moved to other code; a commit cannot. Dependabot updates the SHA and
  the comment together.
- The gitleaks image of the secret scan is pinned by digest.
- Every workflow declares `permissions:` at the top, so none falls back to the repository's
  default token rights.

The workflows are parsed as YAML (PyYAML comes with uvicorn[standard]), so a `uses` in any
spelling is found and a `uses:` inside a script or a step name is not.
"""

import re
from pathlib import Path

import pytest
import yaml

DIRECTORY = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WORKFLOWS = sorted([*DIRECTORY.glob("*.yml"), *DIRECTORY.glob("*.yaml")])
pytestmark = pytest.mark.skipif(not WORKFLOWS, reason="workflow files unavailable")

PINNED = re.compile(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}")
VERSION_COMMENT = re.compile(r"""["']?[ \t]*\}?[ \t]+#[ \t]*v\d+\.\d+\.\d+[ \t]*""")


def uses_lines(text: str) -> list[tuple[str, str]]:
    """Every `uses` value of a workflow with the rest of its own source line after the value.

    Read from the YAML nodes, so each occurrence is found where it stands: `uses` keys only
    (jobs and steps), in any spelling, and never a `uses:` inside a script or a name.
    """
    lines = text.splitlines()
    found: list[tuple[str, str]] = []

    def walk(node: yaml.Node) -> None:
        if isinstance(node, yaml.MappingNode):
            for key, value in node.value:
                if isinstance(key, yaml.ScalarNode) and key.value == "uses" and isinstance(value, yaml.ScalarNode):
                    after = lines[value.end_mark.line][value.end_mark.column :]
                    found.append((value.value, after if value.start_mark.line == value.end_mark.line else ""))
                walk(value)
        elif isinstance(node, yaml.SequenceNode):
            for item in node.value:
                walk(item)

    walk(yaml.compose(text))
    return found


def unpinned(text: str) -> list[str]:
    """The action references in a workflow's text that are not `owner/repo@<sha> # vX.Y.Z`.

    Each occurrence is judged alone: its own line must carry the version comment.
    """
    return [
        action
        for action, after in uses_lines(text)
        # A workflow of this repository (`./.github/workflows/ci.yml`) runs at the same commit.
        if not action.startswith("./") and not (PINNED.fullmatch(action) and VERSION_COMMENT.fullmatch(after))
    ]


def _step(line: str) -> str:
    return f"jobs:\n  job:\n    steps:\n{line}\n"


SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"


@pytest.mark.parametrize(
    "step",
    [
        "      - uses: actions/checkout@v7",
        f"      - uses: actions/checkout@{SHA}",
        f"      - uses: actions/checkout@{SHA} # v7",
        f"      - uses: actions/checkout@v7 # see actions/checkout@{SHA} # v7.0.1",
        "      - {uses: actions/checkout@v7}",
        '      - "uses": actions/checkout@v7',
        "      - uses:\n          actions/checkout@v7",
        # The second step has no comment of its own; the first one's does not count for it.
        f"      - uses: actions/checkout@{SHA} # v7.0.1\n      - uses: actions/checkout@{SHA}",
        # A pinned line inside a script is not the step's `uses` line.
        f"      - uses: actions/checkout@{SHA}\n      - run: |\n          echo uses: actions/checkout@{SHA} # v7.0.1",
    ],
)
def test_the_check_catches_an_unpinned_action(step: str) -> None:
    assert unpinned(_step(step))


@pytest.mark.parametrize(
    "step",
    [
        f"      - uses: actions/checkout@{SHA} # v7.0.1",
        f'      - name: x\n        uses: "actions/checkout@{SHA}" # v7.0.1',
        "      - name: 'uses: actions/checkout@v7 is what this step replaces'\n        run: |\n          echo uses: actions/checkout@v7",
    ],
)
def test_the_check_accepts_a_pinned_action(step: str) -> None:
    assert unpinned(_step(step)) == []


def test_every_action_is_pinned_by_commit_and_names_its_version() -> None:
    found = {workflow.name: unpinned(workflow.read_text()) for workflow in WORKFLOWS}
    found = {name: actions for name, actions in found.items() if actions}
    assert not found, f"pin by full SHA with a `# vX.Y.Z` comment on the same line: {found}"


def test_the_gitleaks_image_is_pinned_by_digest() -> None:
    images = [
        image
        for workflow in WORKFLOWS
        for line in workflow.read_text().splitlines()
        if not line.lstrip().startswith("#")
        for image in re.findall(r"""ghcr\.io/gitleaks/gitleaks[^\s"']*""", line)
    ]
    assert images, "the secret scan no longer runs the gitleaks image"
    assert all(re.search(r"@sha256:[0-9a-f]{64}$", image) for image in images), images


def test_every_workflow_declares_its_permissions() -> None:
    silent = [workflow.name for workflow in WORKFLOWS if "permissions" not in yaml.safe_load(workflow.read_text())]
    assert not silent, f"no top-level `permissions:` block: {silent}"
