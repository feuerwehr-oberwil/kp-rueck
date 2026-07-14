"""Export API endpoints for audit and payment processing."""

import asyncio
import re
import uuid
from datetime import UTC, datetime
from io import BytesIO
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
from ..services.audit_export_service import (
    collect_event_report_data,
    export_event_audit_excel,
    get_safe_filename,
)
from ..services.lageblatt_service import build_lageblatt_pdf
from ..services.pdf_report_service import build_event_report_pdf
from ..services.settings import get_setting_value
from ..utils.errors import ErrorMessages

logger = get_logger(__name__)

router = APIRouter(prefix="/exports", tags=["exports"])

# Umlaut transliteration for ASCII-safe report filenames.
_UMLAUT_MAP = str.maketrans(
    {
        "ä": "ae",
        "ö": "oe",
        "ü": "ue",
        "Ä": "ae",
        "Ö": "oe",
        "Ü": "ue",
        "ß": "ss",
    }
)


def slugify_event_name(name: str) -> str:
    """ASCII-slugify an event name for a report filename.

    Lowercase, transliterate umlauts (ä→ae, ö→oe, ü→ue, ß→ss), map any remaining
    non-alphanumeric run to a single ``-`` and trim leading/trailing dashes.
    """
    lowered = name.lower().translate(_UMLAUT_MAP)
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "ereignis"


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


@router.get("/events/{event_id}/report")
@limiter.limit(RateLimits.EXPORT)
async def export_event_report(
    request: Request,
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,  # Only editors can export
):
    """
    Generate a presentable PDF after-action report (Einsatzbericht) for an event.

    Unlike the Excel audit export (built for billing), this is a formatted debrief
    /handover document: cover block, summary counts, an incident overview table and
    per-incident detail sections (description, contact, flags, assignments, status
    timeline, reko summaries).

    Args:
        event_id: UUID of the event to report on

    Returns:
        StreamingResponse with a PDF file (``application/pdf``).

    Raises:
        404: Event not found
        500: Report generation failed
    """
    # Verify event exists (mirror the audit endpoint's 404 handling).
    event_result = await db.execute(select(Event).where(Event.id == event_id))
    event = event_result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Event {event_id} not found")

    try:
        # Gather data (async, DB-bound) then render the PDF off the event loop
        # (reportlab is synchronous and CPU-bound).
        data = await collect_event_report_data(db, event_id)
        funkrufname = await get_setting_value(db, "funkrufname", "")
        home_city = await get_setting_value(db, "home_city", "")
        pdf_bytes = await asyncio.to_thread(
            build_event_report_pdf,
            data,
            current_user.username,
            funkrufname,
            home_city,
        )

        # Audit-log the export (same pattern as the Excel export).
        audit_entry = AuditLog(
            user_id=current_user.id,
            action_type="report_export",
            resource_type="event",
            resource_id=event_id,
            changes_json={
                "exported_at": datetime.now(UTC).isoformat(),
                "incident_count": len(data.incidents),
                "format": "pdf",
            },
            timestamp=datetime.now(UTC),
        )
        db.add(audit_entry)
        await db.commit()

        date_str = datetime.now(UTC).strftime("%Y-%m-%d")
        filename = f"einsatzbericht-{slugify_event_name(event.name)}-{date_str}.pdf"

        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Einsatz nicht gefunden")

    except Exception as e:
        logger.error("Report export generation failed for event %s: %s", event_id, e, exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=ErrorMessages.EXPORT_FAILED)


@router.get("/events/{event_id}/lageblatt")
@limiter.limit(RateLimits.EXPORT)
async def export_event_lageblatt(
    request: Request,
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Generate the Lageblatt PDF — the paper-fallback snapshot of the current board.

    One row per incident in the layout of the cantonal Führungsformular
    (Elementarschaden FWI BL/BS) plus empty rows for handwritten continuation
    when the digital board is unavailable.

    Raises:
        404: Event not found
        500: Generation failed
    """
    event_result = await db.execute(select(Event).where(Event.id == event_id))
    event = event_result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Event {event_id} not found")

    try:
        data = await collect_event_report_data(db, event_id)
        home_city = await get_setting_value(db, "home_city", "")
        pdf_bytes = await asyncio.to_thread(build_lageblatt_pdf, data, home_city)

        date_str = datetime.now(UTC).strftime("%Y-%m-%d-%H%M")
        filename = f"lageblatt-{slugify_event_name(event.name)}-{date_str}.pdf"

        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except Exception as e:
        logger.error("Lageblatt generation failed for event %s: %s", event_id, e, exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=ErrorMessages.EXPORT_FAILED)
