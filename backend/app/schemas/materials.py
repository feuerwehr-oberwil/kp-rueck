"""Material + material-group schemas."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints, field_validator

from .fields import RequiredText50, RequiredText100, SortOrder, reject_null


def _material_status(v: str) -> str:
    """Map the legacy material statuses onto the two the column holds, refuse anything else."""
    valid_statuses = {"available", "unavailable"}
    status_mapping = {
        "assigned": "available",
        "planned": "unavailable",
        "maintenance": "unavailable",
    }
    if v in status_mapping:
        return status_mapping[v]
    if v not in valid_statuses:
        raise ValueError(f"Status must be one of: {', '.join(sorted(valid_statuses))}")
    return v


MaterialStatus = Annotated[str, AfterValidator(_material_status)]
MaterialDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class MaterialBase(BaseModel):
    """Base material schema."""

    name: RequiredText100
    type: RequiredText50  # e.g., 'Tauchpumpen', 'Wassersauger', 'Sägen', 'Generatoren', 'Anhänger'
    location: RequiredText100  # e.g., 'TLF', 'Pio', 'MoWa', 'Bühne', 'Depot'
    location_sort_order: SortOrder = 0
    description: MaterialDescription | None = None
    # Legacy mirror of `out_of_service`: 'unavailable' ⇔ out_of_service=True.
    # Still accepted on write and still returned, but new clients should read and
    # write `out_of_service` — it is the field that carries the meaning.
    status: MaterialStatus = "available"  # 'available', 'unavailable'
    consumable: bool = False  # Consumable items (e.g., tape) — not tracked per-incident
    group_id: UUID | None = None  # Material group/block reference


class MaterialCreate(MaterialBase):
    """Schema for creating material."""

    # «Nicht einsatzbereit» at creation time. Wins over `status` when both are sent.
    out_of_service: bool = False


class MaterialUpdate(BaseModel):
    """Schema for updating material: same field rules as create, every field optional.

    `out_of_service` and `status` write the same readiness flag; when both are
    present in the payload, `out_of_service` wins, and a null in either means "not
    sent" (`crud.materials.resolve_out_of_service`). `description` and `group_id` may
    be cleared with null; the other columns cannot be emptied. `archived_at` is not
    settable here — archiving goes through POST /materials/{id}/archive and /restore.
    """

    name: RequiredText100 | None = None
    type: RequiredText50 | None = None
    location: RequiredText100 | None = None
    location_sort_order: SortOrder | None = None
    description: MaterialDescription | None = None
    status: MaterialStatus | None = None
    out_of_service: bool | None = None
    consumable: bool | None = None
    group_id: UUID | None = None

    _not_null = field_validator("name", "type", "location", "location_sort_order", "consumable")(reject_null)


class Material(MaterialBase):
    """Full material schema with database fields.

    Three independent axes, so the board never has to guess a state:
    `out_of_service` (readiness), `archived_at` (lifecycle), and deployment —
    which lives in incident_assignments and is per-event, so it stays with the
    caller that knows which Ereignis is on screen. Precedence for rendering:
    out_of_service beats assigned beats available.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime

    # Readiness. `out_of_service` is derived from the timestamp, never stored twice.
    out_of_service: bool = False
    out_of_service_since: datetime | None = None

    # Lifecycle. Non-null means the row is out of the inventory; list endpoints
    # only return it with ?include_archived=true.
    archived_at: datetime | None = None

    # Archive bookkeeping — how often this item has stood on an Einsatz, and
    # whether it may be purged permanently. Both are None where they were not
    # computed (group listings, board snapshots); the /materials endpoints
    # always fill them.
    assignment_count: int | None = None
    can_delete: bool | None = None


class MaterialGroupBase(BaseModel):
    """Base schema for material groups/blocks."""

    name: str
    description: str | None = None
    location: str = ""
    location_sort_order: int = 0


class MaterialGroupCreate(MaterialGroupBase):
    """Schema for creating a material group."""

    material_ids: list[UUID] = []  # IDs of materials to add to this group


class MaterialGroupUpdate(BaseModel):
    """Schema for updating a material group."""

    name: str | None = None
    description: str | None = None
    location: str | None = None
    location_sort_order: int | None = None
    material_ids: list[UUID] | None = None  # If provided, replaces all group members


class MaterialGroupResponse(MaterialGroupBase):
    """Full material group schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    materials: list[Material] = []
    created_at: datetime
    updated_at: datetime
