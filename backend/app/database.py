"""Async database configuration."""

import inspect
import logging
from collections.abc import AsyncGenerator, Callable
from typing import Annotated, Any, cast

from fastapi import Depends
from sqlalchemy import Delete, Update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

logger = logging.getLogger(__name__)

# Create async engine with optimized connection pool settings
engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_size=20,  # Number of persistent connections
    max_overflow=10,  # Extra connections when pool is full
    pool_timeout=30,  # Seconds to wait before timeout
    pool_recycle=1800,  # Recycle connections after 30 minutes
    pool_pre_ping=True,  # Verify connections before using
)

_AFTER_COMMIT = "kp_after_commit"


class AppSession(AsyncSession):
    """The app's session: `commit()` also runs what `after_commit()` queued on it – afterwards.

    Django's `transaction.on_commit`, in small. A rollback drops the queue, so nothing is
    announced for a write that never happened. (A rolled-back `begin_nested()` savepoint does
    not: queue after it, not inside it.)
    """

    async def commit(self) -> None:
        await super().commit()
        queued = self.info.pop(_AFTER_COMMIT, [])
        for emit in queued:
            try:
                await emit()
            except Exception:  # the write is committed – a failed announcement must not 500 it
                logger.exception("after-commit emit failed")

    async def rollback(self) -> None:
        self.info.pop(_AFTER_COMMIT, None)
        await super().rollback()


def after_commit[**P](db: AsyncSession, emit: Callable[P, object], *args: P.args, **kwargs: P.kwargs) -> None:
    """Run `emit(*args, **kwargs)` once `db` commits – a broadcast, a print-agent wake-up.

    For code that writes but does not own the transaction (CRUD, services): the request's
    commit (or the background loop's) runs it. Arguments are taken now, so build the payload
    from the rows as they are at the call.
    """

    async def run() -> None:
        result = emit(*args, **kwargs)
        if inspect.isawaitable(result):
            await result

    db.info.setdefault(_AFTER_COMMIT, []).append(run)


# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AppSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Create separate engine and session factory for audit logging
# This avoids connection pool conflicts with the main request/response cycle
# Note: Reduced max_overflow and timeout to prevent pool exhaustion under load
audit_engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_size=5,  # Smaller pool for audit operations
    max_overflow=5,  # Limited overflow to prevent pool exhaustion
    pool_timeout=10,  # Short timeout - audit should not block requests
    pool_recycle=1800,  # Recycle connections after 30 minutes
    pool_pre_ping=True,  # Verify connections before using
)

audit_session_maker = async_sessionmaker(
    audit_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all models."""


# Who commits: CRUD and services FLUSH, the request COMMITS.
#
# - A route's writes are one transaction: `commit_request` (mounted on the app in main.py)
#   commits the request's session once, after the route returned and BEFORE the response is
#   sent; `get_db` rolls back if the route raised. So a route that calls three CRUD functions
#   is all-or-nothing.
# - Whatever a client or another session reacts to – a WebSocket broadcast (a board refetches
#   on it), a print-agent wake-up – goes out AFTER the commit: `after_commit(db, emit, …)` from
#   code that does not own the transaction, `background_tasks.add_task(emit, …)` from a route
#   (it runs after the response), or an explicit `await db.commit()` right before the emit.
#   `tests/conftest.py` fails any test that emits with uncommitted writes on its session.
# - Other explicit commits, each with its reason beside it: a write that must outlive the error
#   the route raises next (a failure counter before its 403), a lock or pooled connection to
#   give back before a slow call, and the jobs that record their own failure after a rollback
#   (sync_service, roster_snapshot_sync).
# - Outside a request (background loops, startup, scripts) there is no `get_db`: open
#   `async with async_session_maker() as db:` and commit yourself.
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """The request's session (FastAPI dependency). Rolls back when the route raised."""
    async with async_session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def commit_request(db: Annotated[AsyncSession, Depends(get_db)]) -> AsyncGenerator[None, None]:
    """Commit the request's session once the route returned – before the response goes out.

    Mounted app-wide with `scope="function"`: a dependency with the default ("request") scope
    runs its exit code only after the response has been SENT, so a client could read the
    answer – and refetch – before the commit, and a failing commit would follow a 200.
    It shares `get_db`'s cached session; when the route raised, the commit is skipped.
    """
    yield
    await db.commit()


async def execute_dml(db: AsyncSession, stmt: Delete | Update) -> CursorResult[Any]:
    """`db.execute()` for UPDATE/DELETE, typed so `.rowcount` is actually visible.

    SQLAlchemy types `AsyncSession.execute()` as returning `Result[Any]`, which has no
    `rowcount` — that lives on `CursorResult`, which is what a DML statement really returns.
    One cast here beats the same cast at every sweep and requeue call site. Mirrors kp-front.
    """
    return cast("CursorResult[Any]", await db.execute(stmt))
