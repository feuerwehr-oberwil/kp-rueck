"""First-run setup: claiming an UNCLAIMED production board from the browser.

A production deployment without ADMIN_SEED_PASSWORD seeds settings but no user
accounts (see seed_database). This router is how such a board becomes usable:
the first visitor submits a station name and an admin password, and gets the
same account set the env-var seed path would have created.

Both endpoints are UNAUTHENTICATED **by design**, not by oversight: they must
work while the users table is empty, i.e. before any login can exist. Being
first IS the authentication — the first-visit-claims model, decided by the
maintainer. The claim endpoint dies after the first success (409 forever
after), so it grants nothing on any board that already has accounts; brute
force is moot for the same reason. Auth in this app is per-route dependencies,
not middleware, so simply taking none is what keeps these reachable.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Setting, User
from ..seed import production_account_set
from ..services.audit import log_action

router = APIRouter(prefix="/setup", tags=["setup"])


async def _is_claimed(db: AsyncSession) -> bool:
    """Claimed = at least one user account exists. One indexed row, no count."""
    result = await db.execute(select(User.id).limit(1))
    return result.scalar_one_or_none() is not None


@router.get("/status", response_model=schemas.SetupStatusResponse)
async def get_setup_status(db: AsyncSession = Depends(get_db)) -> schemas.SetupStatusResponse:
    """Whether this board has been claimed. The frontend polls this on first load."""
    return schemas.SetupStatusResponse(claimed=await _is_claimed(db))


@router.post(
    "",
    response_model=schemas.SetupClaimResponse,
    status_code=status.HTTP_201_CREATED,
)
# Brute force is moot (the endpoint 409s forever after the first success), but
# it is still a public write route that accepts a password, and the coverage
# test in tests/test_middleware/test_rate_limit_enforced.py rightly refuses to
# ship one of those uncapped. The LOGIN limit fits: legitimately hit once per
# deployment lifetime, from one browser.
@limiter.limit(RateLimits.LOGIN)
async def claim_board(
    body: schemas.SetupClaimRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> schemas.SetupClaimResponse:
    """Claim an unclaimed board: create the production account set, name the station.

    Creates exactly what the ADMIN_SEED_PASSWORD seed path creates
    (production_account_set: dev-user bypass row, admin, read-only viewer) —
    except the admin gets the submitted password and the viewer a random one
    the admin resets later in the Einstellungen. The random viewer password is
    deliberately NOT returned anywhere.

    Race-safe without a lock: two simultaneous claims both pass the cheap
    check below, but users.username is unique, so the second INSERT fails and
    that claimer gets the same 409 a late visitor gets.
    """
    if await _is_claimed(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Das System ist bereits eingerichtet.",
        )

    users = production_account_set(body.admin_password, secrets.token_urlsafe(24))
    admin_user = next(user for user in users if user.username == "admin")
    for user in users:
        db.add(user)

    try:
        # Flush now so a lost race surfaces HERE as the unique-constraint
        # violation, before we touch the settings row.
        await db.flush()

        # Station identity: the unclaimed seed wrote the «Musterstadt»
        # placeholder into this row; the claim replaces it with the real name.
        result = await db.execute(select(Setting).where(Setting.key == "firestation_name"))
        name_setting = result.scalar_one_or_none()
        if name_setting:
            name_setting.value = body.station_name
            name_setting.updated_by = admin_user.id
        else:
            db.add(Setting(key="firestation_name", value=body.station_name, updated_by=admin_user.id))

        # Audit the claim like other admin actions — the password is stripped
        # by log_action's sanitizer, but simply never passing it is better.
        await log_action(
            db=db,
            action_type="setup_claim",
            resource_type="system",
            user=admin_user,
            changes={"station_name": body.station_name, "accounts": [user.username for user in users]},
            request=request,
        )

        await db.commit()
    except IntegrityError:
        # A concurrent claim won the users.username (or fixed dev-user id)
        # unique constraint. Exactly one winner; this caller lost.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Das System ist bereits eingerichtet.",
        ) from None

    return schemas.SetupClaimResponse(username="admin")
