"""Audit logging service for comprehensive action tracking."""
from datetime import datetime
from typing import Any, Optional
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Request

from ..models import AuditLog, User


async def log_action(
    db: AsyncSession,
    action_type: str,
    resource_type: str,
    resource_id: Optional[uuid.UUID] = None,
    user: Optional[User] = None,
    changes: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
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
        ip_address = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
        user_agent = request.headers.get("User-Agent")

    # Create log entry
    # Skip user_id if it's the auth bypass mock user (doesn't exist in DB)
    user_id = None
    if user:
        # Check if this is the mock bypass user (00000000-0000-0000-0000-000000000000)
        if str(user.id) != "00000000-0000-0000-0000-000000000000":
            user_id = user.id

    audit_entry = AuditLog(
        user_id=user_id,
        action_type=action_type,
        resource_type=resource_type,
        resource_id=resource_id,
        changes_json=changes,
        ip_address=ip_address,
        user_agent=user_agent,
        timestamp=datetime.utcnow(),
    )

    db.add(audit_entry)
    await db.flush()  # Don't commit yet (let caller handle transaction)

    return audit_entry


async def log_login(
    db: AsyncSession,
    user: User,
    request: Request,
    success: bool = True
) -> AuditLog:
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
