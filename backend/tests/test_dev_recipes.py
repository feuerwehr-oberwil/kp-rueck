"""The `dev-` recipes act on the development compose stack only, never on the station's board.

`just dev-stop` / `just dev-clean` once also ran `docker compose down` (dev-clean: `down -v`) on
the PRODUCTION file, and the dev file shared the production compose project in a clone named
`kp-rueck`. This reads the justfile and both compose files; no Docker, no `just` needed.
"""

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(not (ROOT / "justfile").exists(), reason="repository files unavailable")


def recipe_body(name: str) -> str:
    text = (ROOT / "justfile").read_text()
    match = re.search(rf"^{re.escape(name)}\b[^\n]*:\n((?:[ \t]+[^\n]*\n|\n)*)", text, re.MULTILINE)
    assert match, f"recipe {name} not found"
    return match.group(1)


@pytest.mark.parametrize("recipe", ["dev-stop", "dev-clean"])
def test_dev_recipe_uses_only_the_dev_compose_file(recipe: str) -> None:
    calls = [line.strip() for line in recipe_body(recipe).splitlines() if "docker compose" in line]
    code = [c for c in calls if not c.startswith("#") and not c.startswith("@#")]
    assert code, f"{recipe} runs no docker compose command"
    for call in code:
        assert "-f docker-compose.dev.yml" in call, f"{recipe} touches another stack: {call}"


def test_dev_clean_removes_by_name_only_what_the_dev_file_declares() -> None:
    # dev-stop / dev-clean also remove the pre-`kp-rueck-dev` containers (and dev-clean the
    # volumes) by name: the names they use must be exactly the dev file's.
    dev = yaml.safe_load((ROOT / "docker-compose.dev.yml").read_text())
    body = recipe_body("dev-clean")
    loop = re.search(r"for volume in ([^;]+);", body)
    assert loop, "dev-clean no longer removes the dev volumes by name"
    assert set(loop.group(1).split()) == {v["name"] for v in dev["volumes"].values()}

    justfile = (ROOT / "justfile").read_text()
    declared = re.search(r'^dev_containers := "([^"]+)"', justfile, re.MULTILINE)
    assert declared, "dev_containers is gone from the justfile"
    assert set(declared.group(1).split()) == {s["container_name"] for s in dev["services"].values()}
    for recipe in ("dev-stop", "dev-clean"):
        assert "for c in {{dev_containers}}" in recipe_body(recipe), f"{recipe} no longer clears the old dev containers"


def test_dev_stack_has_its_own_compose_project() -> None:
    prod = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    dev = yaml.safe_load((ROOT / "docker-compose.dev.yml").read_text())
    assert dev.get("name"), "docker-compose.dev.yml must pin `name:` – else a kp-rueck clone shares prod's project"
    assert dev["name"] != prod["name"]
