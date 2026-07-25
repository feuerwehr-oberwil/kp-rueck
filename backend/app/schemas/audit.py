"""Audit log schemas."""

from datetime import datetime
from ipaddress import IPv4Address, IPv6Address
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer


class AuditLogEntry(BaseModel):
    """Audit log entry schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None = None
    action_type: str
    resource_type: str
    resource_id: UUID | None = None
    changes_json: dict | None = None
    timestamp: datetime
    ip_address: str | IPv4Address | IPv6Address | None = None
    user_agent: str | None = None

    @field_serializer("ip_address")
    def serialize_ip_address(self, ip_address: str | IPv4Address | IPv6Address | None, _info) -> str | None:
        """Convert IPv4Address/IPv6Address to string."""
        if ip_address is None:
            return None
        return str(ip_address)
