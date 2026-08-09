"""The effective Einsatzleiter of one incident — one rule, one place.

Two columns carry the role and they answer different halves of the question:

* ``IncidentAssignment.is_leader`` — who leads it **right now**. Lives on the
  assignment row, cleared when that row is released.
* ``Incident.leader_personnel_id`` — who led it, **on the record**. Survives the
  crew going home, because completing an incident releases every assignment and
  therefore erases the flag from all of them.

Every reader wants the same thing: *the* leader, whether the incident is still
running or finished. That is the active flag if there is one, and the leader of
record otherwise — never the other way round, because a live incident whose
leader has changed since the last stamp must show the person actually leading
it.

Pure functions on purpose: the callers already hold their rows (the report
services work off a preloaded `EventReportData`, `/feld` off its own queries),
and a resolver that opened its own session could not be used by either.
"""

import uuid
from collections.abc import Iterable
from typing import Protocol


class _HasLeaderOfRecord(Protocol):
    """Structural stand-in for `models.Incident` — keeps this module importable
    from both `crud` and `services` without a circular import."""

    leader_personnel_id: uuid.UUID | None


def effective_leader_ids(
    incident: _HasLeaderOfRecord,
    active_leader_ids: Iterable[uuid.UUID],
) -> set[uuid.UUID]:
    """The leader(s) of this incident, as a set for membership tests.

    A partial unique index allows at most one active leader per incident, so
    this holds zero or one id — a set only because the sort keys that consume it
    read best as ``id not in leaders``.
    """
    active = set(active_leader_ids)
    if active:
        return active
    if incident.leader_personnel_id is not None:
        return {incident.leader_personnel_id}
    return set()


def effective_leader_id(
    incident: _HasLeaderOfRecord,
    active_leader_ids: Iterable[uuid.UUID],
) -> uuid.UUID | None:
    """The single leader of this incident, or None when nobody ever led it."""
    ids = effective_leader_ids(incident, active_leader_ids)
    return next(iter(ids)) if ids else None
