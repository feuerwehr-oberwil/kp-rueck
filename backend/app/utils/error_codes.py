"""Errors with a stable code the client can say in its own language.

Backend error text is German. That is fine for the board's operators, but the `/feld`
phone (and the Reko form it opens) is held by whoever is on the crew, and a
French-speaking firefighter read «Bitte den Code neu eingeben.» on a French page. So a
crew-facing error (`/feld`, the Reko form, photo uploads) carries a ``code`` next to
its ``detail``:

    {"detail": "Bitte den Code neu eingeben.", "code": "feld_code_reenter"}

A code whose sentence needs a number carries it in ``params`` (``{"max_mb": 10}``),
under the same name as the ICU placeholder in the catalogue.

``detail`` stays the German sentence — an older client, curl and the logs keep working
unchanged. The client looks ``code`` up in ``errors.codes.<code>`` (``messages/*.json``,
``frontend/lib/api/error-codes.ts``) and falls back to ``detail`` when it does not know
it. A code is a contract: never rename one, add a new one instead.
``tests/test_api/test_error_codes.py`` holds every code to a German and a French
string in the frontend catalogues.

The Feld door's own three answers (``locked`` / ``code_required`` / ``wrong_code``)
already carried a code in ``detail.error`` before this existed and are read that way.
"""

from enum import StrEnum

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class ErrorCode(StrEnum):
    # The link and the device
    FELD_TOKEN_INVALID = "feld_token_invalid"  # noqa: S105 — an error code, not a secret
    FELD_DEVICE_SIGNED_OUT = "feld_device_signed_out"
    FELD_CODE_REENTER = "feld_code_reenter"
    FELD_REOPEN_QR = "feld_reopen_qr"
    FELD_CODE_FIRST = "feld_code_first"
    FELD_DEVICE_NOT_SIGNED_IN = "feld_device_not_signed_in"
    FELD_FORM_TOKEN_INVALID = "feld_form_token_invalid"  # noqa: S105 — an error code, not a secret
    # Who may do what
    FELD_EVENT_NOT_FOUND = "feld_event_not_found"
    FELD_PERSON_NOT_FOUND = "feld_person_not_found"
    FELD_PERSON_NO_ACCESS = "feld_person_no_access"
    FELD_NOT_MAGAZIN = "feld_not_magazin"
    FELD_INCIDENT_NOT_ASSIGNED = "feld_incident_not_assigned"
    FELD_REPORT_NOT_YOURS = "feld_report_not_yours"
    FELD_REPORT_TAKEN_OVER = "feld_report_taken_over"
    FELD_TOKEN_OTHER_PERSON = "feld_token_other_person"  # noqa: S105 — an error code, not a secret
    # «Zusammenführen» from /feld (R2)
    FELD_MERGE_TARGET_CLOSED = "feld_merge_target_closed"
    FELD_MERGE_REFUSED = "feld_merge_refused"
    INCIDENT_NOT_FOUND = "incident_not_found"
    # The Reko form (`/reko`, opened from a board link or from /feld)
    REKO_LINK_INVALID = "reko_link_invalid"
    REKO_REPORT_NOT_FOUND = "reko_report_not_found"
    REKO_REPORT_NO_ACCESS = "reko_report_no_access"
    # Photos
    PHOTO_NOT_FOUND = "photo_not_found"
    PHOTO_DEMO_TOO_LARGE = "photo_demo_too_large"
    PHOTO_DEMO_LIMIT = "photo_demo_limit"
    PHOTO_INVALID_EXTENSION = "photo_invalid_extension"
    PHOTO_INVALID_TYPE = "photo_invalid_type"
    PHOTO_INVALID = "photo_invalid"
    PHOTO_TOO_LARGE = "photo_too_large"
    PHOTO_TOO_MANY_PIXELS = "photo_too_many_pixels"
    PHOTO_LIMIT = "photo_limit"


class CodedHTTPException(HTTPException):
    """An ``HTTPException`` whose body also carries ``code`` (see the module docstring)."""

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        detail: str,
        headers: dict[str, str] | None = None,
        params: dict[str, str | int | float] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.params = params


async def coded_http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """FastAPI's own ``{"detail": …}`` body, plus ``code`` (and ``params`` when it has any)."""
    if not isinstance(exc, CodedHTTPException):  # registered for that class only
        raise exc
    content: dict[str, object] = {"detail": exc.detail, "code": exc.code.value}
    if exc.params:
        content["params"] = exc.params
    return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)
