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

The same module also answers "what is this deployment FOR?" — see ``deployment_role()``. That
is a second, independent axis: `ENVIRONMENT` says how hardened we are, `DEPLOYMENT_ROLE` says
whether effects may leave the building.
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


# --------------------------------------------------------------------------------------
# Deployment role — what this instance is allowed to do to the outside world.
# --------------------------------------------------------------------------------------
#
# A staging instance starts life as a 1:1 copy of the production DATABASE. That is the whole
# reason this lives in the environment and NOT in the settings store: `alerting.enabled` and
# `railway_database_url` arrive in the copy carrying production's values, so a settings-based
# switch would ship pre-disarmed straight back into "yes, alarm people". Restore the dump again
# and it re-arms. Somebody tidying Einstellungen re-arms it. There is no value we could write
# into the copied table that the next copy would not overwrite.
#
# So: do NOT "simplify" this into a setting, a feature flag row, or a column. The lock has to
# live in the one place the dump cannot reach — the process environment of the instance itself.
#
# Direction of the lock: this is a one-way ratchet. `production` (the default) is the ordinary
# deployment and blocks nothing; a recognised non-production role only ever ADDS refusals. No
# value of DEPLOYMENT_ROLE can unlock anything — there is deliberately no role that relaxes a
# production check.
#
# Three cases, and the difference between the first and the third is the whole point:
#
#   unset / empty     -> production. Nobody made a claim, so the safe default applies. Every
#                        existing deployment sets nothing and must keep working untouched.
#   production/staging-> as declared.
#   anything else     -> REFUSE TO START. Somebody meant something specific and we cannot tell
#                        what. The one interpretation we must not quietly pick is the one that
#                        unlocks everything: `DEPLOYMENT_ROLE=stagging` on a test box is exactly
#                        how a warning in a log nobody reads becomes a test system that can
#                        alarm the station.
#
# Refusing to boot is cheap here. It happens on a deploy, not at 02:00 during an incident, and
# the platform shows a failed deploy instead of a running lie. A failed deploy costs minutes; a
# silently-production staging costs a callout.

ROLE_PRODUCTION = "production"
ROLE_STAGING = "staging"

#: Roles this build understands. Anything else falls back to ROLE_PRODUCTION.
KNOWN_DEPLOYMENT_ROLES = (ROLE_PRODUCTION, ROLE_STAGING)

#: Effect domains a role refuses. Only domains whose effect LEAVES this system belong here —
#: printing, Traccar reads and inbound alarms are wanted on staging and are deliberately absent.
_ROLE_BLOCKED_DOMAINS: dict[str, tuple[str, ...]] = {
    ROLE_STAGING: ("alerting", "sync"),
}

#: German, because it is shown to operators and returned in API error details.
_ROLE_LABELS = {ROLE_STAGING: "Staging – Übungssystem"}

_DOMAIN_REASONS = {
    "alerting": "Ausalarmierung ist auf diesem System gesperrt",
    "sync": "Datenabgleich mit einem anderen System ist auf diesem System gesperrt",
}


class DeploymentRoleError(RuntimeError):
    """DEPLOYMENT_ROLE is set to something this build does not understand.

    Raised at startup, so it is met in a deploy log rather than in the middle of an operation.
    The message is written to be readable there: it names the value it got and the values it
    accepts, on one line each, with no traceback needed to understand it.
    """


def deployment_role() -> str:
    """What this deployment is for: ``production`` (default) or ``staging``.

    Unset or empty means production — nobody claimed anything, so the safe default applies.
    Case and surrounding whitespace are ignored, so ``Staging`` and `` staging `` still lock.

    A value that is set but unrecognised raises :class:`DeploymentRoleError` instead of falling
    back to production. Falling back would mean answering a claim we could not read with the
    single interpretation that unlocks everything — see the note above.
    """
    raw = os.getenv("DEPLOYMENT_ROLE", "").strip()
    if not raw:
        return ROLE_PRODUCTION
    if raw.lower() in KNOWN_DEPLOYMENT_ROLES:
        return raw.lower()
    raise DeploymentRoleError(
        f"DEPLOYMENT_ROLE is set to {raw!r}, which is not a deployment role this build knows.\n"
        f"Valid values: {', '.join(KNOWN_DEPLOYMENT_ROLES)} (case-insensitive). "
        f"Leave it unset for an ordinary production deployment.\n"
        "Refusing to start: a role we cannot read must not be guessed as 'production', because "
        "that is the reading that lifts every lock."
    )


def blocked_domains() -> tuple[str, ...]:
    """Effect domains this deployment role refuses. Empty for production."""
    return _ROLE_BLOCKED_DOMAINS.get(deployment_role(), ())


def is_domain_blocked(domain: str) -> bool:
    """True when the deployment role refuses this effect domain outright."""
    return domain in blocked_domains()


def deployment_role_label() -> str | None:
    """Short German label for a non-production role, for UI and error text. None otherwise."""
    return _ROLE_LABELS.get(deployment_role())


def blocked_reason(domain: str) -> str | None:
    """German sentence naming why a domain is refused, or None when it is allowed."""
    if not is_domain_blocked(domain):
        return None
    label = deployment_role_label()
    reason = _DOMAIN_REASONS.get(domain, f"„{domain}“ ist auf diesem System gesperrt")
    return f"{reason} ({label})." if label else f"{reason}."
