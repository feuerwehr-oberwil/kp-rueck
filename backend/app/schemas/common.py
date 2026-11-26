"""Cross-domain shared schemas (sort order, settings)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict

# The three things a resource assignment can point at. Not just a convention: both
# assignment tables carry a `valid_resource_type` CHECK constraint over exactly these
# values (`880ce6c5ec4d`, `e7b3c1a9f2d5`), which is why response models may be typed
# with it – no stored row can be outside the set, so no read can be turned into a 500.
# Used to be a bare `str` plus a hand-written validator, which meant `docs/openapi.json`
# – the only API reference a self-hoster has, Swagger being off in production – said
# "string" and a scripter learned the legal values from a 422.
ResourceType = Literal["personnel", "vehicle", "material"]

# The two statuses a person, vehicle or material row holds (CHECK `valid_personnel_status`,
# `valid_vehicle_status`, `valid_material_status`).
AvailabilityStatus = Literal["available", "unavailable"]


def legacy_status(mapping: dict[str, AvailabilityStatus]) -> BeforeValidator:
    """Map an older client's status word (``"maintenance"`` …) onto the two the column holds.

    Use as ``Annotated[AvailabilityStatus, legacy_status({...})]``: a word outside the
    mapping falls through to the Literal, which refuses it with a 422.
    """
    return BeforeValidator(lambda value: mapping.get(value, value) if isinstance(value, str) else value)


class ShareLinkResponse(BaseModel):
    """A link the board hands out (check-in, viewer, alarm intake, `/feld`, Reko).

    ``link`` is relative: the client prefixes its own origin – the backend's
    ``request.base_url`` is the wrong host behind Railway's proxy. ``qr_code_data`` is
    what the QR code encodes (the link). ``valid_until`` is set where the slip prints its
    own expiry (the `/feld` poster).
    """

    token: str
    link: str
    qr_code_data: str
    valid_until: datetime | None = None

    @classmethod
    def for_link(cls, token: str, link: str, valid_until: datetime | None = None) -> "ShareLinkResponse":
        """The response for ``link``, encoded in its QR code as it is."""
        return cls(token=token, link=link, qr_code_data=link, valid_until=valid_until)


class CategorySortOrder(BaseModel):
    """Schema for updating category sort orders."""

    category: str  # The category name (role for personnel, location for materials)
    sort_order: int  # The new sort order value


class BulkCategorySortOrderUpdate(BaseModel):
    """Schema for bulk updating category sort orders."""

    categories: list[CategorySortOrder]


class CategorySortOrderResult(BaseModel):
    """The answer to a category sort-order update: how many categories were written."""

    status: Literal["success"] = "success"
    updated_categories: int


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
