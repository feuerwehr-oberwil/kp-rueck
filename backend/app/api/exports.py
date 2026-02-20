"""Export API endpoints for audit and payment processing."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor
from ..database import get_db
from ..logging_config import get_logger
from ..middleware.rate_limit import RateLimits, limiter
from ..models import AuditLog, Event
from ..services.audit_export_service import export_event_audit_excel, get_safe_filename
from ..utils.errors import ErrorMessages

logger = get_logger(__name__)

router = APIRouter(prefix="/exports", tags=["exports"])


@router.post("/events/{event_id}/audit")
@limiter.limit(RateLimits.EXPORT)
async def export_event_audit(
    request: Request,
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,  # Only editors can export
):
    """
    Export complete event audit data for payment processing.

    Returns an Excel workbook with comprehensive audit data including:
    - Sheet 1: Event overview with summary counts
    - Sheet 2: All incidents with timestamps
    - Sheet 3: Personnel assignments (current + historical)
    - Sheet 4: Vehicle assignments (current + historical)
    - Sheet 5: Material assignments (current + historical)
    - Sheet 6: Status transition history
    - Sheet 7: Reko reports

    Unlike a simple export which only shows currently-assigned resources,
    this export includes the full assignment history with timestamps showing
    when each resource was assigned and released.

    All timestamps are in ISO 8601 format with timezone.

    Args:
        event_id: UUID of the event to export

    Returns:
        StreamingResponse with Excel file

    Raises:
        404: Event not found
        500: Export generation failed
    """
    # Verify event exists
    event_result = await db.execute(select(Event).where(Event.id == event_id))
    event = event_result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Event {event_id} not found")

    try:
        # Generate audit export
        excel_buffer, metadata = await export_event_audit_excel(db, event_id, current_user)

        # Create audit log entry
        audit_entry = AuditLog(
            user_id=current_user.id,
            action_type="audit_export",
            resource_type="event",
            resource_id=event_id,
            changes_json=metadata,
            timestamp=datetime.now(UTC),
        )
        db.add(audit_entry)
        await db.commit()

        # Generate filename
        event_name_safe = get_safe_filename(event.name)
        filename = f"audit_{event_name_safe}_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.xlsx"

        return StreamingResponse(
            excel_buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Einsatz nicht gefunden")

    except Exception as e:
        # Log error with full details
        logger.error("Audit export generation failed for event %s: %s", event_id, e, exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=ErrorMessages.EXPORT_FAILED)
