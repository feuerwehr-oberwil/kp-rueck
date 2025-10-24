"""Async database configuration."""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

# Create async engine
engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Create separate engine and session factory for audit logging
# This avoids connection pool conflicts with the main request/response cycle
audit_engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_size=5,
    max_overflow=10,
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

    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database session."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
