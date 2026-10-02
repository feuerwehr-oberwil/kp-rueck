"""Two overlapping attaches of one pool alarm make ONE incident.

The attach reads the alarm, creates an incident, then writes the link. Before 2026-09-23
nothing held the alarm between the read and the write, so two requests that overlapped — a
double click, two operators on two boards — both saw "not attached here" and each put a card
on the board for the same call. The sequential version of this was already refused; only a
real overlap shows the bug, so this test uses independent sessions that commit for real.

The overlap is forced, not hoped for: each request, after reading the alarm, waits up to a
second for the other one to have read it too. Without a row lock both get there and both go
on to create an incident. With the lock the second request cannot finish its read until the
first has committed, so the first simply times out of the wait and proceeds alone.
"""

import asyncio
import contextlib
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.security import create_login_tokens
from app.database import get_db
from app.main import app
from app.middleware.audit import _inflight_audit_tasks
from app.models import AuditLog, DiveraEmergency, Event, Incident, StatusTransition, User


async def test_overlapping_attaches_create_one_incident(test_engine, monkeypatch):
    both_read = asyncio.Event()
    readers = 0

    class OverlappingSession(AsyncSession):
        """Holds each request right after its FIRST read of the alarm row."""

        _held = False

        async def execute(self, statement, *args, **kwargs):
            result = await super().execute(statement, *args, **kwargs)
            if (
                not self._held
                and isinstance(statement, Select)
                and DiveraEmergency.__table__ in statement.get_final_froms()
            ):
                self._held = True
                nonlocal readers
                readers += 1
                if readers == 2:
                    both_read.set()
                # A timeout means the other request is blocked on our lock — go on alone.
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(both_read.wait(), timeout=1.0)
            return result

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    request_sessions = async_sessionmaker(test_engine, class_=OverlappingSession, expire_on_commit=False)

    user_id, event_id, emergency_id = uuid4(), uuid4(), uuid4()
    prior_audit_tasks = set(_inflight_audit_tasks)
    async with sessions() as db:
        prior_audit_ids = set(await db.scalars(select(AuditLog.id)))
        db.add_all(
            [
                User(id=user_id, username=f"attach-race-{user_id}", password_hash=None, role="editor"),
                Event(id=event_id, name="Attach race", training_flag=False, created_at=datetime.now(UTC)),
                DiveraEmergency(
                    id=emergency_id,
                    divera_id=880000 + (emergency_id.int % 10000),
                    source="divera",
                    source_id=str(emergency_id),
                    title="FEUER Scheune",
                    received_at=datetime.now(UTC),
                    is_archived=False,
                ),
            ]
        )
        await db.commit()

    async def request_db():
        async with request_sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, request_db)
    access, _ = create_login_tokens({"sub": str(user_id), "role": "editor"})
    try:
        with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                client.cookies.set("access_token", access)
                responses = await asyncio.wait_for(
                    asyncio.gather(
                        *(
                            client.post(
                                f"/api/divera/emergencies/{emergency_id}/attach",
                                json={"event_id": str(event_id)},
                            )
                            for _ in range(2)
                        )
                    ),
                    timeout=15,
                )

        assert sorted(r.status_code for r in responses) == [200, 201], [r.text for r in responses]
        assert responses[0].json()["id"] == responses[1].json()["id"]

        async with sessions() as db:
            count = await db.scalar(select(func.count()).select_from(Incident).where(Incident.event_id == event_id))
            assert count == 1
            emergency = await db.get(DiveraEmergency, emergency_id)
            assert str(emergency.created_incident_id) == responses[0].json()["id"]
    finally:
        await asyncio.gather(*(_inflight_audit_tasks - prior_audit_tasks))
        async with sessions() as db:
            await db.execute(delete(DiveraEmergency).where(DiveraEmergency.id == emergency_id))
            incident_ids = select(Incident.id).where(Incident.event_id == event_id)
            await db.execute(delete(StatusTransition).where(StatusTransition.incident_id.in_(incident_ids)))
            await db.execute(delete(Incident).where(Incident.event_id == event_id))
            await db.execute(delete(AuditLog).where(AuditLog.id.not_in(prior_audit_ids)))
            await db.execute(delete(Event).where(Event.id == event_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
