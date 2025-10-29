"""Export API endpoints."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor
from ..database import get_db
from ..services.audit import log_action
from ..services.event_export import export_event_to_zip

router = APIRouter(prefix="/exports", tags=["exports"])


@router.post("/events/{event_id}")
async def export_event(
    event_id: str,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """
    Export event and all related data to a ZIP archive.

    Includes:
    - Event metadata (JSON)
    - All incidents (JSON + Excel)
    - Status transitions (JSON)
    - Assignments (JSON)
    - Reko reports (JSON)
    """
    try:
        # Generate export
        zip_buffer = await export_event_to_zip(db, event_id)

        # Generate filename with timestamp
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        filename = f"event_export_{event_id[:8]}_{timestamp}.zip"

        # Audit log
        await log_action(
            db=db,
            action_type="export",
            resource_type="event",
            resource_id=event_id,
            user=current_user,
            changes={"filename": filename, "format": "zip"},
            request=request
        )
        await db.commit()

        # Return as streaming response
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")
