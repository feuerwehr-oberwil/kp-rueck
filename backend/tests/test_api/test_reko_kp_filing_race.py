"""The board's Reko draft is created and filed under the card lock (Sol review S2).

Two requests race for real transactions here: the first one pauses just before its
commit, the test proves PostgreSQL blocks the second on a lock, then lets both finish.
Without the card lock the second request decides on rows the first has not committed
yet – a second draft, or a second «Reko-Bericht» bell for one report.
"""

import asyncio
from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from fastapi import Request
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.security import create_login_tokens
from app.database import get_db
from app.main import app
from app.models import AuditLog, Event, Incident, Notification, RekoReport, StatusTransition, User
from app.services.tokens import generate_form_token

Call = Callable[[AsyncClient, UUID], Awaitable[Response]]


async def _race(
    test_engine,
    monkeypatch,
    seed: Callable[[AsyncSession, UUID, UUID, UUID], Awaitable[None]],
    winner: Call,
    loser: Call,
):
    """Run ``winner`` up to its commit, start ``loser``, prove it waits on a lock, finish both.

    Returns the session factory and the incident id for the assertions; cleans up after.
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
        async with sessions() as db:
            await db.execute(delete(Notification).where(Notification.incident_id == incident_id))
            await db.execute(delete(StatusTransition).where(StatusTransition.incident_id == incident_id))
            await db.execute(delete(RekoReport).where(RekoReport.incident_id == incident_id))
            await db.execute(delete(Incident).where(Incident.id == incident_id))
            await db.execute(delete(Notification).where(Notification.event_id == event_id))
            await db.execute(delete(Event).where(Event.id == event_id))
            await db.execute(delete(AuditLog).where(AuditLog.user_id == user_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()


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


async def test_a_save_racing_the_status_move_does_not_ring_the_bell_twice(test_engine, monkeypatch):
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
                is_relevant=True,
            )
        )
        await db.commit()

    def move(client: AsyncClient, incident_id: UUID) -> Awaitable[Response]:
        return client.post(
            f"/api/incidents/{incident_id}/status", json={"from_status": "reko", "to_status": "reko_done"}
        )

    def save(client: AsyncClient, _incident_id: UUID) -> Awaitable[Response]:
        return client.patch(f"/api/reko/{report_id}?submit=false", json={"summary_text": "Keller 20 cm"})

    reports, bells = await _race(test_engine, monkeypatch, seed, move, save)

    [report] = reports
    assert report.is_draft is False
    assert report.summary_text == "Keller 20 cm"
    assert bells == 1
