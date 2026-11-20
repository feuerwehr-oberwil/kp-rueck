"""The board's Reko draft is created and filed under the card lock (Sol review S2).

Two requests race for real transactions here: the first one pauses just before its
commit, the test proves PostgreSQL blocks the second on a lock, then lets both finish.
Without the card lock the second request decides on rows the first has not committed
yet – a second draft, or a second «Reko-Bericht» bell for one report.
"""

import asyncio
import io
from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient, Response
from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.security import create_login_tokens
from app.database import get_db
from app.main import app
from app.models import Event, Incident, Notification, RekoReport, User
from app.services.photo_storage import photo_storage
from app.services.tokens import generate_form_token

pytestmark = pytest.mark.usefixtures("real_commits")

Call = Callable[[AsyncClient, UUID], Awaitable[Response]]


async def _race(
    test_engine,
    monkeypatch,
    seed: Callable[[AsyncSession, UUID, UUID, UUID], Awaitable[None]],
    winner: Call,
    loser: Call,
):
    """Run ``winner`` up to its commit, start ``loser``, prove it waits on a lock, finish both.

    Returns the reports and the count of Reko bells for the assertions. The committed rows
    are `real_commits`' to remove.
    """
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    incident_id, event_id, user_id = uuid4(), uuid4(), uuid4()
    access, _ = create_login_tokens({"sub": str(user_id), "role": "editor"})
    winner_ready, release_winner, loser_connected = asyncio.Event(), asyncio.Event(), asyncio.Event()
    loser_pid: int | None = None
    seen = 0

    class ControlledSession(AsyncSession):
        async def commit(self):
            if self.info.get("pause"):
                self.info["pause"] = False
                winner_ready.set()
                await release_winner.wait()
            await super().commit()

    request_sessions = async_sessionmaker(test_engine, class_=ControlledSession, expire_on_commit=False)

    async def request_db(request: Request):
        nonlocal loser_pid, seen
        async with request_sessions() as db:
            seen += 1
            if seen == 1:
                db.info["pause"] = True
            else:
                loser_pid = await db.scalar(text("SELECT pg_backend_pid()"))
                loser_connected.set()
            yield db

    async with sessions() as db:
        db.add_all(
            [
                User(id=user_id, username=f"race-{user_id}", password_hash="fixture-only", role="editor"),
                Event(id=event_id, name="Reko filing race", training_flag=True),
            ]
        )
        await db.commit()
        await seed(db, incident_id, event_id, user_id)

    monkeypatch.setitem(app.dependency_overrides, get_db, request_db)
    tasks: list[asyncio.Task[Response]] = []
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test", cookies={"access_token": access}
        ) as client:
            first = asyncio.create_task(winner(client, incident_id))
            tasks.append(first)
            await asyncio.wait_for(winner_ready.wait(), timeout=5)
            second = asyncio.create_task(loser(client, incident_id))
            tasks.append(second)
            await asyncio.wait_for(loser_connected.wait(), timeout=5)
            async with asyncio.timeout(5):
                async with sessions() as observer:
                    while not await observer.scalar(
                        text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": loser_pid}
                    ):
                        assert not second.done(), "The second request decided without waiting for the card lock"
                        await asyncio.sleep(0.01)
            release_winner.set()
            for response in await asyncio.wait_for(asyncio.gather(first, second), timeout=5):
                assert response.status_code == 200, response.text
        async with sessions() as db:
            reports = list((await db.scalars(select(RekoReport).where(RekoReport.incident_id == incident_id))).all())
            bells = await db.scalar(
                select(func.count())
                .select_from(Notification)
                .where(Notification.incident_id == incident_id, Notification.type.like("reko%"))
            )
        return reports, bells
    finally:
        release_winner.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _incident(incident_id: UUID, event_id: UUID, user_id: UUID, status: str) -> Incident:
    return Incident(
        id=incident_id,
        event_id=event_id,
        title="Keller Wasser",
        type="elementarereignis",
        priority="low",
        status=status,
        created_by=user_id,
    )


async def test_two_first_saves_of_the_board_form_make_one_draft(test_engine, monkeypatch):
    async def seed(db: AsyncSession, incident_id: UUID, event_id: UUID, user_id: UUID) -> None:
        db.add(_incident(incident_id, event_id, user_id, "reko"))
        await db.commit()

    def first_save(field: str) -> Call:
        def call(client: AsyncClient, incident_id: UUID) -> Awaitable[Response]:
            body = {"incident_id": str(incident_id), field: "Wasser im Keller"}
            return client.post("/api/reko/?submit=false", json=body)

        return call

    reports, _ = await _race(test_engine, monkeypatch, seed, first_save("summary_text"), first_save("additional_notes"))

    [draft] = reports
    assert draft.is_draft is True
    assert (draft.summary_text, draft.additional_notes) == ("Wasser im Keller", "Wasser im Keller")


async def test_two_first_saves_that_answer_file_one_report(test_engine, monkeypatch):
    """Pass 2 S2: the first answer files at once; the second first save (another board,
    another mount, a retry after a lost response) amends that report – one bell."""

    async def seed(db: AsyncSession, incident_id: UUID, event_id: UUID, user_id: UUID) -> None:
        db.add(_incident(incident_id, event_id, user_id, "reko"))
        await db.commit()

    def first_save(summary: str) -> Call:
        def call(client: AsyncClient, incident_id: UUID) -> Awaitable[Response]:
            body = {"incident_id": str(incident_id), "is_relevant": True, "summary_text": summary}
            return client.post("/api/reko/?submit=false", json=body)

        return call

    reports, bells = await _race(test_engine, monkeypatch, seed, first_save("Keller"), first_save("Keller 20 cm"))

    [report] = reports
    assert report.is_draft is False
    assert report.summary_text == "Keller 20 cm"
    assert bells == 1


async def test_a_note_from_a_blank_form_keeps_the_verdict_another_board_filed(test_engine, monkeypatch):
    """Pass 3 S2, with the board's real payloads (changed fields only): A answers «Ja» and
    files; B opened the form blank and types a note."""

    async def seed(db: AsyncSession, incident_id: UUID, event_id: UUID, user_id: UUID) -> None:
        db.add(_incident(incident_id, event_id, user_id, "reko"))
        await db.commit()

    def first_save(body: dict[str, object]) -> Call:
        def call(client: AsyncClient, incident_id: UUID) -> Awaitable[Response]:
            return client.post("/api/reko/?submit=false", json={"incident_id": str(incident_id), **body})

        return call

    verdict = first_save({"is_relevant": True, "summary_text": "Keller 20 cm", "dangers_json": {"electrical": True}})
    note = first_save({"additional_notes": "Zufahrt über Hof"})
    reports, bells = await _race(test_engine, monkeypatch, seed, verdict, note)

    [report] = reports
    assert report.is_draft is False
    assert (report.is_relevant, report.summary_text) == (True, "Keller 20 cm")
    assert report.dangers_json["electrical"] is True
    assert report.additional_notes == "Zufahrt über Hof"
    assert bells == 1


async def test_two_answers_on_one_draft_file_it_once(test_engine, monkeypatch):
    """The answer files under the card lock: a second board answering the same draft at the
    same moment finds it filed and amends it – one bell, the card moved once."""
    report_id = uuid4()

    async def seed(db: AsyncSession, incident_id: UUID, event_id: UUID, user_id: UUID) -> None:
        db.add(_incident(incident_id, event_id, user_id, "reko"))
        await db.commit()
        db.add(
            RekoReport(
                id=report_id,
                incident_id=incident_id,
                token=generate_form_token(str(incident_id), "reko"),
                is_draft=True,
                created_by_user_id=user_id,
                summary_text="Keller 20 cm",
            )
        )
        await db.commit()

    def answer(relevant: bool) -> Call:
        def call(client: AsyncClient, _incident_id: UUID) -> Awaitable[Response]:
            return client.patch(f"/api/reko/{report_id}?submit=false", json={"is_relevant": relevant})

        return call

    reports, bells = await _race(test_engine, monkeypatch, seed, answer(True), answer(False))

    [report] = reports
    assert (report.is_draft, report.is_relevant) == (False, False)
    assert bells == 1


@pytest.mark.parametrize("first", ["save", "photo"])
async def test_a_photo_during_the_first_save_lands_on_the_same_draft(test_engine, monkeypatch, tmp_path, first):
    """Pass 2 S5 (evidence): a photo upload without a report id resolves its row through
    `get_or_create_kp_reko_report` under the same card lock as the first save, so in either
    order both end on one draft – no second draft from the board."""
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(image, format="JPEG")

    async def seed(db: AsyncSession, incident_id: UUID, event_id: UUID, user_id: UUID) -> None:
        db.add(_incident(incident_id, event_id, user_id, "reko"))
        await db.commit()

    def save(client: AsyncClient, incident_id: UUID) -> Awaitable[Response]:
        body = {"incident_id": str(incident_id), "summary_text": "Wasser im Keller"}
        return client.post("/api/reko/?submit=false", json=body)

    def photo(client: AsyncClient, incident_id: UUID) -> Awaitable[Response]:
        return client.post(
            f"/api/reko/{incident_id}/photos", files={"file": ("photo.jpg", image.getvalue(), "image/jpeg")}
        )

    winner, loser = (save, photo) if first == "save" else (photo, save)
    reports, _ = await _race(test_engine, monkeypatch, seed, winner, loser)

    [draft] = reports
    assert draft.is_draft is True
    assert draft.summary_text == "Wasser im Keller"
    assert len(draft.photos_json or []) == 1
