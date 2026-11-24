"""A Rapport or Reko photo and the row that lists it never part ways (KP hunt 2026-11-24).

Real request transactions (`real_commits`): each request has its own session with the app's
`get_db` rule – a raised route or a refused commit rolls the SESSION back – because that
rollback is what removes a file the refused write had already stored.
"""

import asyncio
import errno
import io
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app.auth.security import create_login_tokens
from app.database import AppSession, get_db
from app.main import app
from app.models import Event, Incident, RekoReport, SchadenplatzReport, User
from app.services.photo_storage import PhotoCopyError, photo_storage

pytestmark = pytest.mark.usefixtures("real_commits")


def jpeg() -> bytes:
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(image, format="JPEG")
    return image.getvalue()


@pytest.fixture
async def board(test_engine: AsyncEngine, monkeypatch) -> AsyncIterator[tuple[AsyncClient, async_sessionmaker, UUID]]:
    """An editor's client whose requests each get their own committing session."""
    sessions = async_sessionmaker(test_engine, class_=AppSession, expire_on_commit=False, autoflush=False)
    user_id, event_id, incident_id = uuid4(), uuid4(), uuid4()
    async with sessions() as db:
        db.add_all([User(id=user_id, username=f"photo-{user_id}", role="editor"), Event(id=event_id, name="Fotos")])
        await db.flush()
        db.add(
            Incident(
                id=incident_id,
                event_id=event_id,
                title="Keller",
                priority="low",
                type="elementarereignis",
                status="active",
            )
        )
        await db.flush()
        db.add(SchadenplatzReport(incident_id=incident_id, is_draft=True))
        await db.commit()

    async def request_session(request: Request) -> AsyncIterator[AppSession]:
        async with sessions() as db:
            await db.execute(text("SET LOCAL lock_timeout = '5s'"))
            try:
                yield db
            except Exception:
                await db.rollback()
                raise

    monkeypatch.setitem(app.dependency_overrides, get_db, request_session)
    cookie, _ = create_login_tokens({"sub": str(user_id), "role": "editor"})
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
        cookies={"access_token": cookie},
    ) as client:
        yield client, sessions, incident_id


def files_of(incident_id: UUID) -> list[Path]:
    return sorted((photo_storage.photos_dir / str(incident_id)).glob("*.jpg"))


async def test_two_uploads_at_once_both_stay_on_the_rapport(board, monkeypatch):
    client, sessions, incident_id = board
    url = f"/api/incidents/{incident_id}/rapport/photos"
    save = photo_storage.save_photo
    inside, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def first_waits(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            inside.set()
            await release.wait()
        return await save(*args, **kwargs)

    monkeypatch.setattr(photo_storage, "save_photo", first_waits)
    first = asyncio.create_task(client.post(url, files={"file": ("a.jpg", jpeg(), "image/jpeg")}))
    await inside.wait()
    # The first has read the Rapport and is storing its file; the second arrives now.
    second = asyncio.create_task(client.post(url, files={"file": ("b.jpg", jpeg(), "image/jpeg")}))
    await asyncio.sleep(0.3)
    release.set()
    answers = [await first, await second]

    assert [a.status_code for a in answers] == [200, 200]
    async with sessions() as db:
        listed = await db.scalar(
            select(SchadenplatzReport.photos_json).where(SchadenplatzReport.incident_id == incident_id)
        )
    assert sorted(listed) == sorted(a.json()["filename"] for a in answers)


@pytest.mark.parametrize("door", ["rapport", "reko"])
async def test_a_refused_upload_leaves_no_file_behind(board, monkeypatch, door):
    client, _, incident_id = board
    url = f"/api/incidents/{incident_id}/rapport/photos" if door == "rapport" else f"/api/reko/{incident_id}/photos"

    async def refused(self):
        raise RuntimeError("injected: the commit is refused")

    monkeypatch.setattr(AppSession, "commit", refused)
    response = await client.post(url, files={"file": ("a.jpg", jpeg(), "image/jpeg")})

    assert response.status_code == 500
    assert files_of(incident_id) == []


async def test_a_refused_delete_keeps_the_photo(board, monkeypatch):
    client, sessions, incident_id = board
    url = f"/api/incidents/{incident_id}/rapport/photos"
    created = await client.post(url, files={"file": ("a.jpg", jpeg(), "image/jpeg")})
    assert created.status_code == 200
    name = created.json()["filename"]

    async def refused(self):
        raise RuntimeError("injected: the commit is refused")

    with monkeypatch.context() as failure:
        failure.setattr(AppSession, "commit", refused)
        response = await client.delete(f"{url}/{name}")

    assert response.status_code == 500
    async with sessions() as db:
        listed = await db.scalar(
            select(SchadenplatzReport.photos_json).where(SchadenplatzReport.incident_id == incident_id)
        )
    assert listed == [name]
    assert (await client.get(f"/api/photos/{incident_id}/{name}")).status_code == 200


async def test_a_reko_delete_removes_its_file(board):
    client, _, incident_id = board
    url = f"/api/reko/{incident_id}/photos"
    created = await client.post(url, files={"file": ("a.jpg", jpeg(), "image/jpeg")})
    name = created.json()["filename"]

    assert (await client.delete(f"{url}/{name}")).status_code == 200
    assert files_of(incident_id) == []


async def test_a_reko_delete_is_done_even_when_the_file_will_not_go(board, monkeypatch):
    client, sessions, incident_id = board
    url = f"/api/reko/{incident_id}/photos"
    created = await client.post(url, files={"file": ("a.jpg", jpeg(), "image/jpeg")})
    assert created.status_code == 200
    name = created.json()["filename"]
    unlink = Path.unlink

    def read_only(path, *args, **kwargs):
        if path.name == name:
            raise OSError(errno.EROFS, "read-only photo volume")
        return unlink(path, *args, **kwargs)

    with monkeypatch.context() as failure:
        failure.setattr(Path, "unlink", read_only)
        response = await client.delete(f"{url}/{name}")

    # Committed: the reference is gone, so a 500 here could only be retried into a 404.
    assert response.status_code == 200
    assert [f.name for f in files_of(incident_id)] == [name], "the unlink was meant to fail"
    async with sessions() as db:
        listed = await db.scalar(select(RekoReport.photos_json).where(RekoReport.incident_id == incident_id))
    assert name not in listed


def test_a_copy_cut_short_leaves_no_truncated_photo(tmp_path, monkeypatch):
    """Zusammenführen copies photos; a disk that fills mid-copy must not leave a partial file
    that a retried merge takes as done."""
    source_id, target_id = uuid4(), uuid4()
    source_dir = photo_storage.photos_dir / str(source_id)
    source_dir.mkdir(parents=True)
    (source_dir / "a.jpg").write_bytes(jpeg())

    def disk_full(src, dst, *args, **kwargs):
        Path(dst).write_bytes(Path(src).read_bytes()[:12])
        raise OSError(errno.ENOSPC, "full photo volume")

    with monkeypatch.context() as failure:
        failure.setattr(shutil, "copy2", disk_full)
        with pytest.raises(PhotoCopyError):
            photo_storage.copy_photos(source_id, target_id, ["a.jpg"])
    assert not (photo_storage.photos_dir / str(target_id) / "a.jpg").exists()

    # A short copy an older build left behind is redone, not taken as done.
    (photo_storage.photos_dir / str(target_id) / "a.jpg").write_bytes(jpeg()[:12])
    assert photo_storage.copy_photos(source_id, target_id, ["a.jpg"]) == 1
    assert (photo_storage.photos_dir / str(target_id) / "a.jpg").read_bytes() == jpeg()
