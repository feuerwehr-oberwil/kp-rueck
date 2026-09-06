"""Idempotent account bootstrap that runs on every deploy (after migrations/seed).

`seed.py` only creates accounts on a *fresh* database; on an already-seeded
production DB it returns early, so newly added shared accounts (like the read-only
`viewer`) never get created there. This module ensures the shared `viewer` account
exists and that its password matches the `VIEWER_PASSWORD` env var, so the
read-only kiosk login works in production and its password can be rotated by
changing the env var and redeploying.

It is a no-op unless `VIEWER_PASSWORD` is set, so it never creates a weak
default-password account by accident.

Note the asymmetry with `admin`, which surprises people: `ADMIN_SEED_PASSWORD` applies once,
when the database is created, and the docs tell you to change it in the app afterwards.
`VIEWER_PASSWORD` is re-applied on EVERY boot, so the env var – not the app – is the source of
truth for the viewer login. Changing it in the UI is reverted at the next restart, which is why
docs/SETUP.md §2 now says to rotate it in `.env`. That is documented, not accidental: the
viewer account is what wall displays log in with, and a station that has lost the password
needs a way back in that does not involve SQL.
"""

import asyncio
import os
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .auth.config import auth_settings
from .auth.security import hash_password, verify_password
from .database import async_session_maker


async def ensure_viewer_account() -> None:
    viewer_password = os.getenv("VIEWER_PASSWORD")
    if not viewer_password:
        print("VIEWER_PASSWORD not set – leaving viewer account unchanged")
        return

    # seed.py enforces this on a fresh database; this path did not, so a VIEWER_PASSWORD
    # shortened after the first boot was accepted silently – against what .env.example
    # promises. Refuse it, but do NOT raise: this runs on every boot, and taking the whole
    # board down over the read-only kiosk password is the worse failure of the two.
    minimum_length = max(12, auth_settings.MIN_PASSWORD_LENGTH)
    if len(viewer_password) < minimum_length:
        print(
            f"VIEWER_PASSWORD is {len(viewer_password)} characters – at least {minimum_length} are required. "
            "Leaving the viewer account unchanged; fix it in .env and restart."
        )
        return

    if len(viewer_password) > auth_settings.MAX_PASSWORD_LENGTH or len(viewer_password.encode("utf-8")) > 72:
        print(
            "VIEWER_PASSWORD exceeds the configured length or bcrypt byte limit. Leaving the viewer account unchanged."
        )
        return

    async with async_session_maker() as db:
        result = await db.execute(select(models.User).where(models.User.username == "viewer").with_for_update())
        viewer = result.scalar_one_or_none()

        if viewer is None:
            db.add(
                models.User(
                    id=uuid4(),
                    username="viewer",
                    password_hash=hash_password(viewer_password),
                    role="viewer",
                    display_name="Betrachter",
                    is_active=True,
                )
            )
            print("Created read-only viewer account from VIEWER_PASSWORD")
        else:
            # A salted hash changes even for the same password. Compare the
            # password itself so ordinary restarts preserve existing sessions.
            try:
                unchanged = viewer.password_hash is not None and verify_password(viewer_password, viewer.password_hash)
            except ValueError:
                unchanged = False  # Replace an unusable legacy hash.
            if not unchanged:
                await db.execute(
                    update(models.User)
                    .where(models.User.id == viewer.id)
                    .values(
                        password_hash=hash_password(viewer_password),
                        session_version=models.User.session_version + 1,
                    )
                )
            # The environment remains authoritative for role and active state.
            viewer.role = "viewer"
            viewer.is_active = True
            print("Synced viewer account from VIEWER_PASSWORD" + (" (password unchanged)" if unchanged else ""))

        await db.commit()


def main() -> None:
    asyncio.run(ensure_viewer_account())


if __name__ == "__main__":
    main()


# Fixed id of the development auth-bypass user (see auth/dependencies.py). The
# bypass builds this User in memory; the row below is what lets writes that
# reference it (assigned_by, dismissed_by, audit_log.user_id) satisfy their
# foreign keys.
DEV_BYPASS_USER_ID = UUID("00000000-0000-0000-0000-000000000000")


async def ensure_dev_bypass_user(db: AsyncSession) -> None:
    """Create the row behind the development bypass user, idempotently.

    Only ever called when auth bypass is active, which is impossible in
    production. The password hash is deliberately unusable: this account is not
    meant to be logged into, it exists so foreign keys resolve.
    """
    existing = await db.execute(select(models.User).where(models.User.id == DEV_BYPASS_USER_ID))
    if existing.scalars().first():
        return

    db.add(
        models.User(
            id=DEV_BYPASS_USER_ID,
            username="dev-user",
            password_hash="!",  # noqa: S106 – sentinel, never matches a bcrypt verify
            role="admin",
            display_name="Development User",
            is_active=True,
        )
    )
    await db.commit()
