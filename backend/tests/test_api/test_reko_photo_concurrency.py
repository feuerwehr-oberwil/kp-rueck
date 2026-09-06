"""Photo prefill and unlink must serialize across actual request transactions."""

import asyncio
import io
from uuid import uuid4

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.security import create_login_tokens
from app.database import get_db
from app.main import app
from app.models import AuditLog, Event, Incident, RekoReport, User
from app.services.photo_storage import photo_storage
from app.services.tokens import generate_form_token


@pytest.mark.parametrize("operation", ["draft", "upload"])
@pytest.mark.parametrize("first", ["other", "unlink"])
async def test_photo_copy_and_unlink_serialize(test_engine, tmp_path, monkeypatch, first, operation):
    """Pause the winning transaction, prove PostgreSQL blocks the other, then finish both."""
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    incident_id, unrelated_id, event_id, user_id = (uuid4() for _ in range(4))
    original_token = generate_form_token(str(incident_id))
    draft_token = generate_form_token(str(incident_id))
    filename = f"{uuid4()}.jpg"
    report_id = uuid4()
    access, _ = create_login_tokens({"sub": str(user_id), "role": "editor"})
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(image, format="JPEG")
    winner_ready = asyncio.Event()
    release_winner = asyncio.Event()
    loser_connected = asyncio.Event()
    loser_pid = None
    other_method = "GET" if operation == "draft" else "POST"
    winner_method = other_method if first == "other" else "DELETE"

    class ControlledSession(AsyncSession):
        async def commit(self):
            if self.info.get("pause"):
                self.info["pause"] = False
                winner_ready.set()
                await release_winner.wait()
            await super().commit()

    request_sessions = async_sessionmaker(test_engine, class_=ControlledSession, expire_on_commit=False)

    async def request_db(request: Request):
        nonlocal loser_pid
        async with request_sessions() as db:
            is_target = request.query_params.get("token") == draft_token or request.method in ("DELETE", "POST")
            if is_target:
                db.info["pause"] = request.method == winner_method
                if request.method != winner_method:
                    loser_pid = await db.scalar(text("SELECT pg_backend_pid()"))
                    loser_connected.set()
            yield db

    async with sessions() as db:
        db.add_all(
            [
                User(id=user_id, username=f"race-{user_id}", password_hash="fixture-only", role="editor"),
                Event(id=event_id, name="Photo concurrency fixture", training_flag=True),
            ]
        )
        await db.commit()
        for row_id in (incident_id, unrelated_id):
            db.add(
                Incident(
                    id=row_id,
                    event_id=event_id,
                    title="Photo concurrency fixture",
                    type="brandbekaempfung",
                    priority="medium",
                    status="reko",
                    created_by=user_id,
                )
            )
        await db.commit()
        db.add(
            RekoReport(
                id=report_id, incident_id=incident_id, token=original_token, is_draft=False, photos_json=[filename]
            )
        )
        await db.commit()

    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    disk = tmp_path / str(incident_id) / filename
    disk.parent.mkdir()
    disk.write_bytes(b"fixture photo")
    monkeypatch.setitem(app.dependency_overrides, get_db, request_db)
    tasks = []
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:

            def other():
                if operation == "draft":
                    return client.get("/api/reko/form", params={"incident_id": str(incident_id), "token": draft_token})
                return client.post(
                    f"/api/reko/{incident_id}/photos",
                    params={"report_id": str(report_id)},
                    headers={"Cookie": f"access_token={access}"},
                    files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")},
                )

            def unlink():
                return client.delete(
                    f"/api/reko/{incident_id}/photos/{filename}", headers={"X-Reko-Token": original_token}
                )

            winner = asyncio.create_task(other() if first == "other" else unlink())
            tasks.append(winner)
            await asyncio.wait_for(winner_ready.wait(), timeout=5)
            loser = asyncio.create_task(unlink() if first == "other" else other())
            tasks.append(loser)
            await asyncio.wait_for(loser_connected.wait(), timeout=5)

            # Observe the database lock, not a timing guess about task scheduling.
            async with asyncio.timeout(5):
                async with sessions() as observer:
                    while not await observer.scalar(
                        text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": loser_pid}
                    ):
                        assert not loser.done(), "The competing request bypassed the incident lock"
                        await asyncio.sleep(0.01)

            unrelated = await asyncio.wait_for(
                client.get(
                    "/api/reko/form",
                    params={"incident_id": str(unrelated_id), "token": generate_form_token(str(unrelated_id))},
                ),
                timeout=5,
            )
            assert unrelated.status_code == 200, unrelated.text
            release_winner.set()
            responses = await asyncio.wait_for(asyncio.gather(winner, loser), timeout=5)
            for response in responses:
                assert response.status_code == 200, response.text

            async with sessions() as db:
                original = await db.scalar(select(RekoReport).where(RekoReport.token == original_token))
                if operation == "draft":
                    copied = await db.scalar(select(RekoReport).where(RekoReport.token == draft_token))
                    assert original.photos_json == []
                    assert copied.photos_json == ([filename] if first == "other" else [])
                else:
                    uploaded = responses[0 if first == "other" else 1].json()["filename"]
                    assert original.photos_json == [uploaded]
                    assert photo_storage.get_photo_path(incident_id, uploaded) is not None
            assert disk.exists() is (operation == "draft" and first == "other")
    finally:
        release_winner.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # These sessions commit for real; remove only this test's own rows.
        async with sessions() as db:
            await db.execute(delete(RekoReport).where(RekoReport.incident_id.in_([incident_id, unrelated_id])))
            await db.execute(delete(Incident).where(Incident.id.in_([incident_id, unrelated_id])))
            await db.execute(delete(Event).where(Event.id == event_id))
            await db.execute(delete(AuditLog).where(AuditLog.user_id == user_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
