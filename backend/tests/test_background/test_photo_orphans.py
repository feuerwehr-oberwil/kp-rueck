"""The orphan photo sweep (background/photo_orphans.py): files a crash left without their
report row go, and no file a row points at ever does."""

import os
import shutil
import time
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.background.photo_orphans import sweep_orphan_photos
from app.models import RekoReport, RekoReportFolded, SchadenplatzReport
from app.services.photo_storage import photo_storage

pytestmark = pytest.mark.asyncio

#: «Now» for the sweep: two days ahead, so every file written by the test counts as old
#: (a file's change time cannot be set back; a FRESH file gets a modification time ahead).
LATER = datetime.now(UTC) + timedelta(days=2)


@pytest.fixture
def photos_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    return tmp_path


def _file(folder, name: str):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(b"\xff\xd8\xff photo")
    return path


async def test_only_files_no_row_names_go(db_session, test_incident, photos_dir):
    incident_dir = photos_dir / str(test_incident.id)
    reko = _file(incident_dir, "reko.jpg")
    rapport = _file(incident_dir, "rapport.jpg")
    folded = _file(incident_dir, "folded.jpg")
    orphan = _file(incident_dir, "crash.jpg")
    partial = _file(incident_dir, "copy.jpg.part")
    db_session.add(RekoReport(incident_id=test_incident.id, token="t", is_draft=False, photos_json=["reko.jpg"]))
    db_session.add(
        SchadenplatzReport(
            incident_id=test_incident.id, is_draft=True, personnel_count_corrected=False, photos_json=["rapport.jpg"]
        )
    )
    db_session.add(
        RekoReportFolded(id=uuid4(), incident_id=test_incident.id, kept=False, row_json={"photos_json": ["folded.jpg"]})
    )
    await db_session.flush()

    assert await sweep_orphan_photos(db_session, now=LATER) == 2

    assert reko.exists() and rapport.exists() and folded.exists()
    assert not orphan.exists() and not partial.exists()


async def test_a_young_file_and_a_fresh_merge_copy_stay(db_session, test_incident, photos_dir):
    """An upload whose row is still on its way is young; a merge copy keeps its source's
    modification time (copy2) but is new by its change time."""
    incident_dir = photos_dir / str(test_incident.id)
    young = _file(incident_dir, "uploading.jpg")
    ahead = (LATER - timedelta(hours=1)).timestamp()
    os.utime(young, (ahead, ahead))

    source = _file(photos_dir / str(uuid4()), "merged.jpg")
    long_ago = time.time() - 30 * 24 * 3600
    os.utime(source, (long_ago, long_ago))
    copy = incident_dir / "merged.jpg"
    shutil.copy2(source, copy)
    assert copy.stat().st_mtime < time.time() - 24 * 3600  # looks old by mtime alone

    # The sweep runs NOW: the copy is a day younger than the cut by its change time.
    assert await sweep_orphan_photos(db_session) == 0
    assert copy.exists()
    # Two days on, the young upload is still within the day, the unreferenced copies are not.
    assert await sweep_orphan_photos(db_session, now=LATER) == 2
    assert young.exists()


async def test_folders_and_files_that_are_not_photos_are_left_alone(db_session, photos_dir):
    stray = _file(photos_dir / "not-an-incident", "x.jpg")
    top = _file(photos_dir, "README")

    assert await sweep_orphan_photos(db_session, now=LATER) == 0
    assert stray.exists() and top.exists()


async def test_a_file_a_merge_attaches_meanwhile_stays(db_session, test_incident, photos_dir, monkeypatch):
    """Listed as old, then a merge keeps it and attaches it anew (copy_photos refreshes its
    change time) before its row commits: the re-check before removal spares it."""
    from app.background import photo_orphans

    source = _file(photos_dir / str(uuid4()), "kept.jpg")
    target = _file(photos_dir / str(test_incident.id), "kept.jpg")
    long_ago = time.time() - 30 * 24 * 3600
    for path in (source, target):
        os.utime(path, (long_ago, long_ago))
    before = target.stat()

    def listed_then_attached(_photos_dir, _cutoff):
        photo_storage.copy_photos(UUID(source.parent.name), test_incident.id, ["kept.jpg"])
        return [(str(test_incident.id), target)]

    monkeypatch.setattr(photo_orphans, "_old_files", listed_then_attached)
    assert await sweep_orphan_photos(db_session) == 0
    assert target.exists()
    after = target.stat()
    assert after.st_mtime_ns == before.st_mtime_ns  # «taken at» unchanged
    assert after.st_ctime_ns > before.st_ctime_ns
