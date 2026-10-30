"""Passwordless local login for the machine the board runs on – off unless configured.

The station notebook stands in the command post and is opened by whoever is on duty; typing a
password on it buys nothing, because anybody who can reach its keyboard has already won. Every
other client – LAN, Tailscale, a phone – must still sign in normally.

**The trust boundary is a loopback-bound port, not this file.** `docker-compose.yml` publishes
Caddy's second listener on `127.0.0.1:${LOCAL_PORT:-8081}` only, so nothing but the host itself
can open a connection to it, and that listener stamps `X-Local-Autologin` onto every upstream
request (`deploy/Caddyfile`). The public `:80` site DELETES the same header, so a LAN client
cannot forge it. The shared secret checked here is the second half of that: it means a request
carrying the header really came through the loopback listener of THIS deployment, and not from
some other container that can reach the backend on the compose network.

What this deliberately is not: a way to skip authentication. The endpoint issues the ordinary
session cookies for one ordinary account, which the backend then treats exactly as if that
person had typed their password – same role, same audit trail, same expiry.
"""

import hmac
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import User

logger = logging.getLogger(__name__)

#: The header Caddy's loopback listener sets and the public site strips. Named in
#: `deploy/Caddyfile` on both sides – change it in all three places or not at all.
HEADER_NAME = "X-Local-Autologin"


def is_enabled() -> bool:
    """Whether passwordless local login exists on this deployment.

    Both settings filled = on. Empty (the default) = off, and `POST /api/auth/local-login`
    answers 404 as if it had never been written. `Settings.validate_local_autologin` already
    refused the half-configured case at startup.
    """
    return bool(settings.local_autologin_user.strip() and settings.local_autologin_secret.strip())


def secret_matches(presented: str | None) -> bool:
    """Constant-time comparison of a request's header against the configured secret.

    Encoded to bytes first: `compare_digest` raises on non-ASCII `str` inputs, and a secret
    pasted in from somewhere unhelpful should be a 403, not a 500.
    """
    if not presented or not is_enabled():
        return False
    return hmac.compare_digest(presented.encode("utf-8"), settings.local_autologin_secret.strip().encode("utf-8"))


async def load_account(db: AsyncSession) -> User | None:
    """The configured `LOCAL_AUTOLOGIN_USER`, or None when there is no such account."""
    if not is_enabled():
        return None
    result = await db.execute(select(User).where(User.username == settings.local_autologin_user.strip()))
    return result.scalar_one_or_none()


async def verify_account_on_boot(db: AsyncSession) -> None:
    """Refuse the boot on a `LOCAL_AUTOLOGIN_USER` that cannot safely be logged in as.

    Checked here rather than on the first request because both failures are configuration
    mistakes that must be visible while the operator is still watching the terminal – a
    station that discovers them by clicking the shortcut gets a login form and no reason.

    Raises:
        RuntimeError: the account does not exist, is deactivated, or is an admin.
    """
    if not is_enabled():
        return

    username = settings.local_autologin_user.strip()
    user = await load_account(db)

    if user is None:
        raise RuntimeError(
            f"LOCAL_AUTOLOGIN_USER={username!r} does not exist. Create that account (an editor, "
            "not an admin) or clear LOCAL_AUTOLOGIN_USER and LOCAL_AUTOLOGIN_SECRET."
        )
    if user.role == "admin":
        raise RuntimeError(
            f"LOCAL_AUTOLOGIN_USER={username!r} is an admin. A browser left open on the station "
            "desk must not be able to manage users, change roles or read the audit log – point "
            "this at an editor account instead."
        )
    if not user.is_active:
        raise RuntimeError(
            f"LOCAL_AUTOLOGIN_USER={username!r} is deactivated, so the station would get a login "
            "form with no explanation. Re-activate the account or clear the two settings."
        )

    logger.info("Passwordless local login is ON for %r (role: %s)", username, user.role)
