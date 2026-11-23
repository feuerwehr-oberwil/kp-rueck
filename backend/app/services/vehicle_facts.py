"""Vehicle facts on an Einsatz that only a bell used to carry (owner round 23.11.2026, #1).

«TLF 1 am Einsatzort» (GPS geofence), «TLF 1 zurück im Magazin» (GPS return) and the
Übung's «Fahrzeug fällt aus» were notifications and nothing else: dismissed, they were
gone. Each one is now also an audit row on the incident, which the Einsatztagebuch turns
into a `field` line (`services/journal.FIELD_AUDIT_ACTIONS`) and the incident's Chronik
reads back (`services/incident_history.timeline`).

Once per incident, assignment and fact: the geofence is re-evaluated on every
notification poll, the GPS automation sees the same arrival (and an Auftrag vehicle on
every stop), and the return rules re-fire after a restart, but a vehicle reaches a
Schadenplatz once per stint. The check is in the database, under the caller's
transaction – no process cache, so a rolled-back write is written again on the next
poll. The caller commits.
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

    ``assignment_id`` makes it once per stint on this incident (incident or Auftrag
    assignment row); without one every call writes.
    """
    if assignment_id is not None:
        # Every board polls the geofence and the GPS tick sees the same arrival: two
        # writers at once must not both write it. Held until the caller's commit.
        await db.execute(
            sa_text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"vehicle_fact:{fact}:{incident_id}:{assignment_id}"},
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
    return True
