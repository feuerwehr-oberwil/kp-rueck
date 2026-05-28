"""Cross-domain shared schemas (sort order, settings)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CategorySortOrder(BaseModel):
    """Schema for updating category sort orders."""

    category: str  # The category name (role for personnel, location for materials)
    sort_order: int  # The new sort order value


class BulkCategorySortOrderUpdate(BaseModel):
    """Schema for bulk updating category sort orders."""

    categories: list[CategorySortOrder]


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
    updated_by: UUID | None = None
