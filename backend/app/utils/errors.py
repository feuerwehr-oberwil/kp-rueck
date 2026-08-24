"""Error handling utilities.

Provides standardized error messages that don't leak internal details.
"""


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
