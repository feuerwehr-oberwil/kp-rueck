"""Exercise backup failure recovery and confidentiality with disposable command stubs."""

import os
import stat
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _environment(tmp_path: Path, monkeypatch, *, fail_dump: bool = False) -> tuple[Path, Path]:
    commands = tmp_path / "bin"
    commands.mkdir()
    scripts = {
        "psql": "printf '17.1\\n'",
        "pg_dump": "exit 5"
        if fail_dump
        else (
            'if [ "$1" = --version ]; then echo "pg_dump (PostgreSQL) 17.1"; exit; fi\n'
            'while [ "$1" != -f ]; do shift; done\n'
            'head -c 2048 /dev/zero > "$2"'
        ),
        "pg_restore": "printf '; Archive entry\\n'",
        # Stop at the first scheduled wait, after the failure and its recovery log.
        "sleep": "exit 42",
    }
    if fail_dump:
        scripts["pg_dump"] = 'if [ "$1" = --version ]; then echo "pg_dump (PostgreSQL) 17.1"; else exit 5; fi'
    for name, body in scripts.items():
        command = commands / name
        command.write_text(f"#!/bin/sh\n{body}\n")
        command.chmod(0o700)
    photos = tmp_path / "photos"
    photos.mkdir()
    (photos / "scene.jpg").write_text("synthetic private photo")
    monkeypatch.setenv("PATH", f"{commands}:{os.environ['PATH']}")
    monkeypatch.setenv("PHOTOS_DIR", str(photos))
    monkeypatch.setenv("BACKUP_ON_START", "true")
    monkeypatch.setenv("BACKUP_SKIP_PHOTOS", "false")
    return tmp_path / "backups", commands


def test_backup_artifacts_are_private_with_permissive_caller_umask(tmp_path, monkeypatch):
    directory, _ = _environment(tmp_path, monkeypatch)
    result = subprocess.run(  # noqa: S603 — only the repository script and disposable paths, passed as argv
        [
            "/bin/bash",
            "-c",
            'umask 022; exec bash "$1" "$2"',
            "backup-test",
            str(ROOT / "scripts/backup.sh"),
            str(directory),
        ],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    for path in [directory, *directory.rglob("*")]:
        assert stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, path


def test_backup_loop_survives_a_failed_backup(tmp_path, monkeypatch):
    directory, _ = _environment(tmp_path, monkeypatch, fail_dump=True)
    result = subprocess.run(  # noqa: S603 — only the repository script and disposable paths, passed as argv
        ["/bin/bash", str(ROOT / "scripts/backup.sh"), "--loop", str(directory)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert (directory / "BACKUP-FAILED").exists()
    assert '"status": "failed"' in (directory / "last-backup.json").read_text()
    assert "next backup in" in result.stdout
    assert result.returncode == 42  # reached the scheduled wait, then the test stopped it


def test_failed_photo_extraction_preserves_existing_photos(tmp_path, monkeypatch):
    _, commands = _environment(tmp_path, monkeypatch)
    (commands / "psql").write_text('#!/bin/sh\ncase "$*" in *server_version*) echo 17.1 ;; *) echo 0 ;; esac\n')
    tar = commands / "tar"
    tar.write_text('#!/bin/sh\nif [ "$1" = tzf ]; then exit 0; fi\nexit 9\n')
    tar.chmod(0o700)
    dump = tmp_path / "database.dump"
    dump.write_bytes(b"synthetic archive (pg_restore is stubbed)")
    archive = tmp_path / "photos.tar.gz"
    archive.write_bytes(b"synthetic archive (tar is stubbed)")

    result = subprocess.run(  # noqa: S603 — repository script, stubbed tools and disposable paths only
        ["/bin/bash", str(ROOT / "scripts/restore.sh"), str(dump), "--photos", str(archive)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    photo = tmp_path / "photos/scene.jpg"
    assert photo.exists(), "A failed extraction deleted the existing photo volume"
    assert photo.read_text() == "synthetic private photo"


def test_photo_restore_replaces_contents_only_after_successful_extraction(tmp_path, monkeypatch):
    _, commands = _environment(tmp_path, monkeypatch)
    (commands / "psql").write_text('#!/bin/sh\ncase "$*" in *server_version*) echo 17.1 ;; *) echo 0 ;; esac\n')
    photos = tmp_path / "photos"
    (photos / ".old-hidden-file").write_text("old")
    dump = tmp_path / "database.dump"
    dump.write_bytes(b"synthetic archive (pg_restore is stubbed)")
    restored = tmp_path / "restored.jpg"
    restored.write_bytes(b"restored photo bytes")
    archive = tmp_path / "photos.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        output.add(restored, arcname="restored.jpg")

    result = subprocess.run(  # noqa: S603 — repository script, stubbed database and disposable paths only
        ["/bin/bash", str(ROOT / "scripts/restore.sh"), str(dump), "--photos", str(archive)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert list(photos.iterdir()) == [photos / "restored.jpg"]
    assert (photos / "restored.jpg").read_bytes() == b"restored photo bytes"
