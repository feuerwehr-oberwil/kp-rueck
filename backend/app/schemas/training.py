"""Training-mode schemas: Excel imports, emergency templates, training locations, simulation."""

import re
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator


# Excel import/export
class ExcelImportPreview(BaseModel):
    """Preview of Excel import data."""

    personnel_preview: list[dict]
    personnel_total: int
    vehicles_preview: list[dict]
    vehicles_total: int
    materials_preview: list[dict]
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


class EmergencyTemplateCreate(EmergencyTemplateBase):
    """Schema for creating emergency template."""

    pass


class EmergencyTemplateResponse(EmergencyTemplateBase):
    """Schema for emergency template response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    is_active: bool


# Training locations
class TrainingLocationBase(BaseModel):
    """Base schema for training location."""

    street: str
    house_number: str
    postal_code: str = "4104"
    city: str = "Oberwil"
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
        """Validate Swiss postal code."""
        if not re.match(r"^\d{4}$", v):
            raise ValueError("Postal code must be 4 digits")
        code = int(v)
        if not (4000 <= code <= 4499):
            raise ValueError("Postal code should be in Basel-Landschaft range (4000-4499)")
        return v

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v: str | Decimal | None) -> str | Decimal | None:
        """Validate latitude is within Basel-Landschaft area."""
        if v is not None:
            try:
                lat_val = float(str(v))
                if not (47.3 <= lat_val <= 47.6):
                    raise ValueError(
                        "Latitude should be within Basel-Landschaft area (47.3 to 47.6)"
                    )
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
                    raise ValueError(
                        "Longitude should be within Basel-Landschaft area (7.3 to 7.9)"
                    )
            except (ValueError, TypeError) as e:
                if "Longitude should be" not in str(e):
                    raise ValueError("Invalid longitude value")
                raise
        return v

    @field_serializer("latitude", "longitude")
    def serialize_decimal(self, value):
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


class TrainingLocationCreate(TrainingLocationBase):
    """Schema for creating training location."""

    pass


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


class SimulateCheckinRequest(BaseModel):
    """Schema for simulating personnel check-in during training."""

    count: int = 10  # Number of personnel to check in (1-50)


class SimulateCheckinResponse(BaseModel):
    """Response for simulated check-ins."""

    checked_in: list[str]
    total_checked_in: int
    total_available: int
