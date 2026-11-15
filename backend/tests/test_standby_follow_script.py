"""scripts/standby-follow.sh with stubbed curl/docker/git: when it may update a standby box."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


# The «does this box lead an Ereignis?» query failing, or answering nothing, must not read as
# «not leading»: the next steps would restart the board in the middle of an operation.
@pytest.mark.parametrize(
    "db_answer",
    ["exit 1", "exit 0"],
    ids=["query fails", "query answers nothing"],
)
def test_no_update_when_the_lead_query_gives_no_clear_zero(tmp_path, db_answer):
    (tmp_path / "scripts").mkdir()
    shutil.copy(ROOT / "scripts/standby-follow.sh", tmp_path / "scripts/standby-follow.sh")
    (tmp_path / ".env").write_text("STANDBY_FOLLOW_URL=https://hosted.example\nKP_RUECK_TAG=main-1111111\n")
    calls = tmp_path / "calls.log"
    stubs = {
        "curl": """echo '{"id":"kp-rueck@2222222abcdef@x"}'""",
        "docker": f'echo "docker $*" >> "{calls}"\ncase "$*" in *exec*) {db_answer} ;; esac',
        "git": f'echo "git $*" >> "{calls}"',
    }
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in stubs.items():
        (bin_dir / name).write_text(f"#!/bin/sh\n{body}\n")
        (bin_dir / name).chmod(0o700)

    result = subprocess.run(  # noqa: S603 — a copy of the repository script, stubbed tools only
        ["/bin/bash", str(tmp_path / "scripts/standby-follow.sh")],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
    )

    assert result.returncode == 0, result.stderr
    assert "could not ask the database" in result.stdout
    # Asked the database once, then stopped: no fetch, no pull, no restart.
    assert [line.split(" -c ")[0] for line in calls.read_text().splitlines()] == ["docker compose exec -T db sh"]
    assert "KP_RUECK_TAG=main-1111111" in (tmp_path / ".env").read_text()
