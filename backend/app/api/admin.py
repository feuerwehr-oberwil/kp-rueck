"""Admin API endpoints for import/export."""

import asyncio
import logging
from datetime import UTC, datetime
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
    AssignmentBlocker,
    ExcelImportError,
    ImportDeletionImpact,
    ParsedImport,
    count_deletion_impact,
    export_data_to_excel,
    generate_empty_template,
    import_data,
    list_assignment_blockers,
    validate_and_parse_excel,
)
from ..utils.errors import ErrorMessages

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# Spelled out in every mode error: the operator picking a mode is picking whether
# the station keeps its roster, so the message has to say what each one does.
_MODE_CHOICES = (
    "'replace' (löscht Personal, Fahrzeuge und Material vollständig und lädt dann die Datei) "
    "oder 'append' (behält den Bestand und fügt die Zeilen der Datei hinzu)"
)

# The same fact for the committed contract, which is the ONLY API reference a
# self-hoster has (Swagger is off in production).
_MODE_DESCRIPTION = (
    "**Required.** `replace` (delete all personnel, vehicles and materials, then load the file) "
    "or `append` (keep them and add the file's rows). Sending neither is a 400, not a default."
)

# `mode` is declared with a `None` default so a missing value gets our German 400
# naming the modes instead of FastAPI's 422 field-error blob – but that made the
# generated schema call it optional and nullable, while docs/SETUP.md tells
# scripters it is mandatory. The contract, not the runtime, was the one lying:
# these two lines put `mode` back in the body's `required` list without touching
# the validation that produces the good error. Sibling keys next to `$ref` are
# legal in OpenAPI 3.1 (JSON Schema 2020-12), which is what FastAPI emits here.
_MODE_REQUIRED_IN_SCHEMA: dict[str, Any] = {
    "requestBody": {"content": {"multipart/form-data": {"schema": {"required": ["file", "mode"]}}}}
}


def _require_import_mode(mode: str | None) -> Literal["replace", "append"]:
    """Validate the import mode, refusing the two ways this endpoint destroyed data.

    No mode at all used to mean `replace`, so a request that forgot the field
    wiped the station. And `merge` was accepted and documented as "update
    existing by name, add new" while running the exact same DELETEs as
    `replace` – a station uploaded a one-row sheet with `mode=merge` to add two
    recruits and was left with one person, no vehicles and no material.
    """
    if mode is None:
        raise HTTPException(
            status_code=400,
            detail=f"Import-Modus fehlt. Wähle {_MODE_CHOICES}.",
        )
    if mode == "merge":
        raise HTTPException(
            status_code=400,
            detail=(
                "Der Modus 'merge' wird nicht mehr angeboten – er hat nie zusammengeführt, "
                f"sondern wie 'replace' alles gelöscht. Wähle {_MODE_CHOICES}."
            ),
        )
    if mode not in ("replace", "append"):
        raise HTTPException(
            status_code=400,
            detail=f"Ungültiger Import-Modus '{mode}'. Wähle {_MODE_CHOICES}.",
        )
    return cast(Literal["replace", "append"], mode)


async def _parse_or_400(file_bytes: bytes) -> ParsedImport:
    """Parse the upload, answering a rejected workbook with what the parser saw.

    Both handlers used to catch `ExcelImportError` and answer a flat "Excel-Datei
    konnte nicht verarbeitet werden", throwing away the sheet name and row number
    the parser had right there. The operator is a volunteer with an 18-row
    spreadsheet: without the row they bisect it by hand. `ExcelImportError.message`
    is written to be safe to forward – see its docstring.
    """
    try:
        # openpyxl parsing off the event loop (audit H4)
        return await asyncio.to_thread(validate_and_parse_excel, file_bytes)
    except ExcelImportError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Excel-Datei konnte nicht verarbeitet werden: {exc.message}",
        ) from None


def _refuse_missing_sheets(parsed_data: ParsedImport, impact: ImportDeletionImpact) -> None:
    """Refuse a `replace` whose workbook omits a sheet that has rows in the database.

    `replace` means "this file is the station now". A file with no Vehicles sheet
    says nothing about the fleet, and deleting it on that basis is a wipe with no
    reinsert – which is exactly what used to happen, `success: true` and all. The
    numbers in the preview could not warn about it either: they say how much would
    go, not that nothing is coming back.

    A sheet that is present and empty is untouched by this: that is a station
    deliberately clearing a table, and it stays allowed. In `append` mode every
    count in `impact` is zero, so this never fires – nothing is being deleted.
    """
    missing = [
        (sheet, label, count)
        for sheet, label, count, present in (
            ("Personnel", "Personal", impact["personnel"], parsed_data.personnel.present),
            ("Vehicles", "Fahrzeuge", impact["vehicles"], parsed_data.vehicles.present),
            ("Materials", "Material", impact["materials"], parsed_data.materials.present),
        )
        if not present and count > 0
    ]
    if not missing:
        return

    listed = ", ".join(
        f"'{sheet}' ({label}, {count} {'Zeile' if count == 1 else 'Zeilen'})" for sheet, label, count in missing
    )
    fehlt = f"fehlt das Blatt {listed}" if len(missing) == 1 else f"fehlen die Blätter {listed}"
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Import im Modus 'replace' abgelehnt: In der Datei {fehlt}. "
            "'replace' würde diese Daten löschen, ohne etwas an ihre Stelle zu setzen. "
            "Entweder eine Datei mit allen benötigten Blättern hochladen – ein Blatt mit Kopfzeile und ohne "
            "Zeilen leert die Tabelle bewusst – oder den Modus 'append' verwenden."
        ),
    )


# How many blockers the refusal names before it falls back to "und N weitere".
# Five is what an operator can still act on standing at the board; the point of
# the list is to be walked, and a 20-line wall of text is read as "it broke".
_BLOCKER_LIMIT = 5


def _remaining_label(remaining: list[AssignmentBlocker]) -> str:
    """The "weiterer Einsatz" / "weitere Aufträge" tail, true to what is in the tail.

    A mixed tail can never be singular, so it only needs the plural form.
    """
    kinds = {blocker["kind"] for blocker in remaining}
    if kinds == {"group"}:
        return "weiterer Auftrag" if len(remaining) == 1 else "weitere Aufträge"
    if kinds == {"incident"}:
        return "weiterer Einsatz" if len(remaining) == 1 else "weitere Einsätze"
    return "weitere Einsätze/Aufträge"


def _blocker_resources(blocker: AssignmentBlocker) -> str:
    """The blocking rows of one incident, per resource type, in German plurals."""
    counted = (
        (blocker["personnel"], "Person", "Personen"),
        (blocker["vehicles"], "Fahrzeug", "Fahrzeuge"),
        (blocker["materials"], "Material", "Materialien"),
    )
    return ", ".join(f"{count} {singular if count == 1 else plural}" for count, singular, plural in counted if count)


def _describe_blocker(blocker: AssignmentBlocker) -> str:
    """One blocker, identified the way it is identified on the board: title, then address.

    An Auftrag is prefixed, because otherwise the operator reads a route name as an
    Einsatz title, goes looking for a card that is not on the board, and – if they
    do find the stops – releases nothing, since the squad hangs off the route.
    """
    is_group = blocker["kind"] == "group"
    label = "Auftrag " if is_group else ""
    # A deleted incident/Auftrag is still a blocker – deleting one does not release
    # its resources – but it is not on the board, so saying only the title sends the
    # operator looking for a card that is not there.
    gone = ("gelöschter Auftrag" if is_group else "gelöschter Einsatz") if blocker["deleted"] else None
    context = [part for part in (blocker["location"], gone) if part]
    where = f" ({', '.join(context)})" if context else ""
    return f"{label}'{blocker['title']}'{where}: {_blocker_resources(blocker)}"


def _refuse_active_assignments(active_count: int, blockers: list[AssignmentBlocker]) -> None:
    """Refuse a `replace` while resources are still assigned – and name who holds them.

    The count alone was a dead end: the operator is told that six assignments are
    in the way and has no way to find the six, so they release what they can see,
    retry, and get the same number back. Name the incidents, break them down by
    resource type, and keep the three ways out.

    The material sentence is the other half of that dead end. `release-all` (and
    completing an incident) deliberately keeps materials assigned until they are
    returned via the Rapport, so an operator who did the one thing they know
    about still walks into this refusal – with the count unchanged if material
    was all that was left. This message has to be true for *that* operator.

    Aufträge are in the same list and the same count. Their resources live on the
    route, in a second polymorphic table that this refusal ignored entirely, so a
    storm batch with a squad on it went through as if the board were clear.
    """
    if active_count <= 0:
        return

    listed = "; ".join(_describe_blocker(blocker) for blocker in blockers[:_BLOCKER_LIMIT])
    remaining = blockers[_BLOCKER_LIMIT:]
    if remaining:
        listed += f"; und {len(remaining)} {_remaining_label(remaining)}"
    # Belt and braces: the list is built from the same rows as the count, so it is
    # only ever empty if that stops being true. Then say less rather than "Betroffen: ".
    betroffen = f"Betroffen: {listed}. " if listed else ""

    materials_block = any(blocker["materials"] for blocker in blockers)
    material_hint = (
        "Achtung: 'Alle freigeben' und das Abschliessen eines Einsatzes geben nur Personal und Fahrzeuge frei – "
        "zugeteiltes Material bleibt zugeteilt, bis es über den Rapport ('Material zurück – freigeben') "
        "zurückgenommen wird. "
        if materials_block
        else ""
    )

    # Only name Aufträge when one is actually in the way: on the ordinary board they
    # do not exist, and a refusal that mentions a concept the station has never used
    # reads as the tool being broken rather than as a thing to go and fix.
    groups_block = any(blocker["kind"] == "group" for blocker in blockers)
    holders = "laufenden Einsätzen und Aufträgen" if groups_block else "laufenden Einsätzen"
    way_out = (
        "Zuteilungen freigeben bzw. Einsätze und Aufträge abschliessen"
        if groups_block
        else "Zuteilungen freigeben bzw. Einsätze abschliessen"
    )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Import im Modus 'replace' abgelehnt: {active_count} aktive Zuteilung(en) auf {holders} "
            "zeigen auf Personal, Fahrzeuge oder Material, das dabei gelöscht würde. "
            f"{betroffen}{material_hint}"
            f"{way_out} – oder den Modus 'append' verwenden."
        ),
    )


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


@router.post(
    "/import/preview",
    response_model=schemas.ExcelImportPreview,
    openapi_extra=_MODE_REQUIRED_IN_SCHEMA,
)
async def preview_excel_import(
    current_user: CurrentEditor,
    file: UploadFile = File(...),
    # Same `Form(...)`-not-a-default story as the execute endpoint below, and the
    # same `None` sentinel so a missing mode is a 400 that names the choices
    # rather than FastAPI's 422 field-error blob.
    mode: str | None = Form(None, description=_MODE_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Preview Excel import without committing to database.

    Returns first 10 rows of each sheet plus, for the given mode, how much
    existing data the import would delete – including the assignments on running
    incidents that would be left pointing at deleted resources.
    """
    import_mode = _require_import_mode(mode)

    if not (file.filename or "").endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be Excel format (.xlsx)")

    file_bytes = await file.read()

    max_bytes = settings.max_excel_import_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Excel-Datei zu gross. Maximale Grösse: {settings.max_excel_import_mb}MB",
        )

    parsed_data = await _parse_or_400(file_bytes)

    # Return preview (first 10 rows of each type)
    return {
        "personnel_preview": parsed_data.personnel.rows[:10],
        "personnel_total": len(parsed_data.personnel.rows),
        "vehicles_preview": parsed_data.vehicles.rows[:10],
        "vehicles_total": len(parsed_data.vehicles.rows),
        "materials_preview": parsed_data.materials.rows[:10],
        "materials_total": len(parsed_data.materials.rows),
        "mode": import_mode,
        "deletions": await count_deletion_impact(db, import_mode),
    }


@router.post(
    "/import/execute",
    response_model=schemas.ExcelImportResult,
    openapi_extra=_MODE_REQUIRED_IN_SCHEMA,
)
async def execute_excel_import(
    current_user: CurrentEditor,
    file: UploadFile = File(...),
    # `Form(...)`, not a bare default: the client sends `mode` in the multipart body next to
    # the file. Without it FastAPI binds from the QUERY STRING, nothing ever supplies it there,
    # and every import silently ran as "replace" — deleting the whole roster, fleet and material
    # inventory on an import the operator asked to APPEND.
    # No default any more either: the wipe is not something a forgotten field gets to choose.
    # `None` rather than `Form(...)`, so the answer is our 400 naming the modes and not a 422.
    mode: str | None = Form(None, description=_MODE_DESCRIPTION),  # replace or append
    db: AsyncSession = Depends(get_db),
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    request: Request = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """
    Execute Excel import with specified mode. `mode` is required – there is no default.

    Modes:
    - replace: Delete all existing data, insert new
    - append: Keep existing, add new
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Datenimport ist im Demo-Modus nicht verfügbar",
        )

    import_mode = _require_import_mode(mode)

    if not (file.filename or "").endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be Excel format (.xlsx)")

    file_bytes = await file.read()

    max_bytes = settings.max_excel_import_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Excel-Datei zu gross. Maximale Grösse: {settings.max_excel_import_mb}MB",
        )

    parsed_data = await _parse_or_400(file_bytes)

    # A `replace` deletes every personnel, vehicle and material row, and assignments
    # reference their resource by a bare UUID with no foreign key – so the delete leaves
    # them behind, still active, on incidents that are still running. Refuse rather than
    # produce that state: the operator can release the resources, close the incidents, or
    # import with `append`. Historical (already released) assignments are not a reason to
    # block – they are history, and the export/import cycle is what a station uses to fix
    # a roster between operations.
    impact = await count_deletion_impact(db, import_mode)

    # The file's own problem before the board's: a workbook missing a sheet is fixed in
    # Excel, while live assignments are fixed on the board by someone else.
    _refuse_missing_sheets(parsed_data, impact)

    # BOTH assignment tables. `incident_group_assignments` was left out of this check for
    # as long as Aufträge existed, so a route holding the whole squad let the wipe through
    # – and it is the shape most likely to be holding resources during a storm, which is
    # exactly when someone reaches for a roster import.
    active_assignments = impact["active_incident_assignments"] + impact["active_incident_group_assignments"]
    if active_assignments > 0:
        # Second query, and only on the way out: naming the blockers costs two joins
        # that the happy path has no use for.
        _refuse_active_assignments(active_assignments, await list_assignment_blockers(db))

    counts = await import_data(db, parsed_data, import_mode, str(current_user.id))

    # Audit log
    await log_action(
        db=db,
        action_type="import",
        resource_type="bulk_data",
        resource_id=None,
        user=current_user,
        changes={
            "mode": import_mode,
            "counts": counts,
            # What the import destroyed, not only what it added – the audit trail was
            # unable to answer "where did the roster go" after the fact.
            "deletions": impact,
            "filename": file.filename,
        },
        request=request,
    )
    await db.commit()

    return {
        "success": True,
        "mode": import_mode,
        "counts": counts,
        "timestamp": datetime.now(UTC),
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

    filename = f"kprueck_export_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.xlsx"

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
        skip_geocoding: Also repair known legacy fallback addresses when True, preserving custom locations.
            Seeding never calls external address providers.
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
