"""Error handling utilities.

Provides standardized error responses that don't leak internal details.
"""

import logging
from typing import Any

from fastapi import HTTPException


def safe_http_exception(
    status_code: int,
    public_message: str,
    error: Exception | None = None,
    logger: logging.Logger | None = None,
    context: dict[str, Any] | None = None,
) -> HTTPException:
    """
    Create an HTTPException with a safe public message.

    Logs the actual error details server-side for debugging while
    returning a generic message to the client.

    Args:
        status_code: HTTP status code
        public_message: User-friendly message (will be shown to client)
        error: Optional exception that occurred (logged, not exposed)
        logger: Optional logger for recording the error
        context: Optional context dict for logging

    Returns:
        HTTPException with the public message
    """
    if error and logger:
        log_context = f" Context: {context}" if context else ""
        logger.error(f"{public_message}: {error!r}{log_context}")

    return HTTPException(status_code=status_code, detail=public_message)


# Standard error messages in German for user-facing errors
class ErrorMessages:
    """Standardized error messages for common scenarios."""

    # 400 Bad Request
    INVALID_REQUEST = "Ungültige Anfrage"
    INVALID_DATA = "Ungültige Daten"
    VALIDATION_FAILED = "Validierung fehlgeschlagen"
    INVALID_FILE = "Ungültige Datei"

    # 404 Not Found
    NOT_FOUND = "Ressource nicht gefunden"
    INCIDENT_NOT_FOUND = "Einsatz nicht gefunden"
    REPORT_NOT_FOUND = "Bericht nicht gefunden"
    EVENT_NOT_FOUND = "Event nicht gefunden"
    PERSONNEL_NOT_FOUND = "Personal nicht gefunden"
    USER_NOT_FOUND = "Benutzer nicht gefunden"

    # 409 Conflict
    CONFLICT = "Konflikt bei der Verarbeitung"
    RESOURCE_ALREADY_ASSIGNED = "Ressource bereits zugewiesen"
    DUPLICATE_ENTRY = "Eintrag existiert bereits"

    # 500 Internal Server Error
    INTERNAL_ERROR = "Interner Serverfehler"
    EXPORT_FAILED = "Export fehlgeschlagen"
    PROCESSING_FAILED = "Verarbeitung fehlgeschlagen"
