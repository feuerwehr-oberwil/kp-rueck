"""Cross-domain shared schemas (sort order, settings)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

# The three things a resource assignment can point at. Not just a convention: both
# assignment tables carry a `valid_resource_type` CHECK constraint over exactly these
# values (`880ce6c5ec4d`, `e7b3c1a9f2d5`), which is why response models may be typed
# with it – no stored row can be outside the set, so no read can be turned into a 500.
# Used to be a bare `str` plus a hand-written validator, which meant `docs/openapi.json`
# – the only API reference a self-hoster has, Swagger being off in production – said
# "string" and a scripter learned the legal values from a 422.
ResourceType = Literal["personnel", "vehicle", "material"]


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


class AlarmWebhookSecret(BaseModel):
    """The shared secret for POST /api/alarms, handed back to an admin who asked for it.

    ``source`` is not decoration: ``ALARM_WEBHOOK_SECRET`` in the environment wins over the
    database value, so an admin looking at ``env`` needs to know that rotating from the UI
    would change nothing and the value has to move in ``.env`` instead.
    """

    secret: str
    source: Literal["env", "database"]
    configured: bool
