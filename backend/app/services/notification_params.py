"""What a notification says, as facts AND as the German sentence — built in one place.

Every notification row carries both (``models.Notification``):

- ``params`` — the facts (place, person, minutes, …), keyed per ``type``. The bell
  renders these in the operator's language (``frontend/lib/notification-format.ts``,
  copy in ``messages/<locale>.json`` under ``notifications.messages``).
- ``message`` — the German sentence. Still written, because it is what an older client
  shows, what the audit trail and the dedup/auto-resolve matching in
  ``notification_service`` read, and the only text a legacy row (``params`` NULL) has.

Each builder below returns ``(message, params)`` from the same arguments, so the two
cannot drift apart. The ``params`` shapes are a contract with the frontend: adding a key
is fine, renaming or removing one needs a case in ``notification-format.ts`` (and its
test) first. Keys are snake_case; values are JSON scalars, lists of them, or a list of
small dicts (fatigue). Places are always the SHORT address the board card wears
(``location_display``), already resolved by the caller.

Free text stays as the person typed or the scenario generator wrote it (a /feld
message, a pickup note, a training inject's sentence) — it is content, not UI copy.
"""

from typing import Any

Params = dict[str, Any]
Built = tuple[str, Params]


def duration_de(minutes: int) -> str:
    """«56m», «1h 5m» — the notation these sentences have always used."""
    hours, rest = divmod(max(0, minutes), 60)
    return f"{hours}h {rest}m" if hours > 0 else f"{rest}m"


# --- Zeit -------------------------------------------------------------------------------


def time_in_status(place: str, minutes: int, status: str, status_label: str) -> Built:
    """``time_overdue``: a card has sat in one column past its threshold."""
    return (
        f"{place}: {duration_de(minutes)} im Status «{status_label}»",
        {"variant": "status", "place": place, "minutes": minutes, "status": status},
    )


def time_not_archived(place: str, minutes: int) -> Built:
    """``time_overdue``: finished, but nobody closed it."""
    return (
        f"{place}: seit {duration_de(minutes)} abgeschlossen, nicht archiviert",
        {"variant": "not_archived", "place": place, "minutes": minutes},
    )


# --- Ressourcen -------------------------------------------------------------------------


def no_personnel() -> Built:
    return ("Kein Personal mehr verfügbar - alle eingecheckten Personen sind zugewiesen", {})


def materials(location: str, available: int) -> Built:
    """``no_materials``: ``available`` 0 = none left (critical), else «only N left»."""
    if available == 0:
        return (f"Keine Einheiten von '{location}' mehr verfügbar", {"location": location, "available": 0})
    return (
        f"Nur noch {available} Einheiten von '{location}' verfügbar",
        {"location": location, "available": available},
    )


#: How many names the grouped time-on-duty notification spells out before «und N weitere».
FATIGUE_NAMES_SHOWN = 5


def fatigue(over: list[tuple[str, int]], fatigue_hours: int) -> Built:
    """``personnel_fatigue``: everybody past the time-on-duty threshold, in ONE row.

    ``over`` is ``(name, minutes on duty)``, longest first. Whole hours only: the row is
    rewritten in place whenever this changes, and a minute in it would rewrite the row
    every poll for a number the board already shows live on the person chip.

    «Seit über 4 h im Einsatz: Müller Hans (6 h)» /
    «3 Personen seit über 4 h im Einsatz: Müller Hans (6 h), Meier Anna (5 h), Huber Max (4 h)»
    """
    shown = over[:FATIGUE_NAMES_SHOWN]
    more = max(0, len(over) - FATIGUE_NAMES_SHOWN)
    names = ", ".join(f"{name} ({minutes // 60} h)" for name, minutes in shown)
    if more:
        names += f" und {more} weitere"
    head = (
        f"Seit über {fatigue_hours} h im Einsatz"
        if len(over) == 1
        else f"{len(over)} Personen seit über {fatigue_hours} h im Einsatz"
    )
    return (
        f"{head}: {names}",
        {
            "hours": fatigue_hours,
            "count": len(over),
            "people": [{"name": name, "hours": minutes // 60} for name, minutes in shown],
            "more": more,
        },
    )


# --- Datenqualität / Speicher -----------------------------------------------------------


def missing_location(title: str) -> Built:
    return (f"Einsatz '{title}' hat keine geokodierte Position", {"title": title})


#: Message prefixes for the two storage limits. They double as the deduplication key
#: (see `notification_service._deduplicate_and_save`), so they must stay stable and distinct.
STORAGE_LABEL_DATABASE = "Datenbank"
STORAGE_LABEL_PHOTOS = "Foto-Speicher"


def storage_limit(store: str, used_bytes: int, limit_gb: float) -> Built:
    """``event_size_limit``: ``store`` is ``database`` or ``photos``."""
    from .storage_usage import BYTES_PER_GB, format_gb

    label = STORAGE_LABEL_DATABASE if store == "database" else STORAGE_LABEL_PHOTOS
    return (
        f"{label}: {format_gb(used_bytes)} GB belegt – Limit von {limit_gb} GB überschritten",
        {"store": store, "used_gb": round(used_bytes / BYTES_PER_GB, 1), "limit_gb": limit_gb},
    )


# --- Fahrzeuge --------------------------------------------------------------------------


def vehicle_on_site(vehicle: str, place: str) -> Built:
    """``vehicle_arrived`` (geofence): an assigned vehicle reached its Schadenplatz."""
    return (f"{vehicle} vor Ort: {place}", {"variant": "on_site", "vehicle": vehicle, "place": place})


def vehicle_returned(vehicle: str) -> Built:
    """``vehicle_arrived`` (GPS automation): back at the Magazin."""
    return (f"{vehicle} zurück im Magazin", {"variant": "returned", "vehicle": vehicle})


# --- Reko -------------------------------------------------------------------------------

#: Reko danger flags (``RekoReport.dangers_json`` keys) as the German sentence names them.
#: The client has its own labels for the same keys (``reko.reportSection.dangerBadges``).
DANGER_LABELS_DE = {
    "fire": "Feuer",
    "explosion": "Explosion",
    "collapse": "Einsturz",
    "chemical": "Gefahrstoffe",
    "electrical": "Elektrisch",
    "fire_danger": "Brandgefahr",
}


def reko_arrived(place: str, by: str | None) -> Built:
    message = f"Reko vor Ort: {by} bei {place}" if by else f"Reko vor Ort: {place}"
    return (message, {"place": place, "by": by})


def reko_submitted(
    place: str,
    by: str | None,
    relevant: bool,
    personnel_count: int | None,
    duration_hours: float | None,
    dangers: list[str],
) -> Built:
    """«Reko abgeschlossen: Hauptstrasse 41 von Lisa Hoffmann – Einsatz relevant (3 Pers., ~2h)»"""
    parts = [f"Reko abgeschlossen: {place}"]
    if by:
        parts.append(f"von {by}")
    parts.append(f"– {'Einsatz relevant' if relevant else 'Kein Einsatz nötig'}")
    details = []
    if personnel_count:
        details.append(f"{personnel_count} Pers.")
    if duration_hours:
        details.append(f"~{duration_hours}h")
    if dangers:
        details.append(f"Gefahren: {', '.join(DANGER_LABELS_DE.get(d, d) for d in dangers)}")
    message = " ".join(parts)
    if details:
        message += f" ({', '.join(details)})"
    return (
        message,
        {
            "place": place,
            "by": by,
            "relevant": relevant,
            "personnel_count": personnel_count or None,
            "duration_hours": duration_hours or None,
            "dangers": list(dangers),
        },
    )


# --- /feld ------------------------------------------------------------------------------
#
# The actor is a pair: ``actor_kind`` (``field`` = a crew on /feld, ``kp`` = an operator
# recording a radio message, ``gps`` = the GPS automation) and ``actor_name`` (the
# person, for ``field`` only, and only when known).

#: The German tail per actor kind, for a field actor without a name and the other two.
_ACTOR_DE = {"field": "vom Feld", "kp": "im KP erfasst", "gps": "automatisch (GPS)"}


def actor_params(kind: str, name: str | None) -> Params:
    return {"actor_kind": kind, "actor_name": name if kind == "field" else None}


def actor_suffix(kind: str, name: str | None) -> str:
    """The « · von wem» tail every /feld notification ends with."""
    return f" · {name}" if kind == "field" and name else f" · {_ACTOR_DE[kind]}"


#: The column titles the German sentence names (the client uses its own column labels).
_MOVED_LABEL_DE = {"active": "Einsatz", "returning": "Beendet / Rückfahrt"}


def field_arrived(place: str, kind: str, name: str | None, moved_to: str | None) -> Built:
    message = f"Angekommen: {place}{actor_suffix(kind, name)}"
    if moved_to:
        message += f" – Karte in «{_MOVED_LABEL_DE[moved_to]}» verschoben"
    return (message, {"place": place, "moved_to": moved_to, **actor_params(kind, name)})


def field_complete(place: str, kind: str, name: str | None, moved_to: str | None) -> Built:
    message = f"Einsatz beendet gemeldet: {place}{actor_suffix(kind, name)}"
    if moved_to:
        message += f" – Karte in «{_MOVED_LABEL_DE[moved_to]}» verschoben"
    return (message, {"place": place, "moved_to": moved_to, **actor_params(kind, name)})


def field_pickup(place: str, kind: str, name: str | None, *, needed: bool, note: str | None) -> Built:
    if needed:
        detail = f" ({note})" if note else ""
        message = f"Abholung nötig: {place}{detail}{actor_suffix(kind, name)}"
    else:
        message = f"Abholung erledigt: {place}{actor_suffix(kind, name)}"
    return (
        message,
        {"place": place, "needed": needed, "note": (note or None) if needed else None, **actor_params(kind, name)},
    )


def field_message(place: str, kind: str, name: str | None, text: str) -> Built:
    """The crew's own words are the point; the rest is where and who."""
    who = name if kind == "field" else _ACTOR_DE[kind]
    message = f"Meldung vom Feld ({who}) – {place}: {text}" if who else f"Meldung vom Feld: {text}"
    return (message, {"place": place, "text": text, **actor_params(kind, name)})


def rapport_submitted(place: str, kind: str, name: str | None) -> Built:
    return (f"Rapport erfasst: {place}{actor_suffix(kind, name)}", {"place": place, **actor_params(kind, name)})


def field_report(place: str, by: str, *, direct: bool) -> Built:
    """``field_report``: a whole new Schadenplatz reported from the field."""
    if direct:
        message = f"Meldung vom Feld – Trupp fährt direkt hin: {place} ({by})"
    else:
        message = f"Meldung vom Feld: {place} ({by})"
    return (message, {"place": place, "by": by, "direct": direct})


def feld_code_rotated(event_name: str) -> Built:
    return (f"Feld-Code für {event_name} nach zu vielen Fehlversuchen neu erzeugt", {"event": event_name})


# --- Übung ------------------------------------------------------------------------------


def training_new(title: str, address: str | None) -> Built:
    return (f"Neuer Übungs-Einsatz: {title} ({address})", {"variant": "new", "title": title, "address": address})


def training_escalation(title: str, text: str) -> Built:
    return (f"Lage verschärft: {title} – {text}", {"variant": "escalation", "title": title, "text": text})


def training_reinforcement(title: str, text: str) -> Built:
    return (f"Feld fordert Verstärkung: {text} – {title}", {"variant": "reinforcement", "title": title, "text": text})


def training_vehicle_down(vehicle: str, title: str) -> Built:
    return (
        f"Fahrzeug {vehicle} ausgefallen: {title} – Ersatz disponieren",
        {"variant": "vehicle_down", "vehicle": vehicle, "title": title},
    )
