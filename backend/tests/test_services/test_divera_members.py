"""Tests for Divera member sync writing provider-neutral identities.

``personnel_external_identities`` (provider="divera") is the only place the
sync writes a person's Divera id — it is what makes a person addressable for
outbound alarms. The deprecated ``personnel.divera_user_id`` dual-write is gone.
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Personnel, PersonnelExternalIdentity, User
from app.services.divera_members import build_sync_preview, execute_sync


@pytest.fixture
def mock_request():
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


@pytest_asyncio.fixture
async def sync_user(db_session: AsyncSession) -> User:
    user = User(id=uuid4(), username="sync_editor", password_hash="", role="editor")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _divera_id_for(db: AsyncSession, personnel_id) -> str | None:
    row = (
        await db.execute(
            select(PersonnelExternalIdentity.external_id)
            .where(PersonnelExternalIdentity.personnel_id == personnel_id)
            .where(PersonnelExternalIdentity.provider == "divera")
        )
    ).scalar_one_or_none()
    return row


def test_preview_divera_linked_comes_from_identity_table():
    """`divera_linked` in the sync preview reflects the identity table, not any column.

    The caller passes the set of personnel ids that have a provider="divera" row;
    a matched person is "linked" exactly when they are in that set.
    """
    linked_person = Personnel(id=uuid4(), name="Linked Lisa", status="available")
    unlinked_person = Personnel(id=uuid4(), name="Unlinked Udo", status="available")
    members = [
        {"divera_id": 1, "name": "Linked Lisa"},
        {"divera_id": 2, "name": "Unlinked Udo"},
    ]

    preview = build_sync_preview(members, [linked_person, unlinked_person], {linked_person.id})

    by_name = {item["member"]["name"]: item for item in preview["unchanged"]}
    assert by_name["Linked Lisa"]["divera_linked"] is True
    assert by_name["Unlinked Udo"]["divera_linked"] is False


@pytest.mark.asyncio
async def test_sync_new_person_writes_identity(db_session: AsyncSession, sync_user: User, mock_request):
    """A newly created person gets an identity row."""
    preview = {
        "new": [{"member": {"divera_id": 800001, "name": "Neu Person"}, "status": "new"}],
        "unchanged": [],
        "not_in_divera": [],
    }

    result = await execute_sync(db_session, preview, remove_stale=False, current_user=sync_user, request=mock_request)
    assert result["created"] == 1
    assert result["linked"] == 1

    person = (await db_session.execute(select(Personnel).where(Personnel.name == "Neu Person"))).scalar_one()
    assert await _divera_id_for(db_session, person.id) == "800001"


@pytest.mark.asyncio
async def test_sync_backfills_identity_for_existing_match(db_session: AsyncSession, sync_user: User, mock_request):
    """An existing person without a link gets an identity row on sync."""
    person = Personnel(id=uuid4(), name="Bestand Person", status="available")
    db_session.add(person)
    await db_session.commit()
    await db_session.refresh(person)

    preview = {
        "new": [],
        "unchanged": [
            {
                "member": {"divera_id": 800002, "name": "Bestand Person"},
                "status": "unchanged",
                "existing_id": str(person.id),
                "divera_linked": False,
            }
        ],
        "not_in_divera": [],
    }

    result = await execute_sync(db_session, preview, remove_stale=False, current_user=sync_user, request=mock_request)
    assert result["linked"] == 1

    assert await _divera_id_for(db_session, person.id) == "800002"


@pytest.mark.asyncio
async def test_sync_updates_identity_when_divera_id_changes(db_session: AsyncSession, sync_user: User, mock_request):
    """Re-linking a person to a new Divera id updates the identity row (upsert)."""
    person = Personnel(id=uuid4(), name="Wechsel Person", status="available")
    db_session.add(person)
    await db_session.commit()
    await db_session.refresh(person)
    db_session.add(PersonnelExternalIdentity(personnel_id=person.id, provider="divera", external_id="700000"))
    await db_session.commit()

    preview = {
        "new": [],
        "unchanged": [
            {
                "member": {"divera_id": 700099, "name": "Wechsel Person"},
                "status": "unchanged",
                "existing_id": str(person.id),
                "divera_linked": True,
            }
        ],
        "not_in_divera": [],
    }

    await execute_sync(db_session, preview, remove_stale=False, current_user=sync_user, request=mock_request)

    assert await _divera_id_for(db_session, person.id) == "700099"
    # Still exactly one identity row for this person+provider (upsert, not insert)
    count = len(
        (
            await db_session.execute(
                select(PersonnelExternalIdentity).where(PersonnelExternalIdentity.personnel_id == person.id)
            )
        )
        .scalars()
        .all()
    )
    assert count == 1
