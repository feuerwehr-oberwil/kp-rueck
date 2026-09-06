"""Exercise launch decisions with fake Docker/browser commands in an isolated release folder."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
VERSION = "7.8.9"
pytestmark = pytest.mark.skipif(not (ROOT / "deploy").exists(), reason="complete release files unavailable")


@pytest.fixture
def release_folder(tmp_path):
    (tmp_path / "deploy").mkdir()
    (tmp_path / "frontend").mkdir()
    (tmp_path / "scripts").mkdir()
    shutil.copy(ROOT / "deploy/Start KP Rück.command", tmp_path / "deploy")
    shutil.copy(ROOT / "scripts/init-env.sh", tmp_path / "scripts")
    shutil.copy(ROOT / ".env.example", tmp_path)
    (tmp_path / "frontend/package.json").write_text(json.dumps({"version": VERSION}, indent=2))
    (tmp_path / "docker-compose.yml").write_text("services: {}\n")
    commands = tmp_path / "commands"
    commands.mkdir()
    docker = commands / "docker"
    docker.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "with open(os.environ['CALL_LOG'], 'a') as log:\n"
        "    log.write(json.dumps({'args':sys.argv[1:], 'tag':os.getenv('KP_RUECK_TAG'), "
        "'project':os.getenv('COMPOSE_PROJECT_NAME')}) + '\\n')\n"
        "if sys.argv[1:3] == ['compose', 'up']: sys.exit(int(os.getenv('UP_EXIT', '0')))\n"
    )
    docker.chmod(0o755)
    for name, code in (("curl", 0), ("open", 0), ("ipconfig", 1), ("lsof", 1), ("ss", 1)):
        command = commands / name
        command.write_text(f"#!/bin/sh\nexit {code}\n")
        command.chmod(0o755)
    return tmp_path


def run_launcher(folder, *, up_exit="0"):
    # Preserve only the platform PATH; never inherit real deployment configuration.
    env = {
        "PATH": str(folder / "commands") + os.pathsep + os.environ["PATH"],
        "CALL_LOG": str(folder / "calls.jsonl"),
        "KP_RUECK_TAG": "latest",  # Must not override the validated release pin.
        "COMPOSE_PROJECT_NAME": "existing-synthetic-project",
        "UP_EXIT": up_exit,
    }
    result = subprocess.run(  # noqa: S603 – repository script, isolated fixture and fake Docker
        ["/bin/bash", str(folder / "deploy/Start KP Rück.command")],
        input="\n",
        text=True,
        capture_output=True,
        env=env,
        timeout=10,
    )
    calls = [json.loads(line) for line in (folder / "calls.jsonl").read_text().splitlines()]
    return result, calls


def test_fresh_launcher_pins_the_release_and_only_fetches_missing_images(release_folder):
    result, calls = run_launcher(release_folder)
    assert result.returncode == 0, result.stdout
    env_file = release_folder / ".env"
    assert f"KP_RUECK_TAG={VERSION}\n" in env_file.read_text()
    assert env_file.stat().st_mode & 0o777 == 0o600
    up = [call for call in calls if call["args"][:2] == ["compose", "up"]]
    assert up == [
        {
            "args": ["compose", "up", "-d", "--pull", "missing", "--no-build"],
            "tag": VERSION,
            "project": "existing-synthetic-project",
        }
    ]
    assert not any(call["args"][:2] == ["compose", "pull"] for call in calls)


def test_restart_preserves_configuration_and_project_identity(release_folder):
    original = f"KP_RUECK_TAG={VERSION}\nHTTP_PORT=8099\nSECRET_KEY=synthetic-stable\n"
    env_file = release_folder / ".env"
    env_file.write_text(original)
    result, calls = run_launcher(release_folder)
    assert result.returncode == 0, result.stdout
    assert env_file.read_text() == original
    assert calls[-1]["tag"] == VERSION
    assert calls[-1]["project"] == "existing-synthetic-project"


@pytest.mark.parametrize("tag", ["latest", "7.8", "", "7.8.8", "$(touch must-not-exist)"])
def test_ambiguous_or_mismatched_existing_installation_never_starts_or_rewrites(release_folder, tag):
    env_file = release_folder / ".env"
    original = f"KP_RUECK_TAG={tag}\nSECRET_KEY=synthetic-stable\n"
    env_file.write_text(original)
    result, calls = run_launcher(release_folder)
    assert result.returncode == 1
    assert "docs/DEPLOYMENT.md" in result.stdout
    assert env_file.read_text() == original
    assert not (release_folder / "must-not-exist").exists()
    assert not any(call["args"][:2] in (["compose", "up"], ["compose", "pull"]) for call in calls)


def test_failed_image_fetch_or_start_is_not_reported_as_running(release_folder):
    (release_folder / ".env").write_text(f"KP_RUECK_TAG={VERSION}\n")
    result, _ = run_launcher(release_folder, up_exit="1")
    assert result.returncode == 1
    assert "Der Start ist fehlgeschlagen" in result.stdout
    assert "Das Board läuft:" not in result.stdout


def test_init_derives_pin_from_release_instead_of_template(release_folder):
    # The copied template has the repository version; this fixture deliberately differs.
    result = subprocess.run(  # noqa: S603 – repository script, isolated fixture and fake Docker
        [
            "/bin/bash",
            str(release_folder / "scripts/init-env.sh"),
            "--yes",
            "--lan",
            "--host",
            "localhost",
            "--port",
            "58999",
        ],
        capture_output=True,
        text=True,
        timeout=10,
        env={"PATH": str(release_folder / "commands") + os.pathsep + os.environ["PATH"]},
    )
    assert result.returncode == 0, result.stderr
    assert f"KP_RUECK_TAG={VERSION}\n" in (release_folder / ".env").read_text()
