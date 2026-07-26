"""Provider-neutral personnel identity CRUD.

Providers attach identity (provider slug + opaque external id) to canonical
local personnel via ``personnel_external_identities`` instead of vendor
columns. The deprecated ``personnel.divera_user_id`` column is dual-written
elsewhere for one compatibility release.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models


async def set_identity(
    db: AsyncSession,
    personnel_id: UUID,
    provider: str,
    external_id: str,
    metadata: dict[str, Any] | None = None,
) -> models.PersonnelExternalIdentity:
    """Create or update a person's identity at a provider (upsert, commits)."""
    existing = (
        await db.execute(
            select(models.PersonnelExternalIdentity)
            .where(models.PersonnelExternalIdentity.personnel_id == personnel_id)
            .where(models.PersonnelExternalIdentity.provider == provider)
        )
    ).scalar_one_or_none()

    if existing:
        existing.external_id = external_id
        if metadata is not None:
            existing.metadata_json = metadata
        await db.commit()
        return existing

    identity = models.PersonnelExternalIdentity(
        personnel_id=personnel_id,
        provider=provider,
        external_id=external_id,
        metadata_json=metadata,
    )
    db.add(identity)
    await db.commit()
    return identity


async def get_identity_map(db: AsyncSession, provider: str, personnel_ids: list[UUID] | None = None) -> dict[UUID, str]:
    """Map personnel_id -> external_id at a provider (optionally restricted)."""
    query = select(
        models.PersonnelExternalIdentity.personnel_id,
        models.PersonnelExternalIdentity.external_id,
    ).where(models.PersonnelExternalIdentity.provider == provider)
    if personnel_ids is not None:
        query = query.where(models.PersonnelExternalIdentity.personnel_id.in_(personnel_ids))

    rows = (await db.execute(query)).tuples().all()
    return dict(rows)
