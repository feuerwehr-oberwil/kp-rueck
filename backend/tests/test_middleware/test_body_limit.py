"""The backend's own body ceiling – the layer left when neither Caddy nor the Next proxy is in front."""

from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from app.middleware.body_limit import BodyLimitMiddleware

LIMIT = 1024


@pytest.fixture
def small_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(BodyLimitMiddleware, max_bytes=LIMIT)

    @app.post("/echo")
    async def echo(request: Request) -> dict[str, int]:
        return {"bytes": len(await request.body())}

    return app


async def _post(app: FastAPI, **kwargs: object) -> tuple[int, dict[str, object]]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/echo", **kwargs)  # type: ignore[arg-type]
        return response.status_code, response.json()


@pytest.mark.asyncio
async def test_a_body_at_the_limit_passes(small_app: FastAPI):
    assert await _post(small_app, content=b"x" * LIMIT) == (200, {"bytes": LIMIT})


@pytest.mark.asyncio
async def test_a_declared_length_over_the_limit_is_refused(small_app: FastAPI):
    status, body = await _post(small_app, content=b"x" * (LIMIT + 1))
    assert status == 413
    assert body == {"detail": "Anfrage zu gross."}


@pytest.mark.asyncio
async def test_a_chunked_body_is_counted_as_it_streams(small_app: FastAPI):
    """No Content-Length to trust: the ceiling still holds."""

    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(4):
            yield b"x" * 400

    status, body = await _post(small_app, content=chunks())
    assert status == 413
    assert body == {"detail": "Anfrage zu gross."}
