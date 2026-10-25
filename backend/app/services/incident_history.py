"""The history of one incident, as a read model: who was on it, and what happened when.

Two views over the same rows, both read-only – the routes (`GET /incidents/{id}/participants`
and `/timeline`) only check that the incident exists and call in here:

- `participants` – the "Beteiligt" roll-up: one entry per resource that was ever assigned.
- `timeline` – the "Verlauf" feed: status changes, assignments, field and KP messages and
  merges, newest first.
"""

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..crud import kp_messages as kp_messages_crud
from . import duplicates
from .incident_leader import effective_leader_ids

# `type[Any]`, not `type[Base]`: mypy joins the three model classes to their common base,
# which declares neither `id` nor `name`, so a loop over them stopped type-checking (it is
# what turned main red on 2026-08-05). This is plan 14's pattern 2 — the same reason
# `SyncService.SYNCABLE_MODELS` is annotated this way. A Protocol does not fit: `select()`
# needs a real entity, not a structural type.
_RESOURCE_MODELS: tuple[tuple[str, type[Any]], ...] = (
    ("personnel", models.Personnel),
    ("vehicle", models.Vehicle),
    ("material", models.Material),
)


async def resource_names(
    db: AsyncSession, assignments: Iterable[models.IncidentAssignment]
) -> dict[tuple[str, uuid.UUID], str]:
    """Names of the assigned resources, keyed by (resource_type, resource_id): one query per kind."""
    rows = list(assignments)
    names: dict[tuple[str, uuid.UUID], str] = {}
    for resource_type, model in _RESOURCE_MODELS:
        ids = {a.resource_id for a in rows if a.resource_type == resource_type}
        if not ids:
            continue
        result = await db.execute(select(model).where(model.id.in_(ids)))
        for row in result.scalars().all():
            names[(resource_type, row.id)] = row.name
    return names


async def participants(db: AsyncSession, incident: models.Incident) -> list[schemas.IncidentParticipant]:
    """Everyone and everything that was on this incident — the "Beteiligt" roll-up.

    Completing an incident releases its crew, so the board's crew list goes
    empty and the record of who actually turned out only survives in the
    assignment rows (soft-released via ``unassigned_at``). This rolls those rows
    up to one entry per resource so the question "who was there" is answerable
    long after the incident closed. Earliest involvement first.
    """
    result = await db.execute(
        select(models.IncidentAssignment)
        .where(models.IncidentAssignment.incident_id == incident.id)
        .order_by(models.IncidentAssignment.assigned_at)
    )
    assignments = list(result.scalars().all())
    names = await resource_names(db, assignments)

    # Who held the Reko function for this event. A Reko person shows up in the
    # assignment rows like anyone else, but they went to look, not to work — the
    # list says so rather than filing them under crew.
    reko_ids: set[uuid.UUID] = set()
    if incident.event_id:
        reko_rows = await db.execute(
            select(models.EventSpecialFunction.personnel_id).where(
                models.EventSpecialFunction.event_id == incident.event_id,
                models.EventSpecialFunction.function_type == "reko",
            )
        )
        reko_ids = {row[0] for row in reko_rows.all()}

    # Who led it. `is_leader` is cleared when an assignment is released, so rolling
    # the raw flag up leaves a completed incident with nobody flagged — in the one
    # view whose entire job is to answer "who was here" long after it closed.
    # Resolve it the way every other reader does.
    active_leader_ids = {
        a.resource_id for a in assignments if a.resource_type == "personnel" and a.is_leader and a.unassigned_at is None
    }
    leader_ids = effective_leader_ids(incident, active_leader_ids)

    rolled: dict[tuple[str, uuid.UUID], schemas.IncidentParticipant] = {}
    for a in assignments:
        key = (a.resource_type, a.resource_id)
        is_leader = a.resource_type == "personnel" and a.resource_id in leader_ids
        existing = rolled.get(key)
        if existing is None:
            rolled[key] = schemas.IncidentParticipant(
                resource_type=a.resource_type,
                resource_id=a.resource_id,
                name=names.get(key),
                first_assigned_at=a.assigned_at,
                last_released_at=a.unassigned_at,
                stints=1,
                is_reko=a.resource_type == "personnel" and a.resource_id in reko_ids,
                is_leader=is_leader,
            )
            continue
        existing.stints += 1
        existing.is_leader = existing.is_leader or is_leader
        # A single still-open stint makes the whole participation still open,
        # whatever order the rows arrived in.
        if existing.last_released_at is not None:
            existing.last_released_at = (
                None if a.unassigned_at is None else max(existing.last_released_at, a.unassigned_at)
            )

    # Longest involvement first — the people who carried the incident read top.
    return sorted(rolled.values(), key=lambda p: p.first_assigned_at)


def _actor(user: models.User | None) -> str | None:
    if user is None:
        return None
    return user.display_name or user.username


async def timeline(db: AsyncSession, incident: models.Incident) -> list[schemas.IncidentTimelineEvent]:
    """The merged event feed of an incident, newest first.

    Combines status transitions, resource assignments (assign + unassign) and
    the field's Freitext-Meldungen into a single chronologically sorted list.
    It is the whole content of the "Verlauf" tab in the operation detail, and
    the source of the message thread shown next to the Feldmeldungen.
    """
    incident_id = incident.id

    # Load status transitions with the user who made each change
    transitions_result = await db.execute(
        select(models.StatusTransition, models.User)
        .outerjoin(models.User, models.StatusTransition.user_id == models.User.id)
        .where(models.StatusTransition.incident_id == incident_id)
        .order_by(models.StatusTransition.timestamp)
    )
    transitions = transitions_result.all()

    # Load assignments with the user who made each assignment
    assignments_result = await db.execute(
        select(models.IncidentAssignment, models.User)
        .outerjoin(models.User, models.IncidentAssignment.assigned_by == models.User.id)
        .where(models.IncidentAssignment.incident_id == incident_id)
    )
    assignments = assignments_result.all()

    # Freitext-Meldungen from the field. They have no table of their own — see
    # `crud/feld.record_field_message`, which writes them as an append-only
    # audit-log entry plus a notification. That was exactly the problem: the
    # notification is dismissible and the audit log is not rendered anywhere on
    # the incident, so what a crew radioed in was visible nowhere afterwards.
    # Reading them back here is what puts them in the incident's own history.
    #
    # …including the ones sent to a duplicate card that was merged into this one:
    # their requests moved here with the merge (services/merge_requests.py), so
    # the sentences that came with them belong in this thread too.
    merged_here = (
        (await db.execute(select(models.Incident.id).where(models.Incident.merged_into_id == incident_id)))
        .scalars()
        .all()
    )
    messages_result = await db.execute(
        select(models.AuditLog, models.User)
        .outerjoin(models.User, models.AuditLog.user_id == models.User.id)
        .where(
            models.AuditLog.resource_type == "incident",
            models.AuditLog.resource_id.in_([incident_id, *merged_here]),
            models.AuditLog.action_type == "field_message",
        )
    )
    field_messages = messages_result.all()

    # Merges into this card, and their undos (services/duplicates.py). The
    # Nachtrag text is rebuilt from the merged report's own row rather than
    # read from the audit entry — the audit row deliberately carries no PII.
    merges_result = await db.execute(
        select(models.AuditLog, models.User)
        .outerjoin(models.User, models.AuditLog.user_id == models.User.id)
        .where(
            models.AuditLog.resource_type == "incident",
            models.AuditLog.resource_id == incident_id,
            models.AuditLog.action_type.in_((duplicates.MERGE_ACTION, duplicates.UNMERGE_ACTION)),
        )
    )
    merge_entries = merges_result.all()
    merged_ids = {
        uuid.UUID(str(entry.changes_json["merged_incident_id"]))
        for entry, _ in merge_entries
        if entry.changes_json and entry.changes_json.get("merged_incident_id")
    }
    merged_reports: dict[uuid.UUID, models.Incident] = {}
    if merged_ids:
        rows = await db.execute(select(models.Incident).where(models.Incident.id.in_(merged_ids)))
        merged_reports = {r.id: r for r in rows.scalars().all()}

    # …and the KP's own messages to the squad (sweep 27 §P3.2). They have a
    # table (`incident_field_messages`) because `/feld` has to read them back;
    # here they interleave with the crew's sentences so the thread shows both
    # halves of the conversation.
    kp_messages = await kp_messages_crud.messages_for_incident(db, incident_id)

    names = await resource_names(db, (assignment for assignment, _ in assignments))

    events: list[schemas.IncidentTimelineEvent] = []

    previous_at: datetime | None = None
    for transition, user in transitions:
        # A move the operator confirmed after «Gerade geändert»: how long the card had
        # already stood where their board did not show it («war schon abgeschlossen (vor 4 s)»).
        stale_seconds = (
            max(0, int((transition.timestamp - previous_at).total_seconds()))
            if transition.seen_status is not None and previous_at is not None and transition.timestamp is not None
            else None
        )
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="status_change",
                timestamp=transition.timestamp,
                actor_name=_actor(user),
                from_status=transition.from_status,
                to_status=transition.to_status,
                notes=transition.notes,
                seen_status=transition.seen_status,
                stale_seconds=stale_seconds,
            )
        )
        previous_at = transition.timestamp

    for assignment, user in assignments:
        actor = _actor(user)
        name = names.get((assignment.resource_type, assignment.resource_id))
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="assignment",
                timestamp=assignment.assigned_at,
                actor_name=actor,
                assignment_action="assigned",
                resource_type=assignment.resource_type,
                resource_name=name,
            )
        )
        if assignment.unassigned_at is not None:
            # No `unassigned_by` field — actor unknown for unassign events
            events.append(
                schemas.IncidentTimelineEvent(
                    event_type="assignment",
                    timestamp=assignment.unassigned_at,
                    actor_name=None,
                    assignment_action="unassigned",
                    resource_type=assignment.resource_type,
                    resource_name=name,
                )
            )

    for entry, user in field_messages:
        changes = entry.changes_json or {}
        text = changes.get("message")
        if not text:
            continue
        # Provenance, never faked: a crew member's name when the message came
        # through /feld, the operator's when it was typed in the KP.
        personnel_name = changes.get("personnel_name")
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="field_message",
                timestamp=entry.timestamp,
                actor_name=personnel_name or _actor(user),
                message=str(text),
                source=changes.get("source"),
            )
        )

    for entry, user in merge_entries:
        changes = entry.changes_json or {}
        raw_id = changes.get("merged_incident_id")
        merged_id = uuid.UUID(str(raw_id)) if raw_id else None
        merged = merged_reports.get(merged_id) if merged_id else None
        is_merge = entry.action_type == duplicates.MERGE_ACTION
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="merge" if is_merge else "unmerge",
                timestamp=entry.timestamp,
                actor_name=changes.get("personnel_name") or _actor(user),
                message=(
                    duplicates.merge_note(merged, reporter_name=changes.get("personnel_name"))
                    if merged is not None and is_merge
                    else (merged.location_address or merged.title if merged is not None else None)
                ),
                source=changes.get("source"),
                merged_incident_id=merged_id,
                # Only a merge that still stands can be undone from here.
                merge_active=bool(is_merge and merged is not None and merged.merged_into_id == incident_id),
            )
        )

    for kp_message in kp_messages:
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="kp_message",
                timestamp=kp_message.created_at,
                actor_name=kp_message.author_name,
                message=kp_message.message,
                source="kp",
            )
        )

    events.sort(key=lambda e: e.timestamp)

    # Collapse near-duplicate events: same payload within a short time window
    # is treated as one event. Covers cascading unassigns on completion plus
    # bursty re-clicks. Real re-assignments minutes apart are kept.
    dedup_window_seconds = 10
    last_seen: dict[tuple[str, str | None, str | None, str | None, str | None, str | None], datetime] = {}
    deduped: list[schemas.IncidentTimelineEvent] = []
    for event in events:
        # Messages are never deduplicated. They are human input, they are the
        # one kind of entry here nobody can reconstruct from board state, and a
        # crew tapping the same chip twice is itself information.
        if event.event_type in ("field_message", "kp_message", "merge", "unmerge"):
            deduped.append(event)
            continue
        payload_key = (
            event.event_type,
            event.from_status,
            event.to_status,
            event.assignment_action,
            event.resource_type,
            event.resource_name,
        )
        prev_ts = last_seen.get(payload_key)
        if prev_ts is not None and (event.timestamp - prev_ts).total_seconds() < dedup_window_seconds:
            continue
        last_seen[payload_key] = event.timestamp
        deduped.append(event)

    # Display order: newest first. Dedup happens on the ascending sort above so
    # the "earliest of a near-duplicate cluster" is the one we keep.
    deduped.reverse()
    return deduped
