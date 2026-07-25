"""One answer to "are we in production?", shared by every module that hardens on it.

This used to be `os.getenv("RAILWAY_ENVIRONMENT") is not None`, repeated in six modules. That
was correct while Railway was the only deployment — but a self-hosted docker-compose stack sets
none of the Railway variables, so it would silently run with development defaults on a machine
facing the internet: a per-restart SECRET_KEY, a randomly generated admin password, a shared
`editor/editor` login, sample incidents seeded onto a real board.

So production is now declared explicitly with `ENVIRONMENT=production` (what docker-compose
sets), and the Railway indicators are kept as a fallback so existing deployments keep working
without a variable change. Fail-safe direction: when in doubt this returns False, which only
ever makes the app REFUSE weak configuration — the checks that use it raise on a missing secret
rather than granting anything.
"""

import os

# Railway sets these automatically; any one of them means we're on Railway.
_RAILWAY_INDICATORS = (
    "RAILWAY_ENVIRONMENT",
    "RAILWAY_PROJECT_ID",
    "RAILWAY_SERVICE_ID",
    "RAILWAY_STATIC_URL",
    "RAILWAY_PUBLIC_DOMAIN",
)


def is_production_environment() -> bool:
    """True when this process is serving a real deployment rather than a dev machine."""
    if os.getenv("ENVIRONMENT", "").strip().lower() == "production":
        return True
    return any(os.getenv(name) is not None for name in _RAILWAY_INDICATORS)
