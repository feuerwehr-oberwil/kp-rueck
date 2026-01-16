"""Export API endpoints for legal compliance and archival."""

import re
import uuid
import zipfile
from datetime import datetime
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor
from ..database import get_db
from ..models import AuditLog, Event
from ..services.export_service import (
    export_event_excel,
    export_event_pdf,
    export_event_photos,
)

router = APIRouter(prefix="/exports", tags=["exports"])


@router.post("/events/{event_id}")
async def export_event(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,  # Only editors can export
):
    """
    Export complete event as PDF + Excel + Photos ZIP.

    Returns a single ZIP file containing:
    - bericht.pdf: Complete event report in PDF/A format
    - daten.xlsx: Event data in Excel format
    - fotos.zip: All photos from Reko reports (if any exist)

    Args:
        event_id: UUID of the event to export

    Returns:
        StreamingResponse with ZIP file containing all exports

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
        # Generate exports
        pdf_buffer = await export_event_pdf(db, event_id, current_user)
        excel_buffer = await export_event_excel(db, event_id)
        photos_buffer = await export_event_photos(db, event_id)

        # Combine into single ZIP
        combined_buffer = BytesIO()
        with zipfile.ZipFile(combined_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("bericht.pdf", pdf_buffer.getvalue())
            zf.writestr("daten.xlsx", excel_buffer.getvalue())

            # Only include photos ZIP if photos exist
            if photos_buffer:
                zf.writestr("fotos.zip", photos_buffer.getvalue())

        combined_buffer.seek(0)

        # Create audit log entry
        audit_entry = AuditLog(
            user_id=current_user.id,
            action_type="export",
            resource_type="event",
            resource_id=event_id,
            changes_json={"exported_at": datetime.utcnow().isoformat()},
            timestamp=datetime.utcnow(),
        )
        db.add(audit_entry)
        await db.commit()

        # Generate filename - only ASCII alphanumeric characters allowed in HTTP headers
        # Non-ASCII characters (like Japanese, umlauts) are replaced with underscores
        event_name_safe = "".join(
            c if c.isascii() and (c.isalnum() or c in (" ", "-", "_")) else "_"
            for c in event.name
        )
        # Collapse multiple underscores and strip trailing underscores
        event_name_safe = re.sub(r"_+", "_", event_name_safe).strip("_")
        filename = f"export_{event_name_safe}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"

        return StreamingResponse(
            combined_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except Exception as e:
        # Log error
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Export generation failed: {str(e)}"
        )
