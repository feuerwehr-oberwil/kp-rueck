"""Keep socket admission and delivery tied to a live, revocable login session."""

import math
import time
from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie
from uuid import UUID

import jwt
from sqlalchemy import select

from app.database import async_session_maker
from app.models import RevokedToken, User

from .config import auth_settings
from .security import decode_token, session_family


@dataclass(frozen=True)
class SocketIdentity:
    user_id: UUID
    jti: str
    session_jti: str
    expires_at: float
    family_jti: str
    user_session_version: int = 0


def socket_identity(token: str, credential_kind: str) -> SocketIdentity | None:
    """Validate the handshake, retaining the parent session's revocation and expiry."""
    try:
        payload = decode_token(token)
        if payload.get("type") != credential_kind:
            return None
        family = session_family(payload)
        if family is None:
            # Only a credential with a revocable family may open a socket.
            return None
        user_id = UUID(payload["sub"])
        jti = payload["jti"]
        session_jti = payload["session_jti"] if credential_kind == "ws" else jti
        expiry = payload["session_exp"] if credential_kind == "ws" else payload["exp"]
        if not isinstance(jti, str) or not jti or not isinstance(session_jti, str) or not session_jti:
            return None
        if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or not math.isfinite(expiry):
            return None
        if expiry <= time.time():
            return None
        return SocketIdentity(
            user_id,
            jti,
            session_jti,
            min(float(expiry), family.expires_at),
            family.jti,
            payload["user_session_version"],
        )
    except (jwt.PyJWTError, KeyError, TypeError, ValueError, AttributeError):
        return None


def cookie_identity(cookie_header: str) -> SocketIdentity | None:
    try:
        cookies = SimpleCookie()
        cookies.load(cookie_header)
        token = cookies.get("access_token")
        return socket_identity(token.value, "access") if token else None
    except CookieError:
        return None


async def current_socket_roles(identities: list[SocketIdentity]) -> dict[SocketIdentity, str]:
    """Recheck all recipients in two queries before sending operational data."""
    live = [identity for identity in identities if identity.expires_at > time.time()]
    if not live:
        return {}
    async with async_session_maker() as db:
        rows = await db.execute(
            select(User.id, User.role, User.session_version).where(
                User.id.in_({i.user_id for i in live}), User.is_active
            )
        )
        users = {user_id: (role, version) for user_id, role, version in rows.tuples()}
        revoked = set(
            (
                await db.scalars(
                    select(RevokedToken.jti).where(
                        RevokedToken.jti.in_({j for i in live for j in (i.jti, i.session_jti, i.family_jti)})
                    )
                )
            ).all()
        )
    if auth_settings.is_auth_bypassed:
        users[UUID(int=0)] = ("admin", 0)
    return {
        identity: users[identity.user_id][0]
        for identity in live
        if identity.user_id in users
        and identity.user_session_version == users[identity.user_id][1]
        and not ({identity.jti, identity.session_jti, identity.family_jti} & revoked)
    }
