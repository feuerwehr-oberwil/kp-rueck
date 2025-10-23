"""Pydantic schemas for request/response validation."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
    type: str  # 'TLF', 'DLK', 'MTW'
    status: str  # 'available', 'assigned', 'maintenance'


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

    name: str
    type: Optional[str] = None  # 'Stromerzeuger', 'Pumpe', 'Beleuchtung'
    status: str  # 'available', 'assigned', 'maintenance'
    location: Optional[str] = None  # 'TLF 1', 'Lager Raum 3'


class MaterialCreate(MaterialBase):
    """Schema for creating material."""

    pass


class MaterialUpdate(BaseModel):
    """Schema for updating material."""

    name: Optional[str] = None
    type: Optional[str] = None
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


class IncidentBase(BaseModel):
    """Base incident schema."""

    title: str
    type: str  # 'fire', 'medical', 'technical', 'hazmat', 'other'
    priority: str  # 'low', 'medium', 'high', 'critical'
    location_address: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    status: str = "eingegangen"  # 'eingegangen', 'reko', 'disponiert', 'einsatz', 'einsatz_beendet', 'abschluss'
    training_flag: bool = False
    description: Optional[str] = None


class IncidentCreate(IncidentBase):
    """Schema for creating incident."""

    pass


class IncidentUpdate(BaseModel):
    """Schema for updating incident."""

    title: Optional[str] = None
    type: Optional[str] = None
    priority: Optional[str] = None
    location_address: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    status: Optional[str] = None
    training_flag: Optional[bool] = None
    description: Optional[str] = None
    completed_at: Optional[datetime] = None


class Incident(IncidentBase):
    """Full incident schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    completed_at: Optional[datetime] = None


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
