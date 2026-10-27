"""Standard-Auftrag (Auftrag template) CRUD.

Templates are station configuration: global, not event-scoped, and hard-deleted
rather than soft-deleted — there is no audit interest in a Vorlage nobody used.
The one place they touch live data is :func:`instantiate_auto_templates`, called
when an event is created.
"""

import logging
import uuid
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import (
    AuftragTemplate,
    AuftragTemplateResource,
    Event,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    User,
    Vehicle,
)
from ..services.audit import log_action
from .assignments import ResourceNotAssignableError, ensure_assignable
from .locking import lock_resources

logger = logging.getLogger(__name__)

_RESOURCE_MODELS: dict[str, Any] = {"vehicle": Vehicle, "material": Material}


async def list_templates(db: AsyncSession) -> list[AuftragTemplate]:
    """All Standard-Aufträge in settings order."""
    result = await db.execute(
        select(AuftragTemplate)
        .options(selectinload(AuftragTemplate.resources))
        .order_by(AuftragTemplate.position.asc(), AuftragTemplate.created_at.asc())
    )
    return list(result.scalars().all())


async def get_template(db: AsyncSession, template_id: uuid.UUID) -> AuftragTemplate | None:
    """Load one template with its resources, or None."""
    result = await db.execute(
        select(AuftragTemplate)
        .options(selectinload(AuftragTemplate.resources))
        .where(AuftragTemplate.id == template_id)
    )
    return result.scalar_one_or_none()


async def _prune_missing_resources(
    db: AsyncSession, refs: list[schemas.AuftragTemplateResourceRef]
) -> list[schemas.AuftragTemplateResourceRef]:
    """Drop refs pointing at a resource that no longer exists.

    `resource_id` is polymorphic and carries no FK, so nothing stops a caller
    naming a deleted vehicle. Dropping it here keeps the template honest instead
    of failing every future event creation on a ghost.
    """
    kept: list[schemas.AuftragTemplateResourceRef] = []
    for ref in refs:
        model = _RESOURCE_MODELS[ref.resource_type]
        if await db.scalar(select(model.id).where(model.id == ref.resource_id)) is not None:
            kept.append(ref)
    return kept


def _set_resources(template: AuftragTemplate, refs: list[schemas.AuftragTemplateResourceRef]) -> None:
    """Replace a template's resource list, keeping the caller's order."""
    template.resources = [
        AuftragTemplateResource(
            resource_type=ref.resource_type,
            resource_id=ref.resource_id,
            position=index,
        )
        for index, ref in enumerate(refs)
    ]


async def create_template(
    db: AsyncSession,
    payload: schemas.AuftragTemplateCreate,
    current_user: User,
    request: Request,
) -> AuftragTemplate:
    """Create a Standard-Auftrag, appended to the end of the settings list."""
    max_pos = await db.scalar(select(func.max(AuftragTemplate.position)))
    template = AuftragTemplate(
        name=payload.name,
        color=payload.color,
        notes=payload.notes,
        auto_create=payload.auto_create,
        position=(max_pos + 1) if max_pos is not None else 0,
    )
    _set_resources(template, await _prune_missing_resources(db, payload.resources))
    db.add(template)
    await db.flush()

    await log_action(
        db=db,
        action_type="create",
        resource_type="auftrag_template",
        resource_id=template.id,
        user=current_user,
        changes={"created": payload.model_dump(mode="json")},
        request=request,
    )
    await db.flush()
    return await get_template(db, template.id)  # type: ignore[return-value]


async def update_template(
    db: AsyncSession,
    template_id: uuid.UUID,
    payload: schemas.AuftragTemplateUpdate,
    current_user: User,
    request: Request,
) -> AuftragTemplate | None:
    """Patch a Standard-Auftrag. A present ``resources`` list replaces the old one."""
    template = await get_template(db, template_id)
    if template is None:
        return None

    changes = payload.model_dump(mode="json", exclude_unset=True)
    for field in ("name", "color", "notes", "auto_create"):
        if field in payload.model_fields_set:
            setattr(template, field, getattr(payload, field))
    if payload.resources is not None:
        # Drop the old rows in their own flush first. Assigning the new list in
        # one go interleaves INSERTs with the orphan DELETEs, and a resource that
        # merely MOVED (same template, new position) then collides with itself on
        # `uq_template_resource`.
        template.resources.clear()
        await db.flush()
        _set_resources(template, await _prune_missing_resources(db, payload.resources))

    await db.flush()
    await log_action(
        db=db,
        action_type="update",
        resource_type="auftrag_template",
        resource_id=template.id,
        user=current_user,
        changes={"updated": changes},
        request=request,
    )
    await db.flush()
    return await get_template(db, template_id)


async def delete_template(
    db: AsyncSession,
    template_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """Delete a Standard-Auftrag. Aufträge already created from it are untouched."""
    template = await get_template(db, template_id)
    if template is None:
        return False

    await log_action(
        db=db,
        action_type="delete",
        resource_type="auftrag_template",
        resource_id=template.id,
        user=current_user,
        changes={"deleted": {"name": template.name}},
        request=request,
    )
    await db.delete(template)
    await db.flush()
    return True


async def reorder_templates(db: AsyncSession, template_ids: list[uuid.UUID]) -> None:
    """Write the settings list order. Ids not named keep their relative order after."""
    existing = {t.id: t for t in await list_templates(db)}
    for index, template_id in enumerate(template_ids):
        template = existing.get(template_id)
        if template is not None:
            template.position = index
    offset = len(template_ids)
    for template in existing.values():
        if template.id not in template_ids:
            template.position += offset
    await db.flush()


async def instantiate_auto_templates(
    db: AsyncSession,
    event_id: uuid.UUID,
    created_by: uuid.UUID | None,
) -> list[IncidentGroup]:
    """Open every ``auto_create`` Standard-Auftrag on a freshly created event.

    Each becomes a plain, empty Auftrag carrying the template's colour, notes and
    default equipment. Resource conflicts are NOT avoided here: assigning a
    vehicle that is already committed elsewhere is exactly the state the board is
    built to make visible, and silently dropping it would hide a decision the
    station made on purpose. Skipped are resources that have since been deleted —
    there is nothing to point at — and those ``assignments.ensure_assignable``
    refuses (archived, «nicht einsatzbereit»): one broken TLF must not stop the
    Lage from opening. Each skip is logged.

    Lock order (``crud/locking.py``): every template resource up front through
    ``lock_resources`` (sorted, the lock archive and purge take); the Aufträge are
    ours (inserted afterwards, nobody else can see them).

    Commits nothing; the caller owns the transaction.
    """
    result = await db.execute(
        select(AuftragTemplate)
        .options(selectinload(AuftragTemplate.resources))
        .where(AuftragTemplate.auto_create.is_(True))
        .order_by(AuftragTemplate.position.asc(), AuftragTemplate.created_at.asc())
    )
    templates = list(result.scalars().all())
    if not templates:
        return []

    event = await db.get(Event, event_id)
    if event is None:
        raise LookupError(f"event {event_id} does not exist")
    # Every resource of every template, locked once and in order before any work.
    resources = await lock_resources(
        db, [(ref.resource_type, ref.resource_id) for template in templates for ref in template.resources]
    )
    groups: list[IncidentGroup] = []
    for position, template in enumerate(templates):
        group = IncidentGroup(
            event_id=event_id,
            name=template.name,
            color=template.color,
            notes=template.notes,
            position=position,
            created_by=created_by,
        )
        db.add(group)
        await db.flush()

        for ref in template.resources:
            resource = resources.get((ref.resource_type, ref.resource_id))
            if resource is None:
                continue
            try:
                ensure_assignable(resource, event=event)
            except ResourceNotAssignableError as refused:
                logger.info("Standard-Auftrag %r: %s skipped – %s", template.name, ref.resource_type, refused)
                continue
            db.add(
                IncidentGroupAssignment(
                    incident_group_id=group.id,
                    resource_type=ref.resource_type,
                    resource_id=ref.resource_id,
                    assigned_by=created_by,
                )
            )
        groups.append(group)

    await db.flush()
    return groups
