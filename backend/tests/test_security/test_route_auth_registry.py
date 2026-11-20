"""Every route needs a logged-in user, or it is on the list in this file with its gate.

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


FELD = Gate("Feld token: poster, person picker or device claim", require_feld_claims)
PRINT_AGENT = Gate("X-Agent-Token = PRINT_AGENT_TOKEN, 403 while the token is unset", require_print_agent)
GEOCODING = Gate("session, or a live person-bound Feld claim", require_geocoding_access)
BOARD_OR_VIEWER = Gate("session, or a viewer link token", require_board_or_viewer_token)
WEBHOOK = Gate("shared webhook secret (`check_webhook_secret`), refused while no secret exists")
STANDBY_BOX = Gate("Bearer STANDBY_SYNC_TOKEN (`_require_box`), 404 while the token is unset")
CHECKIN = Gate("check-in link token, or a session with `event_id` (`_resolve_event_and_actor`)")
REKO = Gate("Reko form token, or a session (`_require_user_or_form_token`, `_require_form_token`)")
INTAKE = Gate("alarm intake link token (`validate_alarm_token`)")
VIEWER = Gate("viewer link token (`validate_viewer_token`)")
SESSION_BEGINS = Gate("public by design: a session starts, renews or ends here")

OPEN_ROUTES: dict[tuple[str, str], Gate] = {
    # --- Sign-in --------------------------------------------------------------------------
    ("POST", "/api/auth/login"): SESSION_BEGINS,
    ("POST", "/api/auth/refresh"): SESSION_BEGINS,
    ("POST", "/api/auth/logout"): SESSION_BEGINS,
    ("GET", "/api/auth/microsoft-config"): SESSION_BEGINS,
    ("POST", "/api/auth/microsoft-start"): SESSION_BEGINS,
    ("POST", "/api/auth/microsoft-login"): SESSION_BEGINS,
    ("POST", "/api/auth/local-login"): Gate("X-Local-Autologin secret from Caddy's loopback listener, 404 while off"),
    ("GET", "/api/setup/status"): Gate("public by design: says only whether the board is claimed"),
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
    ("GET", "/api/personnel/check-in/list"): CHECKIN,
    ("GET", "/api/personnel/check-in/stats"): CHECKIN,
    ("POST", "/api/personnel/check-in/{personnel_id}/in"): CHECKIN,
    ("POST", "/api/personnel/check-in/{personnel_id}/out"): CHECKIN,
    ("PUT", "/api/personnel/check-in/{personnel_id}/plan"): CHECKIN,
    ("GET", "/api/intake/context"): INTAKE,
    ("POST", "/api/intake/alarm"): INTAKE,
    ("GET", "/api/intake/alarm/{incident_id}"): INTAKE,
    ("PUT", "/api/intake/alarm/{incident_id}"): INTAKE,
    ("GET", "/api/viewer/data"): VIEWER,
    ("GET", "/api/weather/"): BOARD_OR_VIEWER,
    ("GET", "/api/reko/form"): REKO,
    ("POST", "/api/reko/"): REKO,
    ("GET", "/api/reko/{report_id}"): REKO,
    ("PATCH", "/api/reko/{report_id}"): REKO,
    ("POST", "/api/reko/{incident_id}/arrived"): REKO,
    ("POST", "/api/reko/{incident_id}/photos"): REKO,
    ("DELETE", "/api/reko/{incident_id}/photos/{filename}"): REKO,
    ("GET", "/api/photos/{incident_id}/{filename}"): Gate(
        "Reko form token (its own report's photos), viewer link token, or a session (`serve_photo`)"
    ),
    ("POST", "/api/reko/generate-link"): Gate("editor session, checked in the handler (`get_current_user`)"),
    # --- The field surface ----------------------------------------------------------------
    ("POST", "/api/feld/unlock"): FELD,
    ("POST", "/api/feld/claim"): FELD,
    ("POST", "/api/feld/logout"): FELD,
    ("GET", "/api/feld/context"): FELD,
    ("GET", "/api/feld/personnel"): FELD,
    ("GET", "/api/feld/material"): FELD,
    ("GET", "/api/feld/duplicates"): FELD,
    ("GET", "/api/feld/assignments/{personnel_id}"): FELD,
    ("POST", "/api/feld/attendance/{personnel_id}"): FELD,
    ("PUT", "/api/feld/attendance/{personnel_id}/plan"): FELD,
    ("POST", "/api/feld/incidents"): FELD,
    ("POST", "/api/feld/incidents/{incident_id}/arrived"): FELD,
    ("POST", "/api/feld/incidents/{incident_id}/complete"): FELD,
    ("POST", "/api/feld/incidents/{incident_id}/message"): FELD,
    ("POST", "/api/feld/incidents/{incident_id}/pickup"): FELD,
    ("POST", "/api/feld/incidents/{incident_id}/reko-link"): FELD,
    ("PUT", "/api/feld/incidents/{incident_id}/report"): FELD,
    ("GET", "/api/feld/incidents/{incident_id}/rapport"): FELD,
    ("PUT", "/api/feld/incidents/{incident_id}/rapport"): FELD,
    ("POST", "/api/feld/incidents/{incident_id}/photos"): FELD,
    ("GET", "/api/feld/incidents/{incident_id}/photos/{filename}"): FELD,
    ("DELETE", "/api/feld/incidents/{incident_id}/photos/{filename}"): FELD,
    ("GET", "/api/geocoding/search"): GEOCODING,
    ("GET", "/api/geocoding/reverse"): GEOCODING,
    # --- Public by design -----------------------------------------------------------------
    ("GET", "/"): Gate("public by design: the project name"),
    ("GET", "/health"): Gate("public by design: liveness for the proxy and the uptime monitor"),
    ("GET", "/health/detailed"): Gate("404 in production; pool and component status elsewhere"),
    ("GET", "/api/deployment"): Gate("public by design: version and deployment role for the login screen"),
    ("GET", "/api/demo/status"): Gate("public by design: whether this is the demo and when it resets"),
    ("GET", "/api/standby"): Gate("public by design: mirror state for the band on the login screen, no content"),
    ("GET", "/api/weather/radar/{key}.png"): Gate("public by design: MeteoSwiss's public radar frame"),
    ("POST", "/api/diag/client-error"): Gate("public by design: rate-limited sink for browser errors, logs only"),
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
    """Each (method, path) of the app with its dependency callables."""
    return {
        (method, route.path): set(_dependencies(route.dependant))
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }


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
    other = {getattr(route, "path", repr(route)) for route in app.routes if not isinstance(route, APIRoute)}
    assert other == NOT_API_ROUTES
