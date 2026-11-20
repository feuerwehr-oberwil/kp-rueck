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
from typing import Any

import pytest
import yaml

DIRECTORY = Path(__file__).resolve().parents[2] / ".github" / "workflows"
WORKFLOWS = sorted([*DIRECTORY.glob("*.yml"), *DIRECTORY.glob("*.yaml")])
pytestmark = pytest.mark.skipif(not WORKFLOWS, reason="workflow files unavailable")

PINNED = re.compile(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}")


def actions_used(workflow: dict[str, Any]) -> list[str]:
    """Every `uses` value of a workflow: reusable workflows on jobs, actions on steps."""
    jobs = [job for job in workflow.get("jobs", {}).values() if isinstance(job, dict)]
    steps = [step for job in jobs for step in job.get("steps", []) if isinstance(step, dict)]
    return [str(item["uses"]) for item in [*jobs, *steps] if "uses" in item]


def unpinned(text: str) -> list[str]:
    """The action references in a workflow's text that are not `owner/repo@<sha> # vX.Y.Z`.

    The version must stand in a comment on the line of the `uses` key itself.
    """
    found = []
    for action in actions_used(yaml.safe_load(text)):
        # A workflow of this repository (`./.github/workflows/ci.yml`) runs at the same commit.
        if action.startswith("./"):
            continue
        with_version = re.compile(
            rf"""^[ \t-]*["']?uses["']?[ \t]*:[ \t]*["']?{re.escape(action)}["']?[ \t]+#[ \t]*v\d+\.\d+\.\d+[ \t]*$""",
            re.MULTILINE,
        )
        if not PINNED.fullmatch(action) or not with_version.search(text):
            found.append(action)
    return found


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
        f"      - uses:\n          actions/checkout@{SHA} # v7.0.1",
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
        image for workflow in WORKFLOWS for image in re.findall(r"ghcr\.io/gitleaks/gitleaks\S*", workflow.read_text())
    ]
    assert images, "the secret scan no longer runs the gitleaks image"
    assert all(re.search(r"@sha256:[0-9a-f]{64}$", image) for image in images), images


def test_every_workflow_declares_its_permissions() -> None:
    silent = [workflow.name for workflow in WORKFLOWS if "permissions" not in yaml.safe_load(workflow.read_text())]
    assert not silent, f"no top-level `permissions:` block: {silent}"
