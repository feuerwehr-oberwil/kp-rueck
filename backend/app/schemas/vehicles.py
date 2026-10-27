"""Vehicle schemas + per-event status response."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, field_validator

from .fields import RequiredText50, RequiredText100, SortOrder, reject_null


def _vehicle_status(v: str) -> str:
    """Map the legacy vehicle statuses onto the two the column holds, refuse anything else."""
    valid_statuses = {"available", "unavailable"}
    status_mapping = {
        "assigned": "unavailable",
        "planned": "unavailable",
        "maintenance": "unavailable",
    }
    if v in status_mapping:
        return status_mapping[v]
    if v not in valid_statuses:
        raise ValueError(f"Status must be one of: {', '.join(sorted(valid_statuses))}")
    return v


VehicleStatus = Annotated[str, AfterValidator(_vehicle_status)]


class VehicleBase(BaseModel):
    """Base vehicle schema."""

    name: RequiredText100
    # Free text (e.g. 'TLF', 'DLK', 'MTW'). Plain `str` here because the response model
    # inherits it and older rows may hold a blank type; writes go through `VehicleCreate` /
    # `VehicleUpdate`, which require a non-blank value that fits the column.
    type: str
    display_order: SortOrder
    # Legacy mirror of `out_of_service`: 'unavailable' ⇔ out_of_service=True.
    # Still accepted on write and still returned, but new clients should read and
    # write `out_of_service` — it is the field that carries the meaning.
    status: VehicleStatus  # 'available', 'unavailable'
    radio_call_sign: RequiredText100


class VehicleCreate(VehicleBase):
    """Schema for creating vehicle."""

    type: RequiredText50
    # «Nicht einsatzbereit» at creation time. Wins over `status` when both are sent.
    out_of_service: bool = False


class VehicleUpdate(BaseModel):
    """Schema for updating vehicle: same field rules as create, every field optional.

    `out_of_service` and `status` write the same readiness flag; when both are
    present in the payload, `out_of_service` wins, and a null in either means "not
    sent" (`crud.materials.resolve_out_of_service`). The other columns cannot be
    emptied. `archived_at` is not settable here — archiving goes through
    POST /vehicles/{id}/archive and /restore.
    """

    name: RequiredText100 | None = None
    type: RequiredText50 | None = None
    display_order: SortOrder | None = None
    status: VehicleStatus | None = None
    out_of_service: bool | None = None
    radio_call_sign: RequiredText100 | None = None

    _not_null = field_validator("name", "type", "display_order", "radio_call_sign")(reject_null)


class Vehicle(VehicleBase):
    """Full vehicle schema with database fields.

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

    # Lifecycle. Non-null means the row is out of the fleet; list endpoints only
    # return it with ?include_archived=true.
    archived_at: datetime | None = None

    # Archive bookkeeping — how often this vehicle has stood on an Einsatz, and
    # whether it may be purged permanently. Both are None where they were not
    # computed (board snapshots); the /vehicles endpoints always fill them.
    assignment_count: int | None = None
    can_delete: bool | None = None


class VehicleStatusResponse(BaseModel):
    """Vehicle status with driver and incident information.

    Answers all three states for one vehicle in one call: `out_of_service` wins,
    then `incident_id` (Im Einsatz), else Verfügbar.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: str
    status: str
    out_of_service: bool = False
    out_of_service_since: datetime | None = None
    radio_call_sign: str

    driver_id: UUID | None = None
    driver_name: str | None = None
    driver_assigned_at: datetime | None = None

    incident_id: UUID | None = None
    incident_title: str | None = None
    incident_location_address: str | None = None
    # Server-computed short label for the address above (home city stripped),
    # so the Fahrzeug sheet shows the final deployment line on first paint.
    incident_location_display: str | None = None
    incident_status: str | None = None
    incident_assigned_at: datetime | None = None
    assignment_duration_minutes: int | None = None
