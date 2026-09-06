"""Viewer environment rotation revokes sessions without logging out unchanged boots."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app import ensure_accounts
from app.auth.security import hash_password, verify_password
from app.models import User

OLD_PASSWORD = "viewer-original-password"
NEW_PASSWORD = "viewer-rotated-password"


@pytest.fixture
def viewer_store(session_factory, monkeypatch):
    monkeypatch.setattr(ensure_accounts, "async_session_maker", session_factory)
    return session_factory


@pytest.mark.parametrize("password", [OLD_PASSWORD, NEW_PASSWORD, "short", "ä" * 37])
async def test_viewer_password_sync_changes_epoch_only_for_valid_rotation(viewer_store, monkeypatch, password):
    original_hash = hash_password(OLD_PASSWORD)
    async with viewer_store() as db:
        db.add(
            User(
                username="viewer",
                password_hash=original_hash,
                role="editor",
                is_active=False,
                session_version=7,
            )
        )
        await db.commit()
    monkeypatch.setenv("VIEWER_PASSWORD", password)

    await ensure_accounts.ensure_viewer_account()

    async with viewer_store() as db:
        viewer = await db.scalar(select(User).where(User.username == "viewer"))
        assert viewer is not None
        rotated = password == NEW_PASSWORD
        assert viewer.session_version == (8 if rotated else 7)
        if rotated:
            assert verify_password(NEW_PASSWORD, viewer.password_hash)
            assert not verify_password(OLD_PASSWORD, viewer.password_hash)
        else:
            assert viewer.password_hash == original_hash
        valid = password in (OLD_PASSWORD, NEW_PASSWORD)
        assert viewer.role == ("viewer" if valid else "editor")
        assert viewer.is_active is valid


async def test_new_viewer_starts_at_session_version_zero(viewer_store, monkeypatch):
    monkeypatch.setenv("VIEWER_PASSWORD", NEW_PASSWORD)
    await ensure_accounts.ensure_viewer_account()
    async with viewer_store() as db:
        viewer = await db.scalar(select(User).where(User.username == "viewer"))
        assert viewer is not None
        assert viewer.session_version == 0
        assert verify_password(NEW_PASSWORD, viewer.password_hash)
        assert viewer.role == "viewer" and viewer.is_active


async def test_concurrent_boots_rotate_existing_viewer_only_once(test_engine, monkeypatch):
    # Independent transactions model two replicas starting with the same new secret.
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid4()
    async with sessions() as db:
        db.add(
            User(
                id=user_id,
                username="viewer",
                role="viewer",
                password_hash=hash_password(OLD_PASSWORD),
                session_version=7,
            )
        )
        await db.commit()
    monkeypatch.setattr(ensure_accounts, "async_session_maker", sessions)
    monkeypatch.setenv("VIEWER_PASSWORD", NEW_PASSWORD)
    try:
        await asyncio.wait_for(
            asyncio.gather(ensure_accounts.ensure_viewer_account(), ensure_accounts.ensure_viewer_account()),
            timeout=10,
        )
        async with sessions() as db:
            viewer = await db.get(User, user_id)
            assert viewer is not None
            assert viewer.session_version == 8
            assert verify_password(NEW_PASSWORD, viewer.password_hash)
    finally:
        async with sessions() as db:
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
