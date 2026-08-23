"""Material CRUD operations.

Three axes, three homes — that separation is the point of this module:

* readiness  – ``out_of_service_since`` («Nicht einsatzbereit»), mirrored into ``status``
* lifecycle  – ``archived_at`` (still part of the inventory, or retired)
* deployment – ``incident_assignments``, per Ereignis, never a column on the row

They used to be one column. "Delete" set ``status='unavailable'`` and the list
endpoints kept serving the row, so a deleted pump stood on the board afterwards,
green and assignable, while the dialog had promised the deletion could not be
undone. Nothing here writes ``status`` for any reason other than readiness.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import case, delete, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Event, Incident, IncidentAssignment, Material, User
from ..services.audit import calculate_changes, log_action

# ============================================
# Shared lifecycle helpers (materials + vehicles)
# ============================================


@dataclass(frozen=True, slots=True)
class ResourceUsage:
    """How often a resource has stood on an Einsatz, and whether that blocks a purge.

    ``total`` is what the archive line shows («Auf 14 Einsätzen gestanden») and counts
    distinct incidents, training included. ``protected`` counts only the ones a purge
    would actually damage: live (not soft-deleted) incidents on a non-training Ereignis.
    Training runs are disposable by design, which is exactly what makes a test entry
    that only ever appeared on a test Einsatz purgeable.
    """

    total: int
    protected: int

    @property
    def can_delete(self) -> bool:
        """True when permanently deleting this resource would tear no hole in an Auswertung."""
        return self.protected == 0


NO_USAGE = ResourceUsage(total=0, protected=0)

# Why a permanent delete was refused. The route turns this into the German 409 detail.
PurgeRefusal = Literal["not_found", "not_archived", "in_use"]


@dataclass(frozen=True, slots=True)
class PurgeOutcome:
    """Result of a permanent delete attempt: purged, or refused with a reason."""

    purged: bool
    refusal: PurgeRefusal | None = None
    name: str = ""
    usage: ResourceUsage = NO_USAGE


async def resource_usage(
    db: AsyncSession,
    resource_type: str,
    resource_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, ResourceUsage]:
    """Count Einsatz history for a batch of resources in one query.

    Lives here rather than in a third module because materials and vehicles are the
    only two resource kinds that can be archived; ``crud/vehicles.py`` imports it.
    Resources with no history at all are simply absent from the result — callers
    fall back to ``NO_USAGE``.
    """
    if not resource_ids:
        return {}

    protects = case(
        (Incident.deleted_at.is_(None) & Event.training_flag.is_(False), IncidentAssignment.incident_id),
        else_=None,
    )
    result = await db.execute(
        select(
            IncidentAssignment.resource_id,
            func.count(distinct(IncidentAssignment.incident_id)),
            func.count(distinct(protects)),
        )
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .join(Event, Event.id == Incident.event_id)
        .where(
            IncidentAssignment.resource_type == resource_type,
            IncidentAssignment.resource_id.in_(resource_ids),
        )
        .group_by(IncidentAssignment.resource_id)
    )
    return {row[0]: ResourceUsage(total=int(row[1]), protected=int(row[2])) for row in result.all()}


@dataclass(frozen=True, slots=True)
class ArchiveRefused:
    """An archive attempt refused because the resource stands on an Einsatz right now.

    The purge guard's little sibling: same notion of "active" (a live incident on a
    non-training Ereignis, see `resource_usage`), but only assignments that are still
    open (`unassigned_at IS NULL`) block — history never stops an archive, that is
    the whole point of archiving over purging. The routes turn this into a 409 with
    the same shape of German detail as the purge's `in_use`, so the frontend handles
    both refusals the same way.
    """

    name: str
    active_incidents: int


async def count_active_deployments(db: AsyncSession, resource_type: str, resource_id: uuid.UUID) -> int:
    """How many live, non-training incidents hold this resource on an open assignment."""
    result = await db.scalar(
        select(func.count(distinct(IncidentAssignment.incident_id)))
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .join(Event, Event.id == Incident.event_id)
        .where(
            IncidentAssignment.resource_type == resource_type,
            IncidentAssignment.resource_id == resource_id,
            IncidentAssignment.unassigned_at.is_(None),
            Incident.deleted_at.is_(None),
            Event.training_flag.is_(False),
        )
    )
    return int(result or 0)


def resolve_out_of_service(payload: BaseModel, current: bool) -> bool:
    """Read the readiness flag out of a create/update payload.

    `out_of_service` is the field that means it; `status` is the legacy spelling of
    the same thing. Whichever was actually sent wins, `out_of_service` first, so a
    client that only knows `status` and a client that only knows `out_of_service`
    both write the same column instead of fighting over two.
    """
    sent = payload.model_fields_set
    if "out_of_service" in sent:
        flag: bool | None = getattr(payload, "out_of_service", None)
        if flag is not None:
            return flag
    if "status" in sent:
        status: str | None = getattr(payload, "status", None)
        if status is not None:
            return status == "unavailable"
    return current


class ReadinessRow(Protocol):
    """What `apply_out_of_service` needs — Material and Vehicle both satisfy it."""

    status: str
    out_of_service_since: datetime | None


def apply_out_of_service(resource: ReadinessRow, flag: bool) -> None:
    """Set readiness on a material or vehicle, keeping the legacy `status` mirror in lockstep.

    Re-flagging an already-flagged item keeps the original timestamp: «seit 19.08.»
    must survive an unrelated edit of the same row.
    """
    if flag:
        if resource.out_of_service_since is None:
            resource.out_of_service_since = datetime.now(UTC)
        resource.status = "unavailable"
    else:
        resource.out_of_service_since = None
        resource.status = "available"


# ============================================
# Materials
# ============================================


async def get_all_materials(db: AsyncSession, *, include_archived: bool = False) -> list[Material]:
    """Get all materials, archived ones excluded unless asked for.

    The default is what the board, the sidebar and the assignment dialog want:
    archived material is gone. `include_archived=True` is for the settings table's
    «Archivierte anzeigen».
    """
    query = select(Material)
    if not include_archived:
        query = query.where(Material.archived_at.is_(None))
    result = await db.execute(
        query.order_by(Material.location_sort_order.asc(), Material.location.asc(), Material.name.asc())
    )
    return list(result.scalars().all())


async def get_material(db: AsyncSession, material_id: uuid.UUID) -> Material | None:
    """Get single material by ID. Archived rows are returned — the archive has to read them."""
    result = await db.execute(select(Material).where(Material.id == material_id))
    return result.scalar_one_or_none()


async def create_material(
    db: AsyncSession,
    material_data: schemas.MaterialCreate,
    current_user: User,
    request: Request,
) -> Material:
    """Create new material. Readiness comes from `out_of_service` (or legacy `status`)."""
    material = Material(
        name=material_data.name,
        type=material_data.type,
        location=material_data.location,
        location_sort_order=material_data.location_sort_order,
        description=material_data.description,
        consumable=material_data.consumable,
        group_id=material_data.group_id,
        status="available",
    )
    apply_out_of_service(material, resolve_out_of_service(material_data, current=False))
    db.add(material)
    await db.flush()

    # Log creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="material",
        resource_id=material.id,
        user=current_user,
        changes={
            "name": material.name,
            "type": material.type,
            "status": material.status,
            "out_of_service": material.out_of_service,
            "location": material.location,
            "description": material.description,
        },
        request=request,
    )

    await db.commit()
    await db.refresh(material)
    return material


async def update_material(
    db: AsyncSession,
    material_id: uuid.UUID,
    material_data: schemas.MaterialUpdate,
    current_user: User,
    request: Request,
) -> Material | None:
    """Update existing material.

    Readiness is applied through `apply_out_of_service` so `status` and
    `out_of_service_since` can never drift apart; `archived_at` is untouched here.
    """
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()

    if not material:
        return None

    # Capture before state
    before_state = {
        "name": material.name,
        "status": material.status,
        "location": material.location,
    }

    # Apply updates. Readiness has its own path: setting `status` directly would
    # leave `out_of_service_since` stale, which is the drift this module exists to
    # prevent.
    update_data = material_data.model_dump(exclude_unset=True, exclude={"status", "out_of_service"})
    for field, value in update_data.items():
        setattr(material, field, value)
    apply_out_of_service(material, resolve_out_of_service(material_data, current=material.out_of_service))

    material.updated_at = datetime.now(UTC)

    # Capture after state
    after_state = {
        "name": material.name,
        "status": material.status,
        "location": material.location,
    }

    # Calculate changes
    changes = calculate_changes(before_state, after_state)

    # Log update if changes
    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="material",
            resource_id=material.id,
            user=current_user,
            changes=changes,
            request=request,
        )

    await db.commit()
    await db.refresh(material)
    return material


async def archive_material(
    db: AsyncSession,
    material_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> Material | ArchiveRefused | None:
    """Archive a material: out of the board, out of the sidebar, out of the picker.

    Refused (`ArchiveRefused`, the routes' 409) while the material stands on a live
    Einsatz — archiving it mid-deployment would make it vanish from a card an
    operator is working, with nobody told. Unassign first, then archive.

    Reversible via `restore_material`. Past assignments and the audit trail keep
    it, so past Einsätze still evaluate correctly. Readiness is left alone — a
    restored item comes back exactly as it went in. Already archived is a no-op.
    """
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()

    if not material:
        return None

    if material.archived_at is None:
        deployed = await count_active_deployments(db, "material", material_id)
        if deployed:
            return ArchiveRefused(name=material.name, active_incidents=deployed)
        material.archived_at = datetime.now(UTC)
        material.updated_at = datetime.now(UTC)

        await log_action(
            db=db,
            action_type="archive",
            resource_type="material",
            resource_id=material.id,
            user=current_user,
            changes={"name": material.name, "archived_at": material.archived_at.isoformat()},
            request=request,
        )
        await db.commit()
        await db.refresh(material)

    return material


async def restore_material(
    db: AsyncSession,
    material_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> Material | None:
    """Bring an archived material back («Zurückholen»). Not archived is a no-op."""
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()

    if not material:
        return None

    if material.archived_at is not None:
        material.archived_at = None
        material.updated_at = datetime.now(UTC)

        await log_action(
            db=db,
            action_type="restore",
            resource_type="material",
            resource_id=material.id,
            user=current_user,
            changes={"name": material.name},
            request=request,
        )
        await db.commit()
        await db.refresh(material)

    return material


async def purge_material(
    db: AsyncSession,
    material_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> PurgeOutcome:
    """Permanently delete a material — the row really leaves the database.

    Two deliberate steps, because this one is not reversible: the material has to be
    archived first, and it must never have stood on a live, non-training Einsatz.
    Assignments to training incidents are removed along with it; the audit_log entries
    stay, because they are the Protokoll and a purge is itself an entry in it.
    """
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()

    if not material:
        return PurgeOutcome(purged=False, refusal="not_found")

    name = material.name
    if material.archived_at is None:
        return PurgeOutcome(purged=False, refusal="not_archived", name=name)

    usage = (await resource_usage(db, "material", [material_id])).get(material_id, NO_USAGE)
    if not usage.can_delete:
        return PurgeOutcome(purged=False, refusal="in_use", name=name, usage=usage)

    # incident_assignments.resource_id carries no foreign key (it is polymorphic),
    # so leftovers would dangle. Only training/deleted-incident rows can be here.
    await db.execute(
        delete(IncidentAssignment).where(
            IncidentAssignment.resource_type == "material",
            IncidentAssignment.resource_id == material_id,
        )
    )
    await db.delete(material)

    await log_action(
        db=db,
        action_type="purge",
        resource_type="material",
        resource_id=material_id,
        user=current_user,
        changes={"name": name, "assignment_count": usage.total},
        request=request,
    )

    await db.commit()
    return PurgeOutcome(purged=True, name=name, usage=usage)
