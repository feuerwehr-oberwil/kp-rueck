"""Rate limits: proven ENFORCED on a real route, and proven PRESENT on the public ones.

`test_rate_limit.py` next door checks the configured numbers and calls
`rate_limit_exceeded_handler` directly with a `MockException`. Both are worth having and
neither answers the question that matters: does a real request to a real route actually get
a 429? It could not, because `conftest.py` disables the limiter for the whole suite
(autouse, so every test opted out silently) — every one of the 26 `@limiter.limit(...)`
decorators was decoration that nothing verified.

Two tests, deliberately different in kind:

* **Enforcement** goes through the real app and the real decorator on `POST /api/alarms`,
  the endpoint an outside system can reach with only a shared secret.
* **Coverage** is a registry test in the spirit of `test_field_surface_registry.py`: it asks
  slowapi which routes carry a limit and fails when a public, unauthenticated route is added
  without one. That is the failure mode worth catching — not today's numbers being wrong, but
  tomorrow's endpoint being added unprotected.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.rate_limit import RateLimits, limiter
from app.models import Setting

# Same value tests/test_api/test_alarms.py uses.
SECRET = "test_secret"  # a test fixture value, not a credential (S105 is off for tests/)

# Public write routes that carry NO rate limit today. This is a BACKLOG, not an exemption
# list: every entry is a real gap found on 2026-08-11 when the coverage test below was first
# written, and the audit finding it came from ("decorated on every public route") turned out
# to be too optimistic — these eleven were never decorated at all.
#
# They are recorded rather than capped on the spot because each needs a number chosen against
# how it is really used, and a wrong number here breaks an incident rather than an abuser:
#
#   * print/claim + print/complete — the agent polls and claims in bursts when a queue drains.
#     A per-minute cap keyed on IP would throttle the one printer at the station.
#   * personnel check-in in/out — forty people arriving inside two minutes, all behind the
#     command post's single NAT address. This is the LOGIN lesson again (see RateLimits.LOGIN):
#     an IP-keyed limit punishes the crew, not the attacker.
#   * reko submit/update/arrived/photos — token-gated, and the surface autosaves.
#   * auth/logout — cheap, and refusing a logout is worse than serving it.
#   * diag/client-error — genuinely open; the obvious candidate to cap first.
#
# Removing an entry (with a limit and a test) is the point. Adding one needs the same
# argument in writing.
KNOWN_UNLIMITED = {
    "app.api.auth.logout",
    "app.api.diag.report_client_error",
    "app.api.personnel_checkin.check_in",
    "app.api.personnel_checkin.check_out",
    "app.api.print.claim_print_job",
    "app.api.print.complete_print_job",
    "app.api.reko.submit_reko_report",
    "app.api.reko.update_report",
    "app.api.reko.mark_reko_arrived",
    "app.api.reko.generate_reko_link",
    "app.api.reko.delete_photo",
}


@pytest_asyncio.fixture
async def webhook_secret_configured(db_session: AsyncSession) -> str:
    """Configure the shared secret so the alarm endpoint gets past its auth check."""
    db_session.add(Setting(key="alarm_webhook_secret", value=SECRET))
    await db_session.commit()
    return SECRET


@pytest.fixture
def enforce_rate_limits():
    """Undo conftest's autouse `limiter.enabled = False` for this test only.

    The storage is reset on both sides: entering, so a previous test's requests do not count
    against this one, and leaving, so the requests made here cannot leak into a later test
    that happens to hit the same route with the same client key.
    """
    limiter.reset()
    limiter.enabled = True
    yield
    limiter.enabled = False
    limiter.reset()


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_webhook_limit_actually_returns_429(
    client: AsyncClient,
    enforce_rate_limits,
    webhook_secret_configured,
):
    """The 11th alarm in a minute is refused — by the app, not by a hand-called handler."""
    payload = {"source": "leitstelle", "source_id": "RL-1", "title": "FEUER Testlauf"}

    limit = int(RateLimits.WEBHOOK.split("/")[0])
    assert limit == 10, "test assumes WEBHOOK is 10/minute; update the loop if it changed"

    for i in range(limit):
        response = await client.post(f"/api/alarms?secret={SECRET}", json={**payload, "source_id": f"RL-{i}"})
        assert response.status_code != 429, f"request {i + 1} of {limit} was refused, the limit is too tight"

    refused = await client.post(f"/api/alarms?secret={SECRET}", json={**payload, "source_id": "RL-over"})
    assert refused.status_code == 429
    # German first — an operator or a relay author reads this, and it is the only signal
    # they get. Retry-After is what a well-behaved relay backs off on.
    assert "Zu viele Anfragen" in refused.json()["detail"]
    assert "Retry-After" in refused.headers


@pytest.mark.unit
def test_every_public_write_route_carries_a_rate_limit():
    """A new UNAUTHENTICATED write route without a limit makes this fail — that is the point.

    "Public" is decided by the signature, not by the path. Both `/api/feld` and `/api/intake`
    carry an editor-only `generate-link` endpoint next to their token-gated ones, so a
    prefix-based rule flags two routes that are in fact behind the login. What actually
    matters is whether a request with no session can reach it: those are the ones the
    internet can reach, and the ones a limit is the only defence for.

    Session-protected routes are out of scope — they have the editor/viewer gate in front of
    them, and DEFAULT applies anyway.
    """
    import inspect

    from app.auth.dependencies import CurrentAdmin, CurrentEditor, CurrentUser
    from app.main import app

    auth_annotations = {CurrentUser, CurrentEditor, CurrentAdmin}
    limited = set(limiter._route_limits.keys())

    missing = []
    for route in app.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set()) or set()
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None or not path.startswith("/api/"):
            continue
        # Writes only: a GET on a token-gated surface reads data the token already grants,
        # while the writes are what an abuser would automate.
        if not methods & {"POST", "PUT", "PATCH", "DELETE"}:
            continue
        try:
            params = inspect.signature(endpoint).parameters.values()
        except (TypeError, ValueError):  # pragma: no cover — non-introspectable endpoint
            continue
        if any(p.annotation in auth_annotations for p in params):
            continue  # behind the login

        name = f"{endpoint.__module__}.{endpoint.__name__}"
        if name in limited or name in KNOWN_UNLIMITED:
            continue
        missing.append(f"{sorted(methods)} {path} ({name})")

    assert not missing, (
        "public (unauthenticated) write routes without @limiter.limit(...):\n  "
        + "\n  ".join(missing)
        + "\n\nAdd @limiter.limit(RateLimits.X), or add it to KNOWN_UNLIMITED above with the "
        "reason — but read that list's comment first, it is a backlog and not an exemption."
    )
