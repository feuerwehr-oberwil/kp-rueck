"""Routes may strengthen the referrer policy but cannot weaken its default."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.middleware.security_headers import SecurityHeadersMiddleware


@pytest.mark.parametrize("route_policy", [None, "unsafe-url", "no-referrer"])
async def test_referrer_policy_keeps_only_the_strongest_allowed_value(route_policy):
    async def app(scope, receive, send):
        headers = [(b"referrer-policy", route_policy.encode())] if route_policy else []
        await send({"type": "http.response.start", "status": 200, "headers": headers})
        await send({"type": "http.response.body", "body": b"ok"})

    async with AsyncClient(
        transport=ASGITransport(app=SecurityHeadersMiddleware(app)), base_url="http://test"
    ) as client:
        response = await client.get("/")
    expected = "no-referrer" if route_policy == "no-referrer" else "strict-origin-when-cross-origin"
    assert response.headers.get_list("referrer-policy") == [expected]
