"""Material + material-group schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class MaterialBase(BaseModel):
    """Base material schema."""

    name: str
    type: str  # e.g., 'Tauchpumpen', 'Wassersauger', 'Sägen', 'Generatoren', 'Anhänger'
    location: str  # e.g., 'TLF', 'Pio', 'MoWa', 'Bühne', 'Depot'
    location_sort_order: int = 0
    description: str | None = None
    # Legacy mirror of `out_of_service`: 'unavailable' ⇔ out_of_service=True.
    # Still accepted on write and still returned, but new clients should read and
    # write `out_of_service` — it is the field that carries the meaning.
    status: str = "available"  # 'available', 'unavailable'
    consumable: bool = False  # Consumable items (e.g., tape) — not tracked per-incident
    group_id: UUID | None = None  # Material group/block reference

    @field_validator("name", "type", "location")
    @classmethod
    def validate_required_strings(cls, v: str) -> str:
        """Validate required string fields."""
        if not v or not v.strip():
            raise ValueError("Field cannot be empty")
        if len(v) > 100:
            raise ValueError("Field must be 100 characters or less")
        return v.strip()

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str | None) -> str | None:
        """Validate description length if provided."""
        if v and len(v) > 500:
            raise ValueError("Description must be 500 characters or less")
        return v.strip() if v else v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        """Validate material status."""
        valid_statuses = {"available", "unavailable"}
        status_mapping = {
            "assigned": "available",
            "planned": "unavailable",
            "maintenance": "unavailable",
        }
        if v in status_mapping:
            return status_mapping[v]
        if v not in valid_statuses:
            raise ValueError(f"Status must be one of: {', '.join(valid_statuses)}")
        return v

    @field_validator("location_sort_order")
    @classmethod
    def validate_sort_order(cls, v: int) -> int:
        """Validate sort order is non-negative."""
        if v < 0:
            raise ValueError("Sort order must be non-negative")
        return v


class MaterialCreate(MaterialBase):
    """Schema for creating material."""

    # «Nicht einsatzbereit» at creation time. Wins over `status` when both are sent.
    out_of_service: bool = False


class MaterialUpdate(BaseModel):
    """Schema for updating material.

    `out_of_service` and `status` write the same readiness flag; when both are
    present in the payload, `out_of_service` wins. `archived_at` is not settable
    here — archiving goes through POST /materials/{id}/archive and /restore.
    """

    name: str | None = None
    type: str | None = None
    location: str | None = None
    location_sort_order: int | None = None
    description: str | None = None
    status: str | None = None
    out_of_service: bool | None = None
    consumable: bool | None = None
    group_id: UUID | None = None


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
