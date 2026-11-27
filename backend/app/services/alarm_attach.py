"""Attach a pool alarm to an Ereignis: its card, the link, and what the boards are told.

Three callers keep their own policy:

- single (``POST /divera/emergencies/{id}/attach``): the operator may merge the alarm into an
  open card; otherwise the new card is flagged as a possible duplicate. A refusal is an HTTP error.
- bulk (``POST /divera/emergencies/bulk-attach``): up to 100 at once, always flagged, never
  merged. A refusal is a German line in ``errors``, and the other alarms carry on.
- automatic (``try_auto_attach`` below, for the webhooks and the Divera poll): picks the
  Ereignis itself, only real alarms on real Ereignisse, the system is the actor, and it never
  raises into the webhook.

Each caller holds the alarm's row lock and the locks of its Ereignisse
(``crud.divera.lock_divera_emergency``) and has decided that it may attach. What they share is ``attach``, once: the card from the alarm, flag or merge,
the link, and – after the commit – the board broadcasts, «Anrückend», and the end of every
simulated GPS drive when the alarm is real.
"""

import contextlib
import logging
import uuid
from dataclasses import dataclass

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..crud import divera as divera_crud
from ..crud import incidents as incidents_crud
from ..database import after_commit, after_rollback
from ..websocket_manager import broadcast_divera_responses_update, broadcast_incident_update
from . import duplicates, incident_display
from .board_cards import board_response, broadcast_repointed
from .divera_intake import incident_create_from_emergency
from .settings import ALARM_DESCRIPTION_FILTER_PREFIXES, ALARM_DESCRIPTION_LABEL_PREFIXES, read

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Attached:
    """The alarm's own card, and the card the board shows for it (the merge target, if merged)."""

    incident: models.Incident
    card: schemas.IncidentResponse


async def attach(
    db: AsyncSession,
    emergency: models.DiveraEmergency,
    event_id: uuid.UUID,
    *,
    actor: models.User | None,
    request: Request | None = None,
    merge_into: models.Incident | None = None,
    touch_event: bool = True,
) -> Attached:
    """Make the alarm's card on `event_id`, flag or merge it, link the alarm. Flushes; the caller commits.

    ``merge_into`` (single attach only) must be locked (``crud.locking.lock_incident``); a
    refused merge raises ``duplicates.MergeRefusedError``. ``actor=None`` is the system, the
    auto-attach. The broadcasts are queued last, so a failed attach queues none – a caller that
    wraps it in a savepoint must not fail after it inside that savepoint. ``touch_event=False``
    (bulk attach): the caller stamps the Ereignis row once, after its last alarm – see below.
    """
    previous_event_id = emergency.attached_to_event_id
    card_data = incident_create_from_emergency(
        emergency,
        event_id,
        description_filter_prefixes=list(await read(db, ALARM_DESCRIPTION_FILTER_PREFIXES)),
        description_label_prefixes=list(await read(db, ALARM_DESCRIPTION_LABEL_PREFIXES)),
    )
    duplicate_of: uuid.UUID | None = None
    if merge_into is None:
        # Nobody looked at a duplicate hint for this card (or it had not loaded before the
        # click): the card itself says so and offers the one-click merge. Looked up before the
        # card exists and stored with its INSERT. The caller holds the Ereignis lock, so a second
        # alarm for the same place, attached at the same time, sees the first one's card.
        candidates = await duplicates.find_duplicate_candidates(
            db,
            event_id,
            lat=card_data.location_lat,
            lng=card_data.location_lng,
            address=card_data.location_address,
            limit=1,
        )
        duplicate_of = candidates[0].incident.id if candidates else None
    audit_extra: dict[str, object] = {"auto_attach_divera": True} if actor is None else {}
    if duplicate_of is not None:
        audit_extra["possible_duplicate_of_id"] = str(duplicate_of)
    incident = await incidents_crud.create_incident(
        db=db,
        incident=card_data,
        current_user=actor,
        request=request,
        source=emergency.source or "divera",
        source_ref=emergency.source_id,
        possible_duplicate_of_id=duplicate_of,
        audit_extra=audit_extra,
        touch_event=touch_event,
    )
    merged: duplicates.MergeResult | None = None
    if merge_into is not None:
        # The alarm's report becomes a Nachtrag on the open card. Its own row is still written
        # and linked: it keeps source/source_ref, and it is what «Trennen» brings back.
        merged = await duplicates.merge_report(db, report=incident, target=merge_into, user=actor, request=request)
    await divera_crud.attach_emergency_to_event(
        db=db, emergency_id=emergency.id, event_id=event_id, incident_id=incident.id
    )

    if merge_into is not None and merged is not None:
        await db.refresh(merge_into)
        card = await board_response(db, merge_into)
        after_commit(db, broadcast_incident_update, card.model_dump(mode="json"), "update")
        await broadcast_repointed(db, merged.repointed_ids)
    else:
        await db.refresh(incident)
        card = await incident_display.incident_with_display(db, incident)
        after_commit(db, broadcast_incident_update, card.model_dump(mode="json"), "create")

    # «Anrückend» on this Ereignis now counts the alarm's Rückmeldungen – and no longer on the
    # Ereignis a re-attach took it from.
    _announce_link_change(db, event_id, card.id)
    if previous_event_id is not None and previous_event_id != event_id:
        _announce_link_change(db, previous_event_id, None)

    # Reality preempts the drill. Simulated drives are global: they mask the real Traccar
    # position of their vehicle for EVERY consumer (map, GPS automation, geofences), and they
    # outlive the Übung that started them (30 min, in memory). A real alarm just put a real card
    # on the board, so the map has to show where the vehicles really are. Once per commit: a
    # bulk attach must not stop a drive started between two of its stops.
    if not emergency.is_training and not db.info.get(_SIMULATIONS_STOPPING):
        db.info[_SIMULATIONS_STOPPING] = True
        after_commit(db, _stop_gps_simulations, db, event_id)
        after_rollback(db, db.info.pop, _SIMULATIONS_STOPPING, None)

    logger.info("Alarm %s attached to Ereignis %s (card %s)", emergency.id, event_id, card.id)
    return Attached(incident=incident, card=card)


async def try_auto_attach(db: AsyncSession, emergency: models.DiveraEmergency) -> models.Incident | None:
    """Attach a fresh emergency to the newest active event with auto-attach on.

    Only real emergencies attach to real events: simulated training alarms are
    skipped entirely (trainees attach them by hand — that's the exercise), and
    training events never receive auto-attached incidents. Returns the created
    incident, or None when no event wants auto-attach.

    Never raises: a failed auto-attach must not fail the webhook ACK back to
    Divera — the emergency is already stored and stays manually attachable.
    """
    # Read now: the savepoint's rollback expires the row, and a lazy load here is a MissingGreenlet.
    provider_id = emergency.divera_id
    try:
        # A savepoint: the caller's transaction holds the emergency itself, which a failed
        # attach must not take down with it.
        async with db.begin_nested():
            return await _auto_attach(db, emergency)
    except Exception:
        logger.exception("Auto-attach failed for Divera emergency %s", provider_id)
        # Leave the session usable for the caller's response handling. The
        # rollback expires loaded attributes, so re-load the emergency before
        # the caller serializes it (sync attribute access on an expired object
        # would blow up in the async session).
        with contextlib.suppress(Exception):  # already on the error path; a failed refresh changes nothing
            await db.refresh(emergency)
        return None


async def _auto_attach(db: AsyncSession, emergency: models.DiveraEmergency) -> models.Incident | None:
    event_id = await db.scalar(divera_crud.auto_attach_target())
    if event_id is None:
        return None
    # Row-locked like the manual attach (crud.divera.lock_divera_emergency), after the Ereignis it
    # goes onto: an operator who pulls the fresh alarm onto a board in the same instant must not
    # get a second card. populate_existing refreshes `emergency`, so the check sees the locked row.
    if await divera_crud.lock_divera_emergency(db, emergency.id, onto=[event_id]) is None:
        return None
    if emergency.is_training or emergency.attached_to_event_id is not None:
        return None
    # Read again under its lock: switched off, archived or overtaken meanwhile, it takes no alarm.
    if await db.scalar(divera_crud.auto_attach_target()) != event_id:
        return None
    # The caller's commit stores card and link together – it is also what releases the row lock.
    return (await attach(db, emergency, event_id, actor=None)).incident


_LINK_CHANGES = "kp_alarm_link_changes"
_SIMULATIONS_STOPPING = "kp_alarm_stops_simulations"


def _announce_link_change(db: AsyncSession, event_id: uuid.UUID, incident_id: uuid.UUID | None) -> None:
    """«Anrückend» re-reads on these Ereignisse: ONE broadcast per commit, however many alarms
    the transaction attached – a bulk attach of 100 alarms is one summary reload per board."""
    pending: tuple[set[uuid.UUID], set[uuid.UUID]] | None = db.info.get(_LINK_CHANGES)
    if pending is None:
        pending = (set(), set())
        db.info[_LINK_CHANGES] = pending
        after_commit(db, _send_link_changes, db, pending)
        after_rollback(db, db.info.pop, _LINK_CHANGES, None)
    pending[0].add(event_id)
    if incident_id is not None:
        pending[1].add(incident_id)


async def _send_link_changes(db: AsyncSession, pending: tuple[set[uuid.UUID], set[uuid.UUID]]) -> None:
    if db.info.get(_LINK_CHANGES) is pending:
        del db.info[_LINK_CHANGES]
    await broadcast_divera_responses_update(*pending)


async def _stop_gps_simulations(db: AsyncSession, event_id: uuid.UUID) -> None:
    """Once a real alarm is on the board: stop every simulated drive (see `attach`)."""
    db.info.pop(_SIMULATIONS_STOPPING, None)
    # Lazy import mirrors traccar.py's: gps_simulation pulls in websocket_manager.
    from .gps_simulation import gps_simulation

    stopped = await gps_simulation.stop()
    if stopped:
        logger.info("Stopped %d simulated GPS drive(s): real alarm attached to Ereignis %s", stopped, event_id)
