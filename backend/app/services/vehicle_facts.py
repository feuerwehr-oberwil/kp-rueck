"""Vehicle facts on an Einsatz that only a bell used to carry (owner round 23.11.2026, #1).

«TLF 1 am Einsatzort» (GPS geofence), «TLF 1 zurück im Magazin» (GPS return) and the
Übung's «Fahrzeug fällt aus» were notifications and nothing else: dismissed, they were
gone. Each one is now also an audit row on the incident, which the Einsatztagebuch turns
into a `field` line (`services/journal.FIELD_AUDIT_ACTIONS`) and the incident's Chronik
reads back (`services/incident_history.timeline`).

Once per assignment and fact: the geofence is re-evaluated on every notification poll
and the GPS return rules re-fire after a restart, but a vehicle reaches a Schadenplatz
once per stint. The caller commits.
"""

import uuid
from typing import Literal

from sqlalchemy import select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog, User
from .audit import log_action

VehicleFact = Literal["vehicle_on_site", "vehicle_returned", "vehicle_down"]
VEHICLE_FACT_ACTIONS: tuple[VehicleFact, ...] = ("vehicle_on_site", "vehicle_returned", "vehicle_down")

# (fact, assignment) pairs this process has already written — saves the lookup on every poll.
_recorded: set[tuple[str, uuid.UUID]] = set()


async def record_vehicle_fact(
    db: AsyncSession,
    *,
    incident_id: uuid.UUID,
    fact: VehicleFact,
    vehicle_name: str,
    source: Literal["gps", "training"],
    assignment_id: uuid.UUID | None = None,
    user: User | None = None,
) -> bool:
    """Write the fact once; True when it was new.

    ``assignment_id`` makes it once per stint (incident or Auftrag assignment row);
    without one every call writes.
    """
    if assignment_id is not None:
        key = (fact, assignment_id)
        if key in _recorded:
            return False
        # Every board polls the geofence: two polls at once must not both write it.
        await db.execute(
            sa_text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"vehicle_fact:{fact}:{assignment_id}"}
        )
        existing = await db.execute(
            select(AuditLog.id)
            .where(
                AuditLog.resource_type == "incident",
                AuditLog.resource_id == incident_id,
                AuditLog.action_type == fact,
                AuditLog.changes_json["assignment_id"].astext == str(assignment_id),
            )
            .limit(1)
        )
        if existing.first() is not None:
            _recorded.add(key)
            return False
    await log_action(
        db=db,
        action_type=fact,
        resource_type="incident",
        resource_id=incident_id,
        user=user,
        changes={
            "vehicle_name": vehicle_name,
            "source": source,
            "assignment_id": str(assignment_id) if assignment_id else None,
        },
    )
    if assignment_id is not None:
        _recorded.add((fact, assignment_id))
    return True
