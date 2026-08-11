"""Admin API endpoints for import/export."""

import asyncio
import logging
from datetime import datetime
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..config import settings
from ..database import get_db
from ..seed_training import seed_training_data
from ..services.audit import log_action
from ..services.excel_import_export import (
    ExcelImportError,
    export_data_to_excel,
    generate_empty_template,
    import_data,
    validate_and_parse_excel,
)
from ..utils.errors import ErrorMessages

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/import/template")
async def download_import_template(
    current_user: CurrentEditor,
) -> StreamingResponse:
    """Download empty Excel template for data import."""
    # openpyxl work off the event loop (audit H4)
    template_bytes = await asyncio.to_thread(generate_empty_template)

    filename = "kprueck_import_template.xlsx"

    return StreamingResponse(
        template_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import/preview", response_model=schemas.ExcelImportPreview)
async def preview_excel_import(
    current_user: CurrentEditor,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """
    Preview Excel import without committing to database.
    Returns first 10 rows of each sheet for user confirmation.
    """
    if not (file.filename or "").endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be Excel format (.xlsx)")

    file_bytes = await file.read()

    max_bytes = settings.max_excel_import_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Excel-Datei zu gross. Maximale Grösse: {settings.max_excel_import_mb}MB",
        )

    try:
        # openpyxl parsing off the event loop (audit H4)
        parsed_data = await asyncio.to_thread(validate_and_parse_excel, file_bytes)
    except ExcelImportError:
        raise HTTPException(status_code=400, detail="Excel-Datei konnte nicht verarbeitet werden") from None

    # Return preview (first 10 rows of each type)
    return {
        "personnel_preview": parsed_data["personnel"][:10],
        "personnel_total": len(parsed_data["personnel"]),
        "vehicles_preview": parsed_data["vehicles"][:10],
        "vehicles_total": len(parsed_data["vehicles"]),
        "materials_preview": parsed_data["materials"][:10],
        "materials_total": len(parsed_data["materials"]),
    }


@router.post("/import/execute", response_model=schemas.ExcelImportResult)
async def execute_excel_import(
    current_user: CurrentEditor,
    file: UploadFile = File(...),
    # `Form(...)`, not a bare default: the client sends `mode` in the multipart body next to
    # the file. Without it FastAPI binds from the QUERY STRING, nothing ever supplies it there,
    # and every import silently ran as "replace" — deleting the whole roster, fleet and material
    # inventory on an import the operator asked to APPEND.
    mode: str = Form("replace"),  # replace, merge, or append
    db: AsyncSession = Depends(get_db),
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    request: Request = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """
    Execute Excel import with specified mode.

    Modes:
    - replace: Delete all existing data, insert new
    - merge: Update existing by name, add new (treated as replace for now)
    - append: Keep existing, add new
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Datenimport ist im Demo-Modus nicht verfügbar",
        )

    if mode not in ("replace", "merge", "append"):
        raise HTTPException(status_code=400, detail="Invalid mode. Must be replace, merge, or append")
    import_mode = cast(Literal["replace", "merge", "append"], mode)

    if not (file.filename or "").endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be Excel format (.xlsx)")

    file_bytes = await file.read()

    max_bytes = settings.max_excel_import_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Excel-Datei zu gross. Maximale Grösse: {settings.max_excel_import_mb}MB",
        )

    try:
        # openpyxl parsing off the event loop (audit H4)
        parsed_data = await asyncio.to_thread(validate_and_parse_excel, file_bytes)
    except ExcelImportError:
        raise HTTPException(status_code=400, detail="Excel-Datei konnte nicht verarbeitet werden") from None

    counts = await import_data(db, parsed_data, import_mode, str(current_user.id))

    # Audit log
    await log_action(
        db=db,
        action_type="import",
        resource_type="bulk_data",
        resource_id=None,
        user=current_user,
        changes={
            "mode": mode,
            "counts": counts,
            "filename": file.filename,
        },
        request=request,
    )
    await db.commit()

    return {
        "success": True,
        "mode": mode,
        "counts": counts,
        "timestamp": datetime.utcnow(),
    }


@router.get("/export/data")
async def export_all_data(
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    request: Request = None,  # type: ignore[assignment]
) -> StreamingResponse:
    """Export all personnel, vehicles, and materials to Excel."""
    excel_bytes = await export_data_to_excel(db)

    filename = f"kprueck_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"

    # Audit log
    await log_action(
        db=db,
        action_type="export",
        resource_type="bulk_data",
        resource_id=None,
        user=current_user,
        changes={"filename": filename},
        request=request,
    )
    await db.commit()

    return StreamingResponse(
        excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/seed-training", response_model=None)
async def seed_training_templates(
    current_user: CurrentEditor,
    skip_geocoding: bool = True,
    force_reseed: bool = False,
    db: AsyncSession = Depends(get_db),
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    request: Request = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """
    Manually seed training emergency templates and locations.
    Use this endpoint if automatic seeding failed during deployment.

    Args:
        skip_geocoding: Skip geocoding and use demo fallback coordinates (faster)
        force_reseed: Delete existing data and reseed (useful for updating addresses)
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seeding ist im Demo-Modus nicht verfügbar",
        )

    try:
        # If force_reseed, delete existing training data first
        if force_reseed:
            from sqlalchemy import delete

            from ..models import EmergencyTemplate, TrainingLocation

            await db.execute(delete(TrainingLocation))
            await db.execute(delete(EmergencyTemplate))
            await db.commit()

        await seed_training_data(skip_geocoding=skip_geocoding)

        # Audit log
        await log_action(
            db=db,
            action_type="seed",
            resource_type="training_data",
            resource_id=None,
            user=current_user,
            changes={
                "skip_geocoding": skip_geocoding,
                "force_reseed": force_reseed,
                "action": "manual_seed_training_data",
            },
            request=request,
        )
        await db.commit()

        return {
            "success": True,
            "message": "Training data seeded successfully",
            "skip_geocoding": skip_geocoding,
            "force_reseed": force_reseed,
        }
    except Exception as e:
        logger.error("Failed to seed training data: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorMessages.PROCESSING_FAILED) from e
