"""Standard-Auftrag (Auftrag template) schemas — station configuration, not event data."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

# Narrower than `ResourceType` on purpose, and enforced by the
# `valid_template_resource_type` CHECK constraint: a template names equipment, not
# people. Who is on a squad is decided per Lage from who actually turned up.
TemplateResourceType = Literal["vehicle", "material"]


class AuftragTemplateResourceRef(BaseModel):
    """One vehicle or material a template brings along."""

    model_config = ConfigDict(from_attributes=True)

    resource_type: TemplateResourceType
    resource_id: UUID


class AuftragTemplateBase(BaseModel):
    """Fields shared by create and update. Mirrors the Auftrag's own limits."""

    name: str
    color: str | None = None
    notes: str | None = None
    auto_create: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Reject blank names and match IncidentGroup's 200-character limit."""
        if not v or not v.strip():
            raise ValueError("Name cannot be empty")
        if len(v) > 200:
            raise ValueError("Name must be 200 characters or less")
        return v.strip()

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v: str | None) -> str | None:
        """Match IncidentGroup.notes' 2000-character limit."""
        if v and len(v) > 2000:
            raise ValueError("Notes must be 2000 characters or less")
        return v.strip() if v else v


class AuftragTemplateCreate(AuftragTemplateBase):
    """Schema for creating a Standard-Auftrag."""

    resources: list[AuftragTemplateResourceRef] = []


class AuftragTemplateUpdate(BaseModel):
    """Partial PATCH. ``resources``, when given, REPLACES the whole list."""

    name: str | None = None
    color: str | None = None
    notes: str | None = None
    auto_create: bool | None = None
    resources: list[AuftragTemplateResourceRef] | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        """Same rules as on create, but only when the field is present."""
        if v is None:
            return v
        if not v.strip():
            raise ValueError("Name cannot be empty")
        if len(v) > 200:
            raise ValueError("Name must be 200 characters or less")
        return v.strip()

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v: str | None) -> str | None:
        """Same rules as on create, but only when the field is present."""
        if v and len(v) > 2000:
            raise ValueError("Notes must be 2000 characters or less")
        return v.strip() if v else v


class AuftragTemplateResponse(AuftragTemplateBase):
    """A Standard-Auftrag as the settings screen and the Vorlagen row read it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    position: int
    resources: list[AuftragTemplateResourceRef] = []
    created_at: datetime
    updated_at: datetime


class AuftragTemplateReorder(BaseModel):
    """New order for the settings list, most-significant first."""

    template_ids: list[UUID]
