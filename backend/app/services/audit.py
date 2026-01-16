"""Audit logging service for comprehensive action tracking."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog, User

# Fields that should never be logged for security reasons
SENSITIVE_FIELDS = frozenset(
    {
        # Authentication
        "password",
        "password_hash",
        "token",
        "access_token",
        "refresh_token",
        "secret",
        "secret_key",
        "api_key",
        # Personal identifiable information
        "email",
        "phone",
        "phone_number",
        # Other sensitive data
        "credit_card",
        "card_number",
        "cvv",
        "ssn",
        "social_security",
    }
)


def _sanitize_changes(changes: dict[str, Any] | None) -> dict[str, Any] | None:
    """
    Remove sensitive fields from changes dict before logging.

    Security: Prevents passwords, tokens, and PII from being stored in audit logs.
    """
    if changes is None:
        return None

    def sanitize_value(key: str, value: Any) -> Any:
        """Recursively sanitize nested dictionaries."""
        # Check if key contains sensitive field name (case-insensitive)
        key_lower = key.lower()
        for sensitive in SENSITIVE_FIELDS:
            if sensitive in key_lower:
                return "[REDACTED]"

        # Recursively sanitize nested dicts
        if isinstance(value, dict):
            return {k: sanitize_value(k, v) for k, v in value.items()}

        # Recursively sanitize lists
        if isinstance(value, list):
            return [sanitize_value(key, item) if isinstance(item, dict) else item for item in value]

        return value

    return {k: sanitize_value(k, v) for k, v in changes.items()}


async def log_action(
    db: AsyncSession,
    action_type: str,
    resource_type: str,
    resource_id: uuid.UUID | None = None,
    user: User | None = None,
    changes: dict[str, Any] | None = None,
    request: Request | None = None,
) -> AuditLog:
    """
    Create an audit log entry.

    Args:
        db: Database session
        action_type: Type of action (create, update, delete, assign, login, etc.)
        resource_type: Type of resource affected (incident, vehicle, personnel, etc.)
        resource_id: UUID of affected resource (if applicable)
        user: User who performed the action (None for system actions)
        changes: Before/after state for updates (JSON format)
        request: FastAPI request object (for IP/user-agent capture)

    Returns:
        Created AuditLog instance

    Example usage:
        await log_action(
            db=db,
            action_type="update",
            resource_type="incident",
            resource_id=incident.id,
            user=current_user,
            changes={
                "before": {"status": "eingegangen"},
                "after": {"status": "reko"}
            },
            request=request
        )
    """
    # Extract request metadata
    ip_address = None
    user_agent = None

    if request:
        # Get real IP (handle reverse proxy)
        # X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        # We want the first one (the original client)
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # Take only the first IP (client IP)
            ip_address = forwarded_for.split(",")[0].strip()
        else:
            ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("User-Agent")

    # Create log entry
    # Skip user_id if it's the auth bypass mock user (doesn't exist in DB)
    user_id = None
    if user:
        # Check if this is the mock bypass user (00000000-0000-0000-0000-000000000000)
        if str(user.id) != "00000000-0000-0000-0000-000000000000":
            user_id = user.id

    # Sanitize changes to remove sensitive data before storing
    sanitized_changes = _sanitize_changes(changes)

    audit_entry = AuditLog(
        user_id=user_id,
        action_type=action_type,
        resource_type=resource_type,
        resource_id=resource_id,
        changes_json=sanitized_changes,
        ip_address=ip_address,
        user_agent=user_agent,
        timestamp=datetime.utcnow(),
    )

    db.add(audit_entry)
    await db.flush()  # Don't commit yet (let caller handle transaction)

    return audit_entry


async def log_login(db: AsyncSession, user: User, request: Request, success: bool = True) -> AuditLog:
    """
    Log login attempt (success or failure).

    Args:
        db: Database session
        user: User attempting login
        request: Request object
        success: Whether login succeeded

    Returns:
        Created AuditLog instance
    """
    action_type = "login_success" if success else "login_failure"

    return await log_action(
        db=db,
        action_type=action_type,
        resource_type="user",
        resource_id=user.id,
        user=user if success else None,
        request=request,
    )


async def log_logout(db: AsyncSession, user: User, request: Request) -> AuditLog:
    """Log logout event."""
    return await log_action(
        db=db,
        action_type="logout",
        resource_type="user",
        resource_id=user.id,
        user=user,
        request=request,
    )


def calculate_changes(before: dict, after: dict) -> dict:
    """
    Calculate diff between before/after states.

    Args:
        before: Previous state
        after: New state

    Returns:
        Dict with before/after values for changed fields only

    Example:
        before = {"status": "eingegangen", "priority": "high"}
        after = {"status": "reko", "priority": "high"}
        result = {
            "status": {"before": "eingegangen", "after": "reko"}
        }
    """
    changes = {}

    # Find all keys (from both dicts)
    all_keys = set(before.keys()) | set(after.keys())

    for key in all_keys:
        before_val = before.get(key)
        after_val = after.get(key)

        if before_val != after_val:
            changes[key] = {
                "before": before_val,
                "after": after_val,
            }

    return changes
