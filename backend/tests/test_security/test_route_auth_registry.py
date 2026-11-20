"""Every route needs a logged-in user, or it is on the list in this file with its gate.

«Every route» = every route registered on the app when the test runs.

A route «needs a user» when `get_current_user` is in its dependency tree: `CurrentUser`,
`CurrentEditor`, `CurrentAdmin` and everything built on them. A new route without one fails
here until somebody adds it to `OPEN_ROUTES` and names what guards it instead. That line in
the diff is the review: a route that is open to the internet was opened on purpose.

A `Gate` with a `dependency` is checked (the dependency must really be on the route). A gate
that the handler checks itself is documentation: read the handler before you copy the line.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.api.feld import require_feld_claims
from app.api.geocoding import require_geocoding_access
from app.api.print import require_print_agent
from app.api.weather import require_board_or_viewer_token
from app.auth.dependencies import get_current_user
from app.main import app


@dataclass(frozen=True)
class Gate:
    """What guards a route that takes no logged-in user."""

    what: str
    dependency: Callable[..., object] | None = None


# The Feld door has stages. Every stage is a Feld token (`require_feld_claims` checks that it is
# valid and that a revoked claim or unlock is refused); the handler then asks for its stage.
FELD_ANY = Gate("Feld token of any stage; the poster link is enough", require_feld_claims)
FELD_UNLOCK = Gate(
    "Feld poster token plus the Feld-Code, or an editor/admin session in place of the code", require_feld_claims
)
FELD_PICKER = Gate("unlocked Feld token not yet bound to a person: the five-minute picker grant", require_feld_claims)
FELD_DEVICE = Gate("Feld token bound to one person, with a live device claim", require_feld_claims)
PRINT_AGENT = Gate("X-Agent-Token = PRINT_AGENT_TOKEN, 403 while the token is unset", require_print_agent)
GEOCODING = Gate("session, or a live person-bound Feld claim", require_geocoding_access)
BOARD_OR_VIEWER = Gate("session, or a viewer link token", require_board_or_viewer_token)
WEBHOOK = Gate("shared webhook secret (`check_webhook_secret`), refused while no secret exists")
STANDBY_BOX = Gate(
    "STANDBY_SYNC_TOKEN in Authorization, with or without `Bearer ` (`_require_box`); "
    "404 while the token is unset, and always on a standby node"
)
CHECKIN_READ = Gate("check-in link token, or any session with `event_id` (`_resolve_event_and_actor`)")
CHECKIN_WRITE = Gate("check-in link token, or an editor/admin session with `event_id` (`_resolve_event_and_actor`)")
REKO_TOKEN = Gate("Reko form token only (`_require_form_token`)")
REKO_READ = Gate("Reko form token, or any session (`_require_user_or_form_token`)")
REKO_WRITE = Gate("Reko form token, or an editor/admin session (`_require_user_or_form_token`, write)")
INTAKE = Gate("alarm intake link token (`validate_alarm_token`)")
INTAKE_RECEIPT = Gate("alarm intake link token AND the receipt token of that one alarm (`_authorized_intake_report`)")
VIEWER = Gate("viewer link token (`validate_viewer_token`)")

OPEN_ROUTES: dict[tuple[str, str], Gate] = {
    # --- Sign-in --------------------------------------------------------------------------
    ("POST", "/api/auth/login"): Gate("username and password; failures are counted per client address and username"),
    ("POST", "/api/auth/refresh"): Gate("a valid refresh cookie"),
    ("POST", "/api/auth/microsoft-login"): Gate(
        "the browser-bound login transaction (state + cookie, one use) and Microsoft's authorization code"
    ),
    ("POST", "/api/auth/logout"): Gate("public by design: ends the session of the cookies it is sent"),
    ("GET", "/api/auth/microsoft-config"): Gate(
        "public by design: whether Microsoft sign-in is configured, with the client ID, tenant ID and redirect URI"
    ),
    ("POST", "/api/auth/microsoft-start"): Gate("public by design: starts a login transaction, rate-limited"),
    ("POST", "/api/auth/local-login"): Gate("X-Local-Autologin secret from Caddy's loopback listener, 404 while off"),
    ("GET", "/api/setup/status"): Gate(
        "public by design: whether the board is claimed and whether the Einrichtungscode is asked for"
    ),
    ("POST", "/api/setup"): Gate("works once, on an unclaimed board, with the Einrichtungscode where required"),
    # --- Machines -------------------------------------------------------------------------
    ("POST", "/api/alarms"): WEBHOOK,
    ("POST", "/api/divera/webhook"): WEBHOOK,
    ("POST", "/api/firehub/webhook"): WEBHOOK,
    ("GET", "/api/print/config/"): PRINT_AGENT,
    ("GET", "/api/print/jobs/pending/"): PRINT_AGENT,
    ("PATCH", "/api/print/jobs/{job_id}/claim/"): PRINT_AGENT,
    ("PATCH", "/api/print/jobs/{job_id}/complete/"): PRINT_AGENT,
    ("POST", "/api/standby/sync"): STANDBY_BOX,
    ("POST", "/api/standby/photos/missing"): STANDBY_BOX,
    ("PUT", "/api/standby/photos/{incident_id}/{name}"): STANDBY_BOX,
    # --- Signed links ---------------------------------------------------------------------
    ("GET", "/api/personnel/check-in/list"): CHECKIN_READ,
    ("GET", "/api/personnel/check-in/stats"): CHECKIN_READ,
    ("POST", "/api/personnel/check-in/{personnel_id}/in"): CHECKIN_WRITE,
    ("POST", "/api/personnel/check-in/{personnel_id}/out"): CHECKIN_WRITE,
    ("PUT", "/api/personnel/check-in/{personnel_id}/plan"): CHECKIN_WRITE,
    ("GET", "/api/intake/context"): INTAKE,
    ("POST", "/api/intake/alarm"): INTAKE,
    ("GET", "/api/intake/alarm/{incident_id}"): INTAKE_RECEIPT,
    ("PUT", "/api/intake/alarm/{incident_id}"): INTAKE_RECEIPT,
    ("GET", "/api/viewer/data"): VIEWER,
    ("GET", "/api/weather/"): BOARD_OR_VIEWER,
    ("GET", "/api/reko/form"): REKO_TOKEN,
    ("POST", "/api/reko/{incident_id}/arrived"): REKO_TOKEN,
    ("GET", "/api/reko/{report_id}"): REKO_READ,
    ("POST", "/api/reko/"): REKO_WRITE,
    ("PATCH", "/api/reko/{report_id}"): REKO_WRITE,
    ("POST", "/api/reko/{incident_id}/photos"): REKO_WRITE,
    ("DELETE", "/api/reko/{incident_id}/photos/{filename}"): REKO_WRITE,
    ("GET", "/api/photos/{incident_id}/{filename}"): Gate(
        "Reko form token (its own report's photos), viewer link token (photos listed on a submitted "
        "Reko report of the token's Ereignis), or a session (`serve_photo`)"
    ),
    ("POST", "/api/reko/generate-link"): Gate("editor session, checked in the handler (`get_current_user`)"),
    # --- The field surface ----------------------------------------------------------------
    ("GET", "/api/feld/context"): FELD_ANY,
    ("POST", "/api/feld/logout"): FELD_DEVICE,
    ("POST", "/api/feld/unlock"): FELD_UNLOCK,
    ("POST", "/api/feld/claim"): FELD_PICKER,
    ("GET", "/api/feld/personnel"): FELD_PICKER,
    ("GET", "/api/feld/material"): FELD_DEVICE,
    ("GET", "/api/feld/duplicates"): FELD_DEVICE,
    ("GET", "/api/feld/assignments/{personnel_id}"): FELD_DEVICE,
    ("POST", "/api/feld/attendance/{personnel_id}"): FELD_DEVICE,
    ("PUT", "/api/feld/attendance/{personnel_id}/plan"): FELD_DEVICE,
    ("POST", "/api/feld/incidents"): FELD_DEVICE,
    ("POST", "/api/feld/incidents/{incident_id}/arrived"): FELD_DEVICE,
    ("POST", "/api/feld/incidents/{incident_id}/complete"): FELD_DEVICE,
    ("POST", "/api/feld/incidents/{incident_id}/message"): FELD_DEVICE,
    ("POST", "/api/feld/incidents/{incident_id}/pickup"): FELD_DEVICE,
    ("POST", "/api/feld/incidents/{incident_id}/reko-link"): FELD_DEVICE,
    ("PUT", "/api/feld/incidents/{incident_id}/report"): FELD_DEVICE,
    ("GET", "/api/feld/incidents/{incident_id}/rapport"): FELD_DEVICE,
    ("PUT", "/api/feld/incidents/{incident_id}/rapport"): FELD_DEVICE,
    ("POST", "/api/feld/incidents/{incident_id}/photos"): FELD_DEVICE,
    ("GET", "/api/feld/incidents/{incident_id}/photos/{filename}"): FELD_DEVICE,
    ("DELETE", "/api/feld/incidents/{incident_id}/photos/{filename}"): FELD_DEVICE,
    ("GET", "/api/geocoding/search"): GEOCODING,
    ("GET", "/api/geocoding/reverse"): GEOCODING,
    # --- Public by design -----------------------------------------------------------------
    ("GET", "/"): Gate("public by design: the project name"),
    ("GET", "/health"): Gate("public by design: liveness for the proxy and the uptime monitor"),
    ("GET", "/health/detailed"): Gate("404 in production; pool and component status elsewhere"),
    ("GET", "/api/deployment"): Gate(
        "public by design, for the band on the login screen: deployment role, its label, blocked domains"
    ),
    ("GET", "/api/demo/status"): Gate("public by design: whether this is the demo and when it resets"),
    ("GET", "/api/standby"): Gate(
        "public by design, for the band on the login screen: mirror state, Ereignis ids, who leads "
        "each, timestamps, pending and conflict counts – no incident content"
    ),
    ("GET", "/api/weather/radar/{key}.png"): Gate("public by design: MeteoSwiss's public radar frame"),
    ("POST", "/api/diag/client-error"): Gate(
        "public by design: rate-limited sink for browser errors; logged and buffered locally, "
        "forwarded as telemetry only with consent"
    ),
}

# Routes that are not API routes. FastAPI's docs exist outside production only (app/main.py);
# the Socket.IO mount checks the session itself (WS_REQUIRE_AUTH, websocket_manager.py).
NOT_API_ROUTES = {"/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc", "/socket.io"}


def _dependencies(dependant: Dependant) -> Iterator[Callable[..., object]]:
    """Every callable in a route's dependency tree."""
    for dependency in dependant.dependencies:
        if dependency.call is not None:
            yield dependency.call
        yield from _dependencies(dependency)


def _api_routes() -> dict[tuple[str, str], set[Callable[..., object]]]:
    """Each (method, path) registered on the app when the test runs, with its dependency callables."""
    registered = [
        ((method, route.path), set(_dependencies(route.dependant)))
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    ]
    # Two registrations of one method and path: the router serves the first, a dict keeps the last.
    keys = [key for key, _ in registered]
    assert len(keys) == len(set(keys)), sorted(key for key in set(keys) if keys.count(key) > 1)
    return dict(registered)


def test_every_route_needs_a_user_or_is_listed_with_its_gate() -> None:
    unlisted = sorted(
        key
        for key, dependencies in _api_routes().items()
        if get_current_user not in dependencies and key not in OPEN_ROUTES
    )
    assert not unlisted, (
        "These routes take no logged-in user and are not in OPEN_ROUTES. Give them CurrentUser / "
        f"CurrentEditor / CurrentAdmin, or list them with what guards them: {unlisted}"
    )


def test_a_listed_gate_is_really_on_its_route() -> None:
    routes = _api_routes()
    wrong = sorted(
        key
        for key, gate in OPEN_ROUTES.items()
        if key not in routes
        or get_current_user in routes[key]
        or (gate.dependency is not None and gate.dependency not in routes[key])
    )
    assert not wrong, f"OPEN_ROUTES names a route that is gone, now needs a user, or lost its gate dependency: {wrong}"


def test_nothing_else_is_mounted() -> None:
    other = sorted(getattr(route, "path", repr(route)) for route in app.routes if not isinstance(route, APIRoute))
    assert other == sorted(NOT_API_ROUTES)
