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
    CATEGORY_INVALID = "Kategorie muss 'normal' oder 'critical' sein"
    EXCEL_REQUIRED = "Datei muss im Excel-Format (.xlsx) sein"
    TRAINING_EVENTS_ONLY = "Nur für Übungen verfügbar"
    DIVERA_NOT_CONFIGURED = "Divera-Zugangsschlüssel nicht konfiguriert (DIVERA_ACCESS_KEY)"

    # 401/403 – a token link (viewer, intake, check-in) that no longer opens anything
    LINK_INVALID = "Link ungültig oder abgelaufen"

    # 404 Not Found
    NOT_FOUND = "Ressource nicht gefunden"
    INCIDENT_NOT_FOUND = "Einsatz nicht gefunden"
    REPORT_NOT_FOUND = "Bericht nicht gefunden"
    EVENT_NOT_FOUND = "Ereignis nicht gefunden"
    PERSONNEL_NOT_FOUND = "Personal nicht gefunden"
    USER_NOT_FOUND = "Benutzer nicht gefunden"
    AUFTRAG_NOT_FOUND = "Auftrag nicht gefunden"
    VEHICLE_NOT_FOUND = "Fahrzeug nicht gefunden"
    MATERIAL_NOT_FOUND = "Material nicht gefunden"
    MATERIAL_GROUP_NOT_FOUND = "Materialgruppe nicht gefunden"
    ASSIGNMENT_NOT_FOUND = "Zuweisung nicht gefunden"
    PRINT_JOB_NOT_FOUND = "Druckauftrag nicht gefunden"
    PHOTO_NOT_FOUND = "Foto nicht gefunden"
    INCIDENT_NOT_IN_EVENT = "Einsatz gehört nicht zu diesem Ereignis"

    # 409 Conflict
    CONFLICT = "Konflikt bei der Verarbeitung"
    RESOURCE_ALREADY_ASSIGNED = "Ressource bereits zugewiesen"
    DUPLICATE_ENTRY = "Eintrag existiert bereits"
    ALARM_EXISTS = "Alarm existiert bereits"
    SYNC_IN_PROGRESS = "Synchronisation läuft bereits"

    # 500 Internal Server Error
    INTERNAL_ERROR = "Interner Serverfehler"
    EXPORT_FAILED = "Export fehlgeschlagen"
    PROCESSING_FAILED = "Verarbeitung fehlgeschlagen"
