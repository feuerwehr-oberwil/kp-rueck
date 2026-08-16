"""Audit log schemas."""

from datetime import datetime
from ipaddress import IPv4Address, IPv6Address
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer


class AuditLogEntry(BaseModel):
    """Audit log entry schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None = None
    action_type: str
    # Stays a bare `str`, and is NOT the assignment `ResourceType`. This is whatever the
    # audited action touched – 'setting', 'bulk_data', 'incident', 'user', 'event',
    # 'reko_photo', 'training_data', 'personnel_assignment', … – an open vocabulary that
    # grows with every new audited call site and has no CHECK constraint behind it. A
    # Literal here would turn a years-old log row into a 500 the first time somebody read
    # the audit trail, which is the one table you read *because* something went wrong.
    resource_type: str
    resource_id: UUID | None = None
    changes_json: dict[str, Any] | None = None
    timestamp: datetime
    ip_address: str | IPv4Address | IPv6Address | None = None
    user_agent: str | None = None

    @field_serializer("ip_address")
    def serialize_ip_address(self, ip_address: str | IPv4Address | IPv6Address | None, _info: Any) -> str | None:
        """Convert IPv4Address/IPv6Address to string."""
        if ip_address is None:
            return None
        return str(ip_address)
