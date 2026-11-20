"""The routes the app serves, for tests that check every route.

Do not write `for route in app.routes`. Since FastAPI 0.163 an included router is ONE entry
there and its routes are resolved on demand, so that loop sees four docs routes and nothing of
the API – and a test built on it passes with nothing checked. `iter_route_contexts` is
FastAPI's own walk: each context has the full `path`, `methods`, `endpoint` and `dependant`.
"""

from fastapi.routing import RouteContext, iter_route_contexts

from app.main import app


def served_routes() -> list[RouteContext]:
    """Every route of the running app: API routes with their include prefix, docs, mounts."""
    routes = list(iter_route_contexts(app.routes))
    # The guard for the next change of this kind: an app without API routes is a broken walk.
    assert sum(1 for route in routes if (route.path or "").startswith("/api/")) > 100, "route walk found no API"
    return routes
