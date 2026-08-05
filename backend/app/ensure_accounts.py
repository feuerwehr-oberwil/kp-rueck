"""Idempotent account bootstrap that runs on every deploy (after migrations/seed).

`seed.py` only creates accounts on a *fresh* database; on an already-seeded
production DB it returns early, so newly added shared accounts (like the read-only
`viewer`) never get created there. This module ensures the shared `viewer` account
exists and that its password matches the `VIEWER_PASSWORD` env var, so the
read-only kiosk login works in production and its password can be rotated by
changing the env var and redeploying.

It is a no-op unless `VIEWER_PASSWORD` is set, so it never creates a weak
default-password account by accident.
"""

import asyncio
import os
from uuid import UUID, uuid4

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .database import async_session_maker


async def ensure_viewer_account() -> None:
    viewer_password = os.getenv("VIEWER_PASSWORD")
    if not viewer_password:
        print("VIEWER_PASSWORD not set — leaving viewer account unchanged")
        return

    password_hash = bcrypt.hashpw(viewer_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    async with async_session_maker() as db:
        result = await db.execute(select(models.User).where(models.User.username == "viewer"))
        viewer = result.scalar_one_or_none()

        if viewer is None:
            db.add(
                models.User(
                    id=uuid4(),
                    username="viewer",
                    password_hash=password_hash,
                    role="viewer",
                    display_name="Betrachter",
                    is_active=True,
                )
            )
            print("Created read-only viewer account from VIEWER_PASSWORD")
        else:
            # Env var is the source of truth — keep the account read-only + active
            # and sync its password so it can be rotated via a redeploy.
            viewer.password_hash = password_hash
            viewer.role = "viewer"
            viewer.is_active = True
            print("Synced viewer account password/role from VIEWER_PASSWORD")

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
            password_hash="!",  # noqa: S106 — sentinel, never matches a bcrypt verify
            role="admin",
            display_name="Development User",
            is_active=True,
        )
    )
    await db.commit()
