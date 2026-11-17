"""Queries for resources deployed on a visible Einsatz or Auftrag."""

import uuid

from sqlalchemy import Select, Subquery, select

from ..models import Event, Incident, IncidentAssignment, IncidentGroup, IncidentGroupAssignment


def active_deployments(resource_type: str, *, event_id: uuid.UUID | None = None) -> Subquery:
    """One row per active assignment. Without an event, consider every open Ereignis."""
    direct = (
        select(IncidentAssignment.resource_id, IncidentAssignment.id, IncidentAssignment.assigned_at)
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .join(Event, Event.id == Incident.event_id)
        .where(
            IncidentAssignment.resource_type == resource_type,
            IncidentAssignment.unassigned_at.is_(None),
            Incident.deleted_at.is_(None),
        )
    )
    route = (
        select(IncidentGroupAssignment.resource_id, IncidentGroupAssignment.id, IncidentGroupAssignment.assigned_at)
        .join(IncidentGroup, IncidentGroup.id == IncidentGroupAssignment.incident_group_id)
        .join(Event, Event.id == IncidentGroup.event_id)
        .where(
            IncidentGroupAssignment.resource_type == resource_type,
            IncidentGroupAssignment.unassigned_at.is_(None),
            IncidentGroup.deleted_at.is_(None),
        )
    )
    scope = Event.archived_at.is_(None) if event_id is None else Event.id == event_id
    return direct.where(scope).union_all(route.where(scope)).subquery()


def active_resource_ids(resource_type: str, *, event_id: uuid.UUID | None = None) -> Select[tuple[uuid.UUID]]:
    deployed = active_deployments(resource_type, event_id=event_id)
    return select(deployed.c.resource_id).distinct()
