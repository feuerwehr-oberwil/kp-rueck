"""Initialize database tables.

Run with: uv run python -m app.init_db
"""
import asyncio

from . import models  # noqa: F401 - Import models to register them
from .database import Base, engine


async def init_db() -> None:
    """Create all database tables."""
    try:
        async with engine.begin() as conn:
            print("Creating tables...")
            await conn.run_sync(Base.metadata.create_all)
            print("Tables created successfully!")
    except Exception as e:
        print(f"Error creating tables: {e}")
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_db())
