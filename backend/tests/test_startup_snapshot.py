"""Exercise only the snapshot guard with fake commands, never start an application."""

import os
import subprocess
from pathlib import Path

import pytest

START = Path(__file__).resolve().parents[1] / "start.sh"


def run_snapshot(tmp_path, **settings):
    commands = tmp_path / "bin"
    commands.mkdir()
    fake = """#!/bin/bash
case "$(basename "$0")" in
uv)
  if [ "$3" = current ]; then
    [ "${FAIL_CURRENT:-0}" = 0 ] || exit 1
    printf '%s\\n' "${CURRENT:-old_revision}"
  else
    [ "${FAIL_HEADS:-0}" = 0 ] || exit 1
    printf '%s\\n' "${HEADS:-new_revision (head)}"
  fi ;;
psql)
  [ "${FAIL_PSQL:-0}" = 0 ] || exit 1
  case "$*" in *server_version*) echo 16.2 ;; *) echo "${TABLES:-2}" ;; esac ;;
pg_dump)
  if [ "$1" = --version ]; then echo 'pg_dump (PostgreSQL) 16.2'; exit 0; fi
  [ "${FAIL_DUMP:-0}" = 0 ] || exit 1
  while [ "$1" != -f ]; do shift; done
  printf 'synthetic archive' > "$2" ;;
pg_restore) [ "${FAIL_VERIFY:-0}" = 0 ] ;;
esac
"""
    for name in ("uv", "psql", "pg_dump", "pg_restore"):
        path = commands / name
        path.write_text(fake)
        path.chmod(0o755)
    source = START.read_text()
    guard = source[source.index('PREMIGRATION_DIR="') : source.index("\nsnapshot_before_migrate\n")]
    env = {
        "PATH": f"{commands}:{os.defpath}",
        "PREMIGRATION_BACKUP_DIR": str(tmp_path / "snapshots"),
        "DATABASE_URL": "postgresql://synthetic/unused",
        **settings,
    }
    return subprocess.run(  # noqa: S603 - repository guard with fake commands and synthetic environment only
        ["/bin/bash", "-ec", guard + "\nsnapshot_before_migrate\necho MIGRATION_ALLOWED"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("failure", ["FAIL_CURRENT", "FAIL_HEADS", "FAIL_PSQL", "FAIL_DUMP", "FAIL_VERIFY"])
def test_failed_precondition_never_allows_migration(tmp_path, failure):
    result = run_snapshot(tmp_path, **{failure: "1"})
    assert result.returncode != 0
    assert "MIGRATION_ALLOWED" not in result.stdout
    assert "Migration NOT started" in result.stderr
    assert not list(tmp_path.rglob("*.dump"))


def test_empty_database_needs_no_snapshot_destination(tmp_path):
    result = run_snapshot(tmp_path, TABLES="0", FAIL_DUMP="1")
    assert result.returncode == 0, result.stderr
    assert "Fresh empty database" in result.stdout
    assert not (tmp_path / "snapshots").exists()


def test_restart_at_head_needs_no_backup_or_database_probe(tmp_path):
    result = run_snapshot(tmp_path, CURRENT="named_revision (head)", HEADS="named_revision (head)", FAIL_PSQL="1")
    assert result.returncode == 0, result.stderr
    assert "Schema already at head" in result.stdout


def test_pending_migration_has_a_private_verified_snapshot(tmp_path):
    result = run_snapshot(tmp_path)
    assert result.returncode == 0, result.stderr
    dumps = list(tmp_path.rglob("*.dump"))
    assert len(dumps) == 1
    assert dumps[0].stat().st_mode & 0o777 == 0o600


def test_explicit_operator_override_bypasses_snapshot_checks(tmp_path):
    result = run_snapshot(tmp_path, PREMIGRATION_BACKUP="false", FAIL_CURRENT="1")
    assert result.returncode == 0, result.stderr
    assert "disabled" in result.stdout


def test_misspelled_override_does_not_disable_the_guard(tmp_path):
    result = run_snapshot(tmp_path, PREMIGRATION_BACKUP="flase")
    assert result.returncode != 0
    assert "MIGRATION_ALLOWED" not in result.stdout
