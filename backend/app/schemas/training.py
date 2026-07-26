"""Training-mode schemas: Excel imports, emergency templates, training locations, simulation."""

import re
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator, model_validator


# Excel import/export
class ExcelImportPreview(BaseModel):
    """Preview of Excel import data."""

    personnel_preview: list[dict[str, Any]]
    personnel_total: int
    vehicles_preview: list[dict[str, Any]]
    vehicles_total: int
    materials_preview: list[dict[str, Any]]
    materials_total: int


class ExcelImportResult(BaseModel):
    """Result of Excel import operation."""

    success: bool
    mode: str
    counts: dict[str, int]
    timestamp: datetime


# Emergency templates
class EmergencyTemplateBase(BaseModel):
    """Base schema for emergency template."""

    title_pattern: str
    incident_type: str
    category: str  # 'normal' or 'critical'
    message_pattern: str
    # Optional alternates — generator rotates between these and the *_pattern
    # canonical values so spawns of the same template don't read identically.
    title_variations: list[str] | None = None
    message_variations: list[str] | None = None


class EmergencyTemplateCreate(EmergencyTemplateBase):
    """Schema for creating emergency template."""

    pass


class EmergencyTemplateResponse(EmergencyTemplateBase):
    """Schema for emergency template response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    is_active: bool


class ManualDispatchRequest(BaseModel):
    """Trainer-driven manual dispatch.

    Pick a template, then choose the location in one of two ways:
      - `location_id` — a pre-seeded `TrainingLocation`
      - `latitude` + `longitude` + `address` — any point on the map
        (trainer drops a pin, reverse-geocoded address is sent along)

    Exactly one of the two paths must be provided.
    """

    template_id: UUID
    location_id: UUID | None = None
    latitude: float | None = None
    longitude: float | None = None
    address: str | None = None

    @model_validator(mode="after")
    def exactly_one_location_source(self) -> "ManualDispatchRequest":
        has_seeded = self.location_id is not None
        has_pin = self.latitude is not None and self.longitude is not None and bool(self.address)
        if has_seeded and has_pin:
            raise ValueError("Provide either location_id OR (latitude, longitude, address), not both")
        if not has_seeded and not has_pin:
            raise ValueError("Provide either location_id OR (latitude, longitude, address)")
        return self


# Training locations
class TrainingLocationBase(BaseModel):
    """Base schema for training location."""

    street: str
    house_number: str
    # Required, not defaulted: a training location that quietly claims to be in
    # one particular town is wrong for every station but that one.
    postal_code: str
    city: str
    building_type: str | None = None
    latitude: str | Decimal | None = None
    longitude: str | Decimal | None = None

    @field_validator("street")
    @classmethod
    def validate_street(cls, v: str) -> str:
        """Validate street name."""
        if not v or not v.strip():
            raise ValueError("Street cannot be empty")
        if len(v) > 100:
            raise ValueError("Street must be 100 characters or less")
        return v.strip()

    @field_validator("house_number")
    @classmethod
    def validate_house_number(cls, v: str) -> str:
        """Validate house number format."""
        if not v or not v.strip():
            raise ValueError("House number cannot be empty")
        if not re.match(r"^[\d]+[a-zA-Z\-\/]*$", v.strip()):
            raise ValueError("Invalid house number format")
        return v.strip()

    @field_validator("postal_code")
    @classmethod
    def validate_postal_code(cls, v: str) -> str:
        """Validate Swiss postal code shape (4 digits).

        The Basel-Landschaft range check (4000-4499) is enforced only on the
        Create schema below — Response must accept legacy/demo data that
        predates the constraint (e.g. the '0000' demo placeholder), otherwise
        the GET endpoint 500s through Pydantic.
        """
        if not re.match(r"^\d{4}$", v):
            raise ValueError("Postal code must be 4 digits")
        return v

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v: str | Decimal | None) -> str | Decimal | None:
        """Validate latitude is within Basel-Landschaft area."""
        if v is not None:
            try:
                lat_val = float(str(v))
                if not (47.3 <= lat_val <= 47.6):
                    raise ValueError("Latitude should be within Basel-Landschaft area (47.3 to 47.6)")
            except (ValueError, TypeError) as e:
                if "Latitude should be" not in str(e):
                    raise ValueError("Invalid latitude value")
                raise
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v: str | Decimal | None) -> str | Decimal | None:
        """Validate longitude is within Basel-Landschaft area."""
        if v is not None:
            try:
                lng_val = float(str(v))
                if not (7.3 <= lng_val <= 7.9):
                    raise ValueError("Longitude should be within Basel-Landschaft area (7.3 to 7.9)")
            except (ValueError, TypeError) as e:
                if "Longitude should be" not in str(e):
                    raise ValueError("Invalid longitude value")
                raise
        return v

    @field_serializer("latitude", "longitude")
    def serialize_decimal(self, value: Decimal | None) -> str | None:
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


class TrainingLocationCreate(TrainingLocationBase):
    """Schema for creating training location.

    Adds the BL-range constraint on top of the base shape check — only
    enforced on writes, not on reads (Response uses the base validator).
    """

    @field_validator("postal_code")
    @classmethod
    def validate_postal_code_range(cls, v: str) -> str:
        code = int(v)
        if not (4000 <= code <= 4499):
            raise ValueError("Postal code should be in Basel-Landschaft range (4000-4499)")
        return v


class TrainingLocationResponse(TrainingLocationBase):
    """Schema for training location response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool

    def get_full_address(self) -> str:
        return f"{self.street} {self.house_number}, {self.postal_code} {self.city}"


# Auto-generation + simulation
class TrainingAutoGenSettings(BaseModel):
    """Schema for training auto-generation settings."""

    enabled: bool = False
    min_interval_sec: int = 120
    max_interval_sec: int = 420
    normal_weight: int = 90
    critical_weight: int = 10
    early_multiplier: float = 2.0


class GenerateEmergencyRequest(BaseModel):
    """Schema for manual emergency generation request."""

    category: str | None = None  # 'normal', 'critical', or None for random
    count: int = 1  # For burst generation (1-10)
    source: str = "operator"  # 'operator' (normal) or 'intake' (simulated phone/walk-in alarm)


class SimulateCheckinRequest(BaseModel):
    """Schema for simulating personnel check-in during training."""

    count: int = 10  # Number of personnel to check in (1-50)
    # 0 = check everyone in immediately; >0 = trickle the check-ins randomly
    # over this many minutes (max 30), mirroring how AdF actually arrive.
    over_minutes: int = 0


class SimulateCheckinResponse(BaseModel):
    """Response for simulated check-ins."""

    checked_in: list[str]
    total_checked_in: int
    total_available: int
    # Trickle mode: names scheduled to check in over the window (checked_in
    # stays empty — they arrive one by one via WebSocket updates).
    scheduled: list[str] = []
    trickle_minutes: int = 0


class SimulateDiveraRequest(BaseModel):
    """Schema for injecting a simulated Divera alarm into the pool."""

    category: str | None = None  # 'normal', 'critical', or None for weighted random


class SimulateInjectResponse(BaseModel):
    """Generic result of a trainer inject (reinforcement request etc.)."""

    message: str


class SimulateVehicleBreakdownResponse(BaseModel):
    """Result of a simulated vehicle breakdown."""

    vehicle_name: str
    message: str
