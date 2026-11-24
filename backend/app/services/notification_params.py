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

from datetime import datetime
from typing import Any

from .rapport_rows import LOCAL_TZ, STATUS_LABELS

Params = dict[str, Any]
Built = tuple[str, Params]


def duration_de(minutes: int) -> str:
    """«56'», «1h 5'», «1d 10h» — the board's magnet notation (frontend ``formatDuration``),
    so the German ``message`` reads like the card it is about."""
    total_hours, rest = divmod(max(0, minutes), 60)
    days, hours = divmod(total_hours, 24)
    if days > 0:
        return f"{days}d {hours}h"
    return f"{total_hours}h {rest}'" if total_hours > 0 else f"{rest}'"


def duration_hours_de(hours: float) -> str:
    """A decimal-hours estimate (the Reko's 2.5) in ``duration_de``'s notation: «2h 30'», never
    «2.5h». The one formatter for the Reko duration in the notification and the Lageblatt."""
    return duration_de(round(hours * 60))


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
    return ("Kein Personal mehr verfügbar - alle anwesenden Personen sind zugewiesen", {})


def materials(location: str, available: int) -> Built:
    """``no_materials``: ``available`` 0 = none left (critical), else «only N left»."""
    if available == 0:
        return (f"Keine Geräte von '{location}' mehr verfügbar", {"location": location, "available": 0})
    return (
        f"Nur noch {available} {'Gerät' if available == 1 else 'Geräte'} von '{location}' verfügbar",
        {"location": location, "available": available},
    )


#: How many names the grouped time-on-duty notification spells out before «und N weitere».
FATIGUE_NAMES_SHOWN = 5


def fatigue(over: list[tuple[str, int]], fatigue_hours: int) -> Built:
    """``personnel_fatigue``: everybody past the time-on-duty threshold, in ONE row.

    ``over`` is ``(name, minutes on duty)``, longest first. Whole hours only: the row is
    rewritten in place whenever this changes, and a minute in it would rewrite the row
    every poll for a number the board already shows live on the person chip.

    «Seit über 4h im Einsatz: Müller Hans (6h)» /
    «3 Personen seit über 4h im Einsatz: Müller Hans (6h), Meier Anna (5h), Huber Max (4h)»
    """
    shown = over[:FATIGUE_NAMES_SHOWN]
    more = max(0, len(over) - FATIGUE_NAMES_SHOWN)
    names = ", ".join(f"{name} ({minutes // 60}h)" for name, minutes in shown)
    if more:
        names += f" und {more} weitere"
    head = (
        f"Seit über {fatigue_hours}h im Einsatz"
        if len(over) == 1
        else f"{len(over)} Personen seit über {fatigue_hours}h im Einsatz"
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


def personnel_leaving(name: str, until: datetime) -> Built:
    """``personnel_leaving``: a checked-in person's planned «geht um» is 15' away (or past).

    The time, never «in 15'»: the row stands until they check out, and the bell must not
    rewrite it every minute. ``until`` goes out as ISO so the client says the clock in its
    own locale; the German sentence names it on the station's clock.
    «Geht um 22:00: Baumann Michael»
    """
    clock = until.astimezone(LOCAL_TZ).strftime("%H:%M")
    return (f"Geht um {clock}: {name}", {"name": name, "until": until.isoformat()})


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


def gps_arrival_todo(vehicle: str, place: str) -> Built:
    """``gps_arrival`` – a to-do («Zu erledigen», owner rule 24.11.2026: what the system starts is
    a bell row with its buttons, never a popup): GPS sees the vehicle at its Schadenplatz."""
    return (f"{vehicle} ist bei {place} – auf «Im Einsatz»?", {"vehicle": vehicle, "place": place})


def gps_release_todo(vehicle: str, place: str) -> Built:
    """``gps_release`` – a to-do: the vehicle is back at the Magazin, still on ``place``."""
    return (f"{vehicle} zurück im Magazin – von {place} freigeben?", {"vehicle": vehicle, "place": place})


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
    """«Reko abgeschlossen: Hauptstrasse 41 von Lisa Hoffmann – Einsatz relevant (3 Pers., 2h 30')»"""
    parts = [f"Reko abgeschlossen: {place}"]
    if by:
        parts.append(f"von {by}")
    parts.append(f"– {'Einsatz relevant' if relevant else 'Kein Einsatz nötig'}")
    details = []
    if personnel_count:
        details.append(f"{personnel_count} Pers.")
    if duration_hours:
        details.append(duration_hours_de(duration_hours))
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


def field_arrived(place: str, kind: str, name: str | None, moved_to: str | None) -> Built:
    message = f"Angekommen: {place}{actor_suffix(kind, name)}"
    if moved_to:
        message += f" – Karte in «{STATUS_LABELS[moved_to]}» verschoben"
    return (message, {"place": place, "moved_to": moved_to, **actor_params(kind, name)})


def field_complete(place: str, kind: str, name: str | None, moved_to: str | None) -> Built:
    message = f"Einsatz beendet gemeldet: {place}{actor_suffix(kind, name)}"
    if moved_to:
        message += f" – Karte in «{STATUS_LABELS[moved_to]}» verschoben"
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


def field_message(
    place: str,
    kind: str,
    name: str | None,
    text: str,
    *,
    request_kind: str = "message",
    item: str | None = None,
    quantity: int | None = None,
    note: str | None = None,
) -> Built:
    """The crew's own words are the point; the rest is where and who.

    A structured request (R13: ``request_kind`` ``material`` / ``personnel`` / ``pickup``)
    also carries its facts – ``item``, ``quantity`` and the crew's ``note`` – so the bell
    words «Material: Tauchpumpe Gr. ×2» in the operator's language; ``text`` is then the
    German one-line label (``models.field_request_label``), what an older client shows.
    """
    who = name if kind == "field" else _ACTOR_DE[kind]
    message = f"Meldung vom Feld ({who}) – {place}: {text}" if who else f"Meldung vom Feld: {text}"
    structured = request_kind != "message"
    return (
        message,
        {
            "place": place,
            "text": text,
            "request_kind": request_kind,
            "item": (item or None) if structured else None,
            "quantity": quantity if structured else None,
            "note": (note or None) if structured else None,
            **actor_params(kind, name),
        },
    )


def rapport_submitted(place: str, kind: str, name: str | None) -> Built:
    return (f"Rapport erfasst: {place}{actor_suffix(kind, name)}", {"place": place, **actor_params(kind, name)})


def field_report(place: str, by: str, *, direct: bool) -> Built:
    """``field_report``: a whole new Schadenplatz reported from the field."""
    if direct:
        message = f"Meldung vom Feld – Trupp fährt direkt hin: {place} ({by})"
    else:
        message = f"Meldung vom Feld: {place} ({by})"
    return (message, {"place": place, "by": by, "direct": direct})


def field_merged(place: str, by: str) -> Built:
    """``field_report`` for a /feld report folded into an open card (R2 «Zusammenführen»).

    Same type as a new Schadenplatz – it is news from the field about a card – but
    ``merged`` says it is a Nachtrag on an existing one, not a new card. ``place`` is
    the card it went into.
    """
    return (f"Nachtrag vom Feld: {place} ({by})", {"place": place, "by": by, "merged": True})


# --- Übung ------------------------------------------------------------------------------


def training_new(title: str, address: str | None) -> Built:
    return (f"Neuer Übungs-Einsatz: {title} ({address})", {"variant": "new", "title": title, "address": address})


def training_escalation(title: str, text: str) -> Built:
    return (f"Lage verschärft: {title} – {text}", {"variant": "escalation", "title": title, "text": text})


def training_vehicle_down(vehicle: str, title: str) -> Built:
    return (
        f"Fahrzeug {vehicle} ausgefallen: {title} – Ersatz disponieren",
        {"variant": "vehicle_down", "vehicle": vehicle, "title": title},
    )
