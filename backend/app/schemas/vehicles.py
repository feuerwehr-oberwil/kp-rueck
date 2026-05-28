"""Vehicle schemas + per-event status response."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class VehicleBase(BaseModel):
    """Base vehicle schema."""

    name: str
    type: str  # Configurable vehicle types (e.g., 'TLF', 'DLK', 'MTW')
    display_order: int
    status: str  # 'available', 'unavailable'
    radio_call_sign: str

    @field_validator("name", "radio_call_sign")
    @classmethod
    def validate_string_fields(cls, v: str) -> str:
        """Validate string fields are not empty."""
        if not v or not v.strip():
            raise ValueError("Field cannot be empty")
        if len(v) > 100:
            raise ValueError("Field must be 100 characters or less")
        return v.strip()

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        """Validate vehicle status."""
        valid_statuses = {"available", "unavailable"}
        status_mapping = {
            "assigned": "unavailable",
            "planned": "unavailable",
            "maintenance": "unavailable",
        }
        if v in status_mapping:
            return status_mapping[v]
        if v not in valid_statuses:
            raise ValueError(f"Status must be one of: {', '.join(valid_statuses)}")
        return v

    @field_validator("display_order")
    @classmethod
    def validate_display_order(cls, v: int) -> int:
        """Validate display order is non-negative."""
        if v < 0:
            raise ValueError("Display order must be non-negative")
        return v


class VehicleCreate(VehicleBase):
    """Schema for creating vehicle."""

    pass


class VehicleUpdate(BaseModel):
    """Schema for updating vehicle."""

    name: str | None = None
    type: str | None = None
    display_order: int | None = None
    status: str | None = None
    radio_call_sign: str | None = None


class Vehicle(VehicleBase):
    """Full vehicle schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


class VehicleStatusResponse(BaseModel):
    """Vehicle status with driver and incident information."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: str
    status: str
    radio_call_sign: str

    driver_id: UUID | None = None
    driver_name: str | None = None
    driver_assigned_at: datetime | None = None

    incident_id: UUID | None = None
    incident_title: str | None = None
    incident_location_address: str | None = None
    incident_status: str | None = None
    incident_assigned_at: datetime | None = None
    assignment_duration_minutes: int | None = None
