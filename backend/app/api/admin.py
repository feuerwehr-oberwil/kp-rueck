"""Admin API endpoints for import/export."""
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..database import get_db
from ..services.excel_import_export import (
    generate_empty_template,
    validate_and_parse_excel,
    import_data,
    export_data_to_excel,
    ExcelImportError,
)
from ..services.audit import log_action
from ..seed_training import seed_training_data

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/import/template")
async def download_import_template(
    current_user: CurrentEditor,
):
    """Download empty Excel template for data import."""
    template_bytes = generate_empty_template()

    filename = "kprueck_import_template.xlsx"

    return StreamingResponse(
        template_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.post("/import/preview", response_model=schemas.ExcelImportPreview)
async def preview_excel_import(
    current_user: CurrentEditor,
    file: UploadFile = File(...),
):
    """
    Preview Excel import without committing to database.
    Returns first 10 rows of each sheet for user confirmation.
    """
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be Excel format (.xlsx)")

    file_bytes = await file.read()

    try:
        parsed_data = validate_and_parse_excel(file_bytes)
    except ExcelImportError as e:
        raise HTTPException(status_code=400, detail=str(e))

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
    mode: str = "replace",  # replace, merge, or append
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """
    Execute Excel import with specified mode.

    Modes:
    - replace: Delete all existing data, insert new
    - merge: Update existing by name, add new (treated as replace for now)
    - append: Keep existing, add new
    """
    if mode not in ["replace", "merge", "append"]:
        raise HTTPException(status_code=400, detail="Invalid mode. Must be replace, merge, or append")

    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be Excel format (.xlsx)")

    file_bytes = await file.read()

    try:
        parsed_data = validate_and_parse_excel(file_bytes)
    except ExcelImportError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Execute import
    counts = await import_data(
        db, parsed_data, mode, str(current_user.id)
    )

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
        request=request
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
    request: Request = None,
):
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
        request=request
    )
    await db.commit()

    return StreamingResponse(
        excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.post("/seed-training")
async def seed_training_templates(
    current_user: CurrentEditor,
    skip_geocoding: bool = True,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """
    Manually seed training emergency templates and locations.
    Use this endpoint if automatic seeding failed during deployment.

    Args:
        skip_geocoding: Skip geocoding and use Oberwil center coordinates (faster)
    """
    try:
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
                "action": "manual_seed_training_data"
            },
            request=request
        )
        await db.commit()

        return {
            "success": True,
            "message": "Training data seeded successfully",
            "skip_geocoding": skip_geocoding
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to seed training data: {str(e)}"
        )
