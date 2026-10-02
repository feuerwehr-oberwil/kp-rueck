"""The Einrichtungscode: an optional one-time secret for claiming an unclaimed board.

Why it exists (2026-09-23): an unclaimed production board is claimed by whoever reaches
``POST /api/setup`` first (api/setup.py). On a LAN in the Gerätehaus that is the person who
just double-clicked the launcher, and the model is fine. On a board with a public domain it is
a race between the operator and every scanner on the internet – a fresh certificate lands in
the Certificate Transparency logs within minutes, and those logs are watched precisely for
freshly installed web apps that are still waiting for their first admin.

So when a token is required, the backend holds one, prints it into the container log, and the
claim has to quote it. Reading the log proves you operate the box; being first no longer does.

**When it is required** – ``setup_token_required()``:

* ``SETUP_TOKEN_REQUIRED=true|false`` decides outright when set.
* Otherwise a ``SETUP_TOKEN`` value implies it: somebody who set one means it to be asked for.
* Otherwise it is required when the deployment looks internet-facing
  (``is_internet_facing``): a production environment with a ``DOMAIN`` (Caddy with a public
  certificate), on Railway (always a public URL), or with any ``https://`` CORS origin (TLS in
  front of it by somebody's hand). A LAN install – ``ENVIRONMENT=production``, no domain,
  plain-http origins, the double-click path – stays first-visit-claims, because there the
  operator is the one at the browser and a code in a log is only one more thing to go wrong.
  Development never requires it.

**The token itself** is ``SETUP_TOKEN`` when set, else 16 random characters from an alphabet
without look-alikes (about 79 bits), shown in groups of four. Compared in constant time after
normalising both sides (case, spaces and dashes do not count – it is copied out of a log by a
human). In memory only: the backend is one process (start.sh runs a single uvicorn worker), and
a restart simply prints a fresh one. It stops being accepted the moment a claim succeeds.
"""

import logging
import secrets

from ..config import settings
from ..environment import is_production_environment, is_railway
from .login_throttle import LoginThrottle

logger = logging.getLogger(__name__)

#: No 0/O, 1/I/L – it is typed from a terminal into a browser.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_LENGTH = 16

_token: str | None = None
_consumed = False

#: Wrong codes per client address, the same failure throttle the login form uses. At 79 bits
#: guessing is hopeless anyway; this keeps a scanner from hammering the route regardless, and
#: it is what "rate-limited like login" means here – slowapi's per-IP LOGIN ceiling on the route
#: counts every attempt, this counts the failures.
setup_token_throttle = LoginThrottle()
THROTTLE_SCOPE = "setup-token"


def _normalise(value: str) -> str:
    return "".join(ch for ch in value.upper() if ch.isalnum())


def _generate() -> str:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(_LENGTH))
    return "-".join(raw[i : i + 4] for i in range(0, _LENGTH, 4))


def is_internet_facing() -> bool:
    """Does this deployment look reachable from the internet? See the module docstring."""
    if not is_production_environment():
        return False
    if settings.domain.strip() or is_railway():
        return True
    origins = settings.cors_origins if isinstance(settings.cors_origins, list) else [settings.cors_origins]
    return any(origin.strip().lower().startswith("https://") for origin in origins)


def setup_token_required() -> bool:
    """Whether a claim must quote the Einrichtungscode (explicit setting, else inferred)."""
    if settings.setup_token_required is not None:
        return settings.setup_token_required
    return bool(_normalise(settings.setup_token)) or is_internet_facing()


def current_token() -> str:
    """The token, created – and announced in the log – on first use."""
    global _token
    if _token is None:
        configured = settings.setup_token.strip()
        if _normalise(configured):
            _token = configured
            _announce(from_env=True)
        else:
            _token = _generate()
            _announce(from_env=False)
    return _token


def _announce(*, from_env: bool) -> None:
    # A banner, because it is read by somebody scrolling `docker compose logs backend` or the
    # Railway deploy log for the one line that matters. The German word is what the setup page
    # asks for, so a search for it lands here. A token that came from SETUP_TOKEN is NOT
    # printed: the operator already has it, and it would then sit in every log archive too.
    line = "=" * 64
    code = "(der Wert von SETUP_TOKEN)" if from_env else _token
    lifetime = (
        "Er gilt bis zur Einrichtung." if from_env else "Er gilt bis zur Einrichtung; ein Neustart erzeugt einen neuen."
    )
    logger.warning(
        "\n%s\n  Einrichtungscode für /setup: %s\n"
        "  Das Board ist noch nicht eingerichtet. Wer es einrichtet, braucht diesen Code.\n"
        "  %s\n%s",
        line,
        code,
        lifetime,
        line,
    )


def matches(submitted: str | None) -> bool:
    """Constant-time check of a submitted code. Always False once a claim has succeeded."""
    if _consumed or not submitted:
        return False
    expected = _normalise(current_token()).encode()
    return secrets.compare_digest(_normalise(submitted).encode(), expected)


def invalidate() -> None:
    """The board is claimed: this code opens nothing any more, not even until the restart."""
    global _token, _consumed
    _token = None
    _consumed = True


async def reset_for_tests() -> None:
    """Forget the token and the throttle (tests only)."""
    global _token, _consumed
    _token = None
    _consumed = False
    await setup_token_throttle.reset()
