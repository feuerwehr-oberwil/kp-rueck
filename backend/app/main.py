"""FastAPI application entry point."""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import routes
from .config import settings
from .database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan events."""
    # Startup: Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # Shutdown: Dispose engine
    await engine.dispose()


app = FastAPI(
    title=settings.project_name,
    description=settings.description,
    version=settings.version,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(routes.router, prefix=settings.api_v1_prefix, tags=["api"])


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"message": f"{settings.project_name} - FastAPI Backend"}


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}
