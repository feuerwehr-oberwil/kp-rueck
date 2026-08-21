"""The field writes: Angekommen, Einsatz beendet, Abholung, Meldung.

Also the primitives the Rapport builds on — ``FieldActor`` (who is writing:
a crew member through `/feld`, or a logged-in user), the report row
get-or-create, and the broadcast that puts a field write onto the board.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import (
    Incident,
    Notification,
    SchadenplatzReport,
    User,
)
from ...services.audit import log_action
from ...services.incident_display import get_home_city, location_display
from ...services.notification_service import create_field_notification
from ...websocket_manager import broadcast_incident_update

# ============================================
# Field reports — the writes (phase 1)
# ============================================
#
# Everything below is called from BOTH doors: token-gated on `/api/feld/...` for
# the crew, editor-gated on `/api/incidents/{id}/field-report` for the KP taking
# the same thing over the radio (decision 28). Two thin routers over one module —
# a second implementation is how the KP path silently loses a field.
#
# None of it touches ``incident_assignments``. That boundary (decisions 17/18) is
# what keeps this surface out of the board's conflict model, and it is asserted
# in the tests rather than left to review.


def is_automation_user(user_id: uuid.UUID | None) -> bool:
    """Was this write made by the GPS automation rather than by a person?

    The third provenance (§18.24). ``arrived_by_user_id`` pointing at the
    ``gps-automation`` system user is not "im KP erfasst" — no operator typed
    it — and rendering it as such would attribute a machine's inference to
    whoever happened to be sitting at the board.

    The constant is imported **inside** the function on purpose:
    ``services/gps_automation`` imports ``crud.incidents``, so a module-level
    import here would close a cycle through the ``crud`` package. One lazy
    import beats a duplicated UUID literal that can drift.
    """
    if user_id is None:
        return False
    from ...services.gps_automation import GPS_SYSTEM_USER_ID

    return user_id == GPS_SYSTEM_USER_ID


@dataclass(frozen=True)
class FieldActor:
    """Who is filing — and **exactly one side of this is ever populated**.

    Provenance is never faked (decision 28). A `/feld` write carries the
    ``Personnel`` row and stamps the ``*_by`` personnel FKs; a KP write carries
    the ``User``, leaves those columns NULL, and puts the user in the audit-log
    entry instead. A ``User`` is never guessed to be a ``Personnel`` — they are
    different people often enough that a wrong attribution on a billing document
    is worse than no attribution.

    **A third kind exists since §18.24: the GPS automation.** It is a ``User``
    actor like the KP one — the ``gps-automation`` row, which is already the
    actor of the status change it makes — but it must never be *worded* as a KP
    entry, because no operator did anything. Readers tell them apart by the user
    id (``is_automation_user``), so nothing has to be stored twice; this flag
    exists only so the notification wording is right at write time, where the
    row is not loaded yet.
    """

    personnel_id: uuid.UUID | None = None
    personnel_name: str | None = None
    user: User | None = None
    automation: bool = False

    @property
    def is_field(self) -> bool:
        """True for a crew filing on `/feld`, False for a KP radio entry."""
        return self.personnel_id is not None

    @property
    def suffix(self) -> str:
        """The " · von wem" tail of every notification this module writes."""
        if self.is_field:
            return f" · {self.personnel_name}" if self.personnel_name else " · vom Feld"
        if self.automation:
            return " · automatisch (GPS)"
        return " · im KP erfasst"


async def _location(db: AsyncSession, incident: Incident) -> str:
    """How a Schadenplatz is named in a notification: the SHORT address first.

    Same label the board card wears — street + number, home town stripped
    (`location_display`) — so a notification never says «Mühlemattstrasse 8,
    4104 Oberwil» about a card that reads «Mühlemattstrasse 8» (§19.2).
    """
    home_city = await get_home_city(db)
    return location_display(incident.location_address, home_city) or incident.title or "Unbekannt"


async def _get_or_create_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    actor: FieldActor,
) -> SchadenplatzReport:
    """The one Schadenplatz-Rapport row for this incident, created if absent.

    ``UNIQUE(incident_id)`` (decision 3): whoever files first creates it, anyone
    else assigned amends the same row. Created with ``is_draft=True`` — a row
    appears the moment someone taps "Angekommen", long before any form exists,
    so its default state must be "not yet filed".
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident_id))
    report = result.scalar_one_or_none()
    if report is not None:
        return report

    report = SchadenplatzReport(
        incident_id=incident_id,
        is_draft=True,
        created_by_personnel_id=actor.personnel_id,
        created_by_user_id=actor.user.id if actor.user and not actor.is_field else None,
    )
    db.add(report)
    await db.flush()
    return report


def _stamp_updated_by(report: SchadenplatzReport, actor: FieldActor) -> None:
    """Record who last touched the report — one side only, never both."""
    if actor.is_field:
        report.updated_by_personnel_id = actor.personnel_id
        report.updated_by_user_id = None
    else:
        report.updated_by_personnel_id = None
        report.updated_by_user_id = actor.user.id if actor.user else None


#: The board's column order — the only ordering of statuses that exists. Used to
#: make the auto-move strictly forward: a report about a card that is already at
#: (or past) the target column must not drag it backwards.
_STATUS_FLOW = ("incoming", "reko", "reko_done", "enroute", "active", "returning", "complete")

#: The column titles as the board wears them, for the notification sentence.
_STATUS_LABEL = {"active": "Einsatz", "returning": "Beendet / Rückfahrt"}


async def _auto_move(
    db: AsyncSession,
    incident: Incident,
    *,
    target: str,
    actor: FieldActor,
    request: Request | None,
) -> bool:
    """Field said it, the board follows (sweep 27 §P3.3).

    «Angekommen» moves the card to EINSATZ, «Einsatz beendet» to BEENDET /
    RÜCKFAHRT — exactly the two moves the FieldStatusNudge used to *ask* about,
    applied instead of asked, because the answer was always yes. Only for a
    genuine `/feld` tap (``actor.is_field``): a KP radio entry keeps the nudge
    as its manual path (the operator may be recording history, not news), and
    the GPS automation runs its own advance.

    Strictly forward, never into or out of `complete`: closing a Schadenplatz
    stays the operator's decision, unchanged.

    Goes through ``update_incident_status`` — the same path a drag takes — so
    the transition row, the audit entry (user None, ``source: feld``) and the
    auto-print on entering EINSATZ all behave exactly as if the operator had
    moved the card. Imported lazily: ``crud.incidents`` imports this package.
    """
    try:
        if _STATUS_FLOW.index(incident.status) >= _STATUS_FLOW.index(target):
            return False
    except ValueError:
        # An unknown status must never be "moved forward" from.
        return False

    from ..incidents import update_incident_status

    who = actor.personnel_name or "Feld"
    verb = "angekommen" if target == "active" else "beendet"
    updated = await update_incident_status(
        db,
        incident.id,
        target,
        current_user=None,
        request=request,
        notes=f"Automatisch – Feld meldet {verb} ({who})",
    )
    if updated is None:
        return False
    # The board is watching this card: say the status moved without waiting for
    # the poll. Same partial shape the GPS advance sends.
    await broadcast_incident_update({"id": str(incident.id), "status": target}, "update")
    return True


async def _broadcast(incident: Incident) -> None:
    """Push the field state to the board without waiting for the 5 s poll.

    Deliberately ``broadcast_incident_update`` only: `/feld` never writes an
    assignment, so ``broadcast_assignment_update`` has no business here.

    **This payload is a NOTIFICATION, not the incident** — and it is the only
    producer of `incident_update` that is. Everywhere else (``api/intake.py``,
    ``api/reko.py``, ``api/divera.py``, the incident routes) sends a full
    ``IncidentResponse.model_dump()``. Do not build anything on the three fields
    below: the client's ``handleRemoteUpdate`` takes **no argument at all**
    (``lib/contexts/operations-context.tsx`` → ``decideRemoteUpdateAction``), it
    refetches the board, and the payload is discarded by every listener.

    It stays partial on purpose rather than being widened to match. A full
    ``IncidentResponse`` from here would mean assembling the incident's crew,
    vehicles, materials and Reko inside a CRUD module whose whole job is the
    field surface — a second, divergent serialisation of the board's central
    object, kept in step by nobody, for a payload that is thrown away on
    arrival. If a listener ever *does* need to read this event's body, widen it
    then, by reusing the incident serialiser rather than growing this dict.
    """
    await broadcast_incident_update(
        {
            "id": str(incident.id),
            "field_complete_reported_at": (
                incident.field_complete_reported_at.isoformat() if incident.field_complete_reported_at else None
            ),
            "pickup_needed": incident.pickup_needed,
        },
        "update",
    )


async def record_arrival(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    at: datetime | None,
    only_if_unset: bool = False,
    request: Request | None = None,
) -> bool:
    """ "Angekommen" — set or clear the arrival on the Schadenplatz-Rapport row.

    ``only_if_unset`` is what the field tap passes: a second tap does nothing,
    because a crew re-opening the page and hitting the big button again must not
    move a timestamp the KP has already acted on. The KP path leaves it False so
    an operator can correct or clear the time (``at=None``).

    A genuine field tap also **moves the card to EINSATZ** (sweep 27 §P3.3, see
    ``_auto_move``) — the nudge that used to ask is answered before it is asked.
    KP and automation writers move nothing here.

    Returns whether anything changed — the caller only notifies when it did.

    The arrival carries its **own** ``arrived_by_*`` pair rather than borrowing
    the row's ``created_by_*``. That shortcut was exact only while an arrival was
    the only thing that could create the row; since the KP can create a rapport
    first (decision 28), a crew arriving afterwards would otherwise have its
    arrival rendered "im KP erfasst". Exactly one side is written, and clearing
    the arrival clears both — "nobody has reported it" is not a KP report.
    """
    report = await _get_or_create_report(db, incident.id, actor)
    if only_if_unset and report.arrived_at is not None:
        return False
    if report.arrived_at == at:
        return False

    report.arrived_at = at
    _stamp_updated_by(report, actor)
    if at is not None:
        report.arrived_by_personnel_id = actor.personnel_id
        report.arrived_by_user_id = actor.user.id if actor.user and not actor.is_field else None
    else:
        report.arrived_by_personnel_id = None
        report.arrived_by_user_id = None

    await log_action(
        db=db,
        action_type="field_arrived" if at is not None else "field_arrived_cleared",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={"arrived_at": at.isoformat() if at else None, "source": "feld" if actor.is_field else "kp"},
        request=request,
    )
    await db.commit()
    await db.refresh(report)

    moved = False
    if at is not None and actor.is_field:
        moved = await _auto_move(db, incident, target="active", actor=actor, request=request)

    if at is not None and incident.event_id:
        message = f"Angekommen: {await _location(db, incident)}{actor.suffix}"
        if moved:
            # The toast is the announcement of the move (§P3.3) — the card has
            # already gone where the sentence says.
            message += f" – Karte in «{_STATUS_LABEL['active']}» verschoben"
        await create_field_notification(
            db,
            notification_type="field_arrived",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=message,
        )
    await _broadcast(incident)
    return True


async def record_field_complete(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    at: datetime | None,
    only_if_unset: bool = False,
    request: Request | None = None,
) -> bool:
    """ "Einsatz beendet" — the field reports it, the KP still closes.

    A genuine field tap moves the card to BEENDET / RÜCKFAHRT (sweep 27 §P3.3,
    ``_auto_move``) — that column IS the state the crew just described, and the
    nudge that used to ask this always got a yes. What stays the operator's
    alone is `complete`: closing a Schadenplatz runs the release cascade and the
    material gate, and no field report does that. KP writes move nothing — an
    operator recording a radio message keeps the nudge as the manual path.

    ``field_complete_reported_by`` stays NULL for a KP write (decision 28); the
    audit-log entry carries the user instead.
    """
    if only_if_unset and incident.field_complete_reported_at is not None:
        return False
    if incident.field_complete_reported_at == at and (
        at is None or incident.field_complete_reported_by == actor.personnel_id
    ):
        return False

    incident.field_complete_reported_at = at
    incident.field_complete_reported_by = actor.personnel_id if at is not None else None

    await log_action(
        db=db,
        action_type="field_complete" if at is not None else "field_complete_cleared",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "field_complete_reported_at": at.isoformat() if at else None,
            "source": "feld" if actor.is_field else "kp",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(incident)

    moved = False
    if at is not None and actor.is_field:
        moved = await _auto_move(db, incident, target="returning", actor=actor, request=request)

    if at is not None and incident.event_id:
        message = f"Einsatz beendet gemeldet: {await _location(db, incident)}{actor.suffix}"
        if moved:
            message += f" – Karte in «{_STATUS_LABEL['returning']}» verschoben"
        await create_field_notification(
            db,
            notification_type="field_complete",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=message,
        )
    await _broadcast(incident)
    return True


async def record_pickup(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    needed: bool,
    note: str | None = None,
    at: datetime | None = None,
    request: Request | None = None,
) -> bool:
    """ "Abholung nötig" / "abgeholt" (decision 24).

    Not a status: a Schadenplatz can be finished and still have three people
    standing in the rain. Deliberately **not** cleared by completing the
    incident — ``crud/incidents.auto_release_incident_resources`` releases the
    crew on `complete` while they are physically still at the address, which is
    exactly the moment this flag has to survive.

    Clearing wipes the note and both provenance columns: "abgeholt" is the end of
    the fact, not a historical record, and the audit log keeps the history.
    """
    if incident.pickup_needed == needed and (not needed or (incident.pickup_note or None) == (note or None)):
        return False

    incident.pickup_needed = needed
    if needed:
        incident.pickup_note = note or None
        # Keep the ORIGINAL request time when only the note is edited — the
        # operationally decisive fact at 02:00 is how long they have been waiting.
        incident.pickup_requested_at = at or incident.pickup_requested_at or datetime.now(UTC)
        incident.pickup_requested_by = actor.personnel_id
    else:
        incident.pickup_note = None
        incident.pickup_requested_at = None
        incident.pickup_requested_by = None

    await log_action(
        db=db,
        action_type="field_pickup_requested" if needed else "field_pickup_cleared",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={"pickup_needed": needed, "pickup_note": note, "source": "feld" if actor.is_field else "kp"},
        request=request,
    )
    await db.commit()
    await db.refresh(incident)

    if incident.event_id:
        if needed:
            detail = f" ({note})" if note else ""
            await create_field_notification(
                db,
                notification_type="field_pickup",
                incident_id=incident.id,
                event_id=incident.event_id,
                message=f"Abholung nötig: {await _location(db, incident)}{detail}{actor.suffix}",
                # The only warning of the five. A waiting crew is the one field
                # event that is time-critical for the KP.
                severity="warning",
            )
        else:
            await create_field_notification(
                db,
                notification_type="field_pickup",
                incident_id=incident.id,
                event_id=incident.event_id,
                message=f"Abholung erledigt: {await _location(db, incident)}{actor.suffix}",
            )
    await _broadcast(incident)
    return True


async def record_field_message(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    message: str,
    request: Request | None = None,
) -> Notification | None:
    """Freitext-Meldung an den KP — a bell entry **and** a Journal entry.

    Both on purpose: the notification is how the KP sees it now, the audit-log
    entry is how it survives into the Einsatztagebuch after somebody dismisses
    the bell. Append-only and attributed, which is also the mitigation for two
    crews overwriting one another's Kurzbericht (§12).
    """
    text = message.strip()
    if not text:
        return None

    await log_action(
        db=db,
        action_type="field_message",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "message": text,
            "personnel_id": str(actor.personnel_id) if actor.personnel_id else None,
            "personnel_name": actor.personnel_name,
            "source": "feld" if actor.is_field else "kp",
        },
        request=request,
    )
    await db.commit()

    notification: Notification | None = None
    if incident.event_id:
        who = actor.personnel_name if actor.is_field else "im KP erfasst"
        notification = await create_field_notification(
            db,
            notification_type="field_message",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=f"Meldung vom Feld ({who}) – {await _location(db, incident)}: {text}"
            if who
            else f"Meldung vom Feld: {text}",
        )
    await _broadcast(incident)
    return notification


async def field_report_state(db: AsyncSession, incident: Incident) -> dict[str, Any]:
    """The three field reports of one incident, as both routers return them.

    ``arrived_by_*`` is the arrival's own pair, not the row's ``created_by_*`` —
    see the note in ``record_arrival``.

    Three provenances, not two (§18.24): a crew tapping on `/feld`, an operator
    taking it over the radio, and the GPS automation having watched an assigned
    vehicle reach the address. ``arrived_in_kp`` deliberately excludes the third
    — it is what the UI words as "im KP erfasst", and no operator was involved.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    by_automation = bool(report and report.arrived_at and is_automation_user(report.arrived_by_user_id))
    return {
        "incident_id": incident.id,
        "arrived_at": report.arrived_at if report else None,
        "arrived_by_personnel_id": report.arrived_by_personnel_id if report else None,
        "arrived_by_automation": by_automation,
        "arrived_in_kp": bool(
            report and report.arrived_at and report.arrived_by_personnel_id is None and not by_automation
        ),
        "field_complete_reported_at": incident.field_complete_reported_at,
        "field_complete_reported_by": incident.field_complete_reported_by,
        "pickup_needed": incident.pickup_needed,
        "pickup_note": incident.pickup_note,
        "pickup_requested_at": incident.pickup_requested_at,
        "pickup_requested_by": incident.pickup_requested_by,
    }
