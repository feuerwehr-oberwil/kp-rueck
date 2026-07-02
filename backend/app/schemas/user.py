"""User + Microsoft auth schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class MicrosoftLoginRequest(BaseModel):
    """Schema for Microsoft login callback."""

    code: str


class MicrosoftAuthConfig(BaseModel):
    """Schema for exposing Microsoft auth config to frontend."""

    enabled: bool
    client_id: str = ""
    tenant_id: str = ""
    redirect_uri: str = ""


class UserBase(BaseModel):
    """Base user schema."""

    username: str
    role: str  # 'admin', 'editor', or 'viewer' (read-only login)
    display_name: str = ""


class UserCreate(UserBase):
    """Schema for creating user (admin only)."""

    password: str


class UserUpdate(BaseModel):
    """Schema for updating user (admin only)."""

    username: str | None = None
    role: str | None = None
    display_name: str | None = None
    is_active: bool | None = None


class UserPasswordReset(BaseModel):
    """Schema for resetting user password (admin only)."""

    new_password: str


class User(UserBase):
    """Full user schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool = True
    created_at: datetime
    last_login: datetime | None = None


# Alias for API responses (matches task specification)
UserResponse = User
