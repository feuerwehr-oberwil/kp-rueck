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

Two ways to raise one. A route raises ``CodedHTTPException``. CRUD and services raise
``DomainError`` – a refusal of the domain (a closed Einsatz, a released assignment), not an
HTTP concern – and ``coded_error_handler`` (registered in ``main.py``) answers both with the
same body. Do not catch a ``DomainError`` in a route just to re-raise it; catch it only
where the route says something else. A plain ``ValueError`` is a bug and answers 500.
"""

from collections.abc import Mapping
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
    # «Ich bin da bis …» that ends before it starts (/feld and the board's Appell)
    FELD_PLAN_INVALID = "feld_plan_invalid"
    # «Zusammenführen» from /feld (R2)
    FELD_MERGE_TARGET_CLOSED = "feld_merge_target_closed"
    FELD_MERGE_REFUSED = "feld_merge_refused"
    INCIDENT_NOT_FOUND = "incident_not_found"
    # A status move from a stale board: somebody else moved the card first (409, the board
    # opens «Gerade geändert»; params: status, seconds_ago, changed_by?, released?).
    INCIDENT_STATUS_CHANGED = "incident_status_changed"
    # A text save from a stale board: somebody else saved that field first (409; the field
    # keeps the draft and asks; params: field, current, changed_at?, changed_by?).
    TEXT_CONFLICT = "text_conflict"
    # The board reads these instead of matching the German ``detail`` (COPY-14): an assign
    # that lost a race to another board (409; the client says it in its own sentence) and an
    # unmerge of a report that is not merged (any more) – a second click, answered quietly.
    ASSIGNMENT_RACE = "assignment_race"
    # The board assigned a resource that is Jetzt on another Einsatz or Auftrag (owner pick 2B,
    # 24.11.2026: never on two – move it or plan it «Danach»). params: holders (comma-separated).
    RESOURCE_BUSY = "resource_busy"
    # «Danach vormerken» that cannot exist (closed target, consumable, already there).
    PLAN_REFUSED = "plan_refused"
    INCIDENT_ALREADY_RESTORED = "incident_already_restored"
    INCIDENT_RESTORE_MERGED = "incident_restore_merged"
    INCIDENT_RESTORE_CONFLICT = "incident_restore_conflict"
    INCIDENT_RESTORE_RESOURCE_CONFLICT = "incident_restore_resource_conflict"
    INCIDENT_NOT_MERGED = "incident_not_merged"
    # «‹Name› als Gast einchecken» at the door: a name the link cannot settle alone (several
    # people of that name, somebody marked unavailable, the Ereignis's guest limit) – 409.
    CHECKIN_GUEST_ASK_KP = "checkin_guest_ask_kp"
    # The Reko form (`/reko`, opened from a board link or from /feld)
    REKO_LINK_INVALID = "reko_link_invalid"
    REKO_REPORT_NOT_FOUND = "reko_report_not_found"
    REKO_REPORT_NO_ACCESS = "reko_report_no_access"
    # A PATCH of the report a merged-away card kept (409; the tab reloads)
    REKO_REPORT_MERGED = "reko_report_merged"
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
    # A write on the standby box while the hosted board leads (middleware/standby_readonly.py).
    STANDBY_READ_ONLY = "standby_read_only"
    # `assignments.ensure_assignable`: why a resource may not go onto an Einsatz or Auftrag
    # (409; params: name where the sentence names the resource).
    RESOURCE_ARCHIVED = "resource_archived"
    RESOURCE_OUT_OF_SERVICE = "resource_out_of_service"
    EVENT_ARCHIVED = "event_archived"
    PERSON_GUEST_ELSEWHERE = "person_guest_elsewhere"
    INCIDENT_CLOSED = "incident_closed"
    AUFTRAG_CLOSED = "auftrag_closed"
    # An edit of an assignment whose resource was released meanwhile (409).
    ASSIGNMENT_RELEASED = "assignment_released"
    # 422s: the Einsatzleiter flag on a vehicle or material, «bleibt vor Ort» on a non-vehicle.
    LEADER_NOT_PERSONNEL = "leader_not_personnel"
    DRIVER_STAY_NOT_VEHICLE = "driver_stay_not_vehicle"
    # An id that is no resource (404), or a resource of another type than declared (422).
    RESOURCE_NOT_FOUND = "resource_not_found"
    RESOURCE_TYPE_MISMATCH = "resource_type_mismatch"
    # «Übertragen» and its undo (409; params: names for the conflict).
    TRANSFER_CHANGED = "transfer_changed"
    TRANSFER_SOURCE_CLOSED = "transfer_source_closed"
    TRANSFER_ALREADY_STOP = "transfer_already_stop"
    TRANSFER_AUFTRAG_CLOSED = "transfer_auftrag_closed"
    TRANSFER_NOTHING = "transfer_nothing"
    TRANSFER_CONFLICT = "transfer_conflict"
    # An Einsatz of another Ereignis as a stop or a transfer target (409).
    INCIDENT_OTHER_EVENT = "incident_other_event"
    # Sonderfunktionen: a driver needs a vehicle, a key the station does not have (422); a
    # vehicle has one driver (409; params: function for the unknown key).
    DRIVER_NEEDS_VEHICLE = "driver_needs_vehicle"
    FUNCTION_UNKNOWN = "function_unknown"
    VEHICLE_HAS_DRIVER = "vehicle_has_driver"
    # Check-in, check-out and the attendance plan (409).
    PERSON_UNAVAILABLE = "person_unavailable"
    PERSON_STILL_ASSIGNED = "person_still_assigned"
    # An assign onto an Einsatz that was deleted or merged meanwhile (409).
    INCIDENT_NOT_ON_BOARD = "incident_not_on_board"
    # Delete before archive (409).
    EVENT_NOT_ARCHIVED = "event_not_archived"


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


class DomainError(Exception):
    """A refusal CRUD or a service raises: a code, the German sentence, a status (409 default).

    ``raise DomainError(ErrorCode.INCIDENT_CLOSED, "Der Einsatz ist abgeschlossen …")``.
    ``coded_error_handler`` answers it like a ``CodedHTTPException``. Subclass it only where
    a caller must tell one refusal from another (``except ResourceNotAssignableError``).
    ``str()`` is the German sentence.
    """

    def __init__(
        self,
        code: ErrorCode,
        detail: str,
        *,
        status_code: int = 409,
        params: Mapping[str, str | int | float] | None = None,
    ) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status_code = status_code
        self.params = params


async def coded_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """FastAPI's own ``{"detail": …}`` body, plus ``code`` (and ``params`` when it has any)."""
    if not isinstance(exc, CodedHTTPException | DomainError):  # registered for these two only
        raise exc
    content: dict[str, object] = {"detail": exc.detail, "code": exc.code.value}
    if exc.params:
        content["params"] = exc.params
    headers = exc.headers if isinstance(exc, CodedHTTPException) else None
    return JSONResponse(status_code=exc.status_code, content=content, headers=headers)
