"""Pydantic schemas for request/response validation."""
from datetime import datetime
from decimal import Decimal
from enum import Enum
from ipaddress import IPv4Address, IPv6Address
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer


# ============================================
# Personnel Schemas
# ============================================


class PersonnelBase(BaseModel):
    """Base personnel schema."""

    name: str
    role: Optional[str] = None
    availability: str  # 'available', 'assigned', 'unavailable'


class PersonnelCreate(PersonnelBase):
    """Schema for creating personnel."""

    pass


class PersonnelUpdate(BaseModel):
    """Schema for updating personnel."""

    name: Optional[str] = None
    role: Optional[str] = None
    availability: Optional[str] = None


class Personnel(PersonnelBase):
    """Full personnel schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


# ============================================
# Vehicle Schemas
# ============================================


class VehicleBase(BaseModel):
    """Base vehicle schema."""

    name: str
    type: str  # Configurable vehicle types (e.g., 'TLF', 'DLK', 'MTW')
    status: str  # 'available', 'assigned', 'planned', 'maintenance'


class VehicleCreate(VehicleBase):
    """Schema for creating vehicle."""

    pass


class VehicleUpdate(BaseModel):
    """Schema for updating vehicle."""

    name: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None


class Vehicle(VehicleBase):
    """Full vehicle schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


# ============================================
# Material Schemas
# ============================================


class MaterialBase(BaseModel):
    """Base material schema."""

    name: str  # Descriptive name including type/location (e.g., 'pump small from car 1')
    status: str  # 'available', 'assigned', 'planned', 'maintenance'
    location: Optional[str] = None  # Storage location (e.g., 'TLF 1', 'Lager Raum 3')


class MaterialCreate(MaterialBase):
    """Schema for creating material."""

    pass


class MaterialUpdate(BaseModel):
    """Schema for updating material."""

    name: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None


class Material(MaterialBase):
    """Full material schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


# ============================================
# Incident Schemas (formerly Operation)
# ============================================


class IncidentType(str, Enum):
    """Incident type enumeration."""

    BRANDBEKAEMPFUNG = "brandbekaempfung"
    ELEMENTAREREIGNIS = "elementarereignis"
    STRASSENRETTUNG = "strassenrettung"
    TECHNISCHE_HILFELEISTUNG = "technische_hilfeleistung"
    OELWEHR = "oelwehr"
    CHEMIEWEHR = "chemiewehr"
    STRAHLENWEHR = "strahlenwehr"
    EINSATZ_BAHNANLAGEN = "einsatz_bahnanlagen"
    BMA_UNECHTE_ALARME = "bma_unechte_alarme"
    DIENSTLEISTUNGEN = "dienstleistungen"
    DIVERSE_EINSAETZE = "diverse_einsaetze"
    GERETTETE_MENSCHEN = "gerettete_menschen"
    GERETTETE_TIERE = "gerettete_tiere"


class IncidentPriority(str, Enum):
    """Incident priority enumeration."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IncidentStatus(str, Enum):
    """Incident status enumeration."""

    EINGEGANGEN = "eingegangen"
    REKO = "reko"
    DISPONIERT = "disponiert"
    EINSATZ = "einsatz"
    EINSATZ_BEENDET = "einsatz_beendet"
    ABSCHLUSS = "abschluss"


class IncidentBase(BaseModel):
    """Base incident schema."""

    title: str
    type: IncidentType
    priority: IncidentPriority
    location_address: Optional[str] = None
    location_lat: Optional[Decimal] = None
    location_lng: Optional[Decimal] = None
    status: IncidentStatus = IncidentStatus.EINGEGANGEN
    training_flag: bool = False
    description: Optional[str] = None


class IncidentCreate(IncidentBase):
    """Schema for creating incident."""

    pass


class IncidentUpdate(BaseModel):
    """Schema for updating incident."""

    title: Optional[str] = None
    type: Optional[IncidentType] = None
    priority: Optional[IncidentPriority] = None
    location_address: Optional[str] = None
    location_lat: Optional[Decimal] = None
    location_lng: Optional[Decimal] = None
    status: Optional[IncidentStatus] = None
    description: Optional[str] = None
    # training_flag intentionally excluded (use separate endpoint)


class IncidentResponse(IncidentBase):
    """Full incident schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    completed_at: Optional[datetime] = None


# Alias for backwards compatibility
Incident = IncidentResponse


# ============================================
# Status Transition Schemas
# ============================================


class StatusTransitionCreate(BaseModel):
    """Schema for creating status transition."""

    from_status: IncidentStatus
    to_status: IncidentStatus
    notes: Optional[str] = None


class StatusTransitionResponse(BaseModel):
    """Status transition response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    from_status: str
    to_status: str
    timestamp: datetime
    user_id: Optional[UUID] = None
    notes: Optional[str] = None


# ============================================
# User Schemas
# ============================================


class UserBase(BaseModel):
    """Base user schema."""

    username: str
    role: str  # 'editor', 'viewer'


class UserCreate(UserBase):
    """Schema for creating user."""

    password: str


class User(UserBase):
    """Full user schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    last_login: Optional[datetime] = None


# Alias for API responses (matches task specification)
UserResponse = User


# ============================================
# Setting Schemas
# ============================================


class SettingBase(BaseModel):
    """Base setting schema."""

    key: str
    value: str


class SettingUpdate(BaseModel):
    """Schema for updating setting."""

    value: str


class Setting(SettingBase):
    """Full setting schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    updated_at: datetime
    updated_by: Optional[UUID] = None


# ============================================
# Audit Log Schemas
# ============================================


class AuditLogEntry(BaseModel):
    """Audit log entry schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: Optional[UUID] = None
    action_type: str
    resource_type: str
    resource_id: Optional[UUID] = None
    changes_json: Optional[dict] = None
    timestamp: datetime
    ip_address: Optional[Union[str, IPv4Address, IPv6Address]] = None
    user_agent: Optional[str] = None

    @field_serializer('ip_address')
    def serialize_ip_address(self, ip_address: Optional[Union[str, IPv4Address, IPv6Address]], _info) -> Optional[str]:
        """Convert IPv4Address/IPv6Address to string."""
        if ip_address is None:
            return None
        return str(ip_address)
