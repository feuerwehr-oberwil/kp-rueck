"""Has this incident ever been disponiert? One rule, one place.

A Schadenplatz that was never dispatched has nothing to report on, so the
Schadenplatz-Rapport does not exist for it: not as a form, not as a card chip,
and above all not as a line on the Restliste, where it would be counted as a
gap somebody has to close.

**"Ever", not "now".** Most rapports are filed on an incident that already
reached ``complete``, so a rule reading the *current* status would hide the
rapport from exactly the state it is written in. The history lives in
``status_transitions``.

**What counts as dispatched: the three *working* statuses.** ``enroute``,
``active``, ``returning`` — ever, in either direction of a transition.

Two deliberate edges, and they pull opposite ways:

* ``active`` and ``returning`` count even without a stop in ``enroute``. The
  board lets a card be dragged into any column, and the training simulator and
  the GPS automation both move cards, so an incident can land in ``active``
  without ever passing through ``enroute``. It *was* dispatched — a crew is at
  the address, it was only recorded coarsely — and it is among the likeliest to
  need a rapport.
* ``complete`` does **not** count on its own. It is a terminal state that says
  nothing about whether anybody went, and the noise this rule exists to remove
  lives exactly there: the false alarm, the duplicate, the call that resolved
  itself, dragged from *Eingegangen* straight to *Abgeschlossen*. Counting
  ``complete`` as evidence would make the rule a no-op on the card chip and on
  the Restliste, which are the two surfaces that complained. A card that really
  did have crews out and was closed in one drag still reaches every rapport
  surface the moment it is moved through any working column — and if a rapport
  was already filed, ``rapport_applies`` shows it regardless.

What stays out is what the rule is for: a card that only ever sat in
``incoming``, ``reko`` or ``reko_done``, or went straight from one of those to
``complete``. A Reko visit is answered by the Reko-Meldung, not by a
Schadenplatz-Rapport.

Batched by design: the board asks this for a whole storm night at once, so it is
one query for every incident on the list, never one per card.
"""

import uuid
from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import StatusTransition

#: The working statuses. Having held one of them — ever — is what "disponiert"
#: means everywhere in the codebase. `complete` is deliberately absent; see the
#: module docstring.
DISPATCHED_STATUSES = frozenset({"enroute", "active", "returning"})


class _HasStatus(Protocol):
    """Structural stand-in for `models.Incident`, so this module stays
    importable from `crud.incidents` and `crud.feld` alike."""

    id: uuid.UUID
    status: str


async def dispatched_incident_ids(
    db: AsyncSession,
    incidents: Sequence[_HasStatus],
) -> set[uuid.UUID]:
    """Of these incidents, the ones that have ever been disponiert.

    Two sources, because neither alone is complete:

    * the current status — an incident *created* straight into ``enroute`` (the
      alarm intake and the training generator both do it) has no transition row
      to show for it;
    * every transition it ever made, in either direction — ``from_status``
      counts too, so a card dragged back from ``active`` to ``incoming`` keeps
      its answer.
    """
    ids = {incident.id for incident in incidents if incident.status in DISPATCHED_STATUSES}
    remaining = [incident.id for incident in incidents if incident.id not in ids]
    if not remaining:
        return ids

    result = await db.execute(
        select(StatusTransition.incident_id)
        .where(
            StatusTransition.incident_id.in_(remaining),
            or_(
                StatusTransition.to_status.in_(DISPATCHED_STATUSES),
                StatusTransition.from_status.in_(DISPATCHED_STATUSES),
            ),
        )
        .distinct()
    )
    ids.update(result.scalars().all())
    return ids


async def is_dispatched(db: AsyncSession, incident: _HasStatus) -> bool:
    """The single-incident door onto the same rule."""
    return incident.id in await dispatched_incident_ids(db, [incident])


def rapport_applies(
    *,
    dispatched: bool,
    has_report: bool,
    reko_not_relevant: bool = False,
    status: str | None = None,
) -> bool:
    """Should this incident show a Schadenplatz-Rapport at all?

    An existing report always wins over the rule. A rapport that somebody
    already filed — on data that predates this rule, or on a card whose history
    was rewritten — must never become unreachable; hiding written work is a
    worse outcome than an empty form on a card that skipped the board.

    ``reko_not_relevant`` (+ ``status``) is the one thing that beats
    ``dispatched``: the Reko said «Kein Einsatz nötig», the KP closed the card,
    and nobody ever started a rapport — then there was nothing to report on,
    however the status history reads. The history lies exactly here: the GPS
    automation and the training simulator both walk a card through ``active``
    when the *Reko's* vehicle reaches the address, which is a recce, not work.
    Scoped to closed cards — an open card can still be dispatched despite the
    verdict, and the rapport must be there when it is.
    """
    if has_report:
        return True
    if reko_not_relevant and status == "complete":
        return False
    return dispatched


async def reko_not_relevant_ids(
    db: AsyncSession,
    incident_ids: Sequence[uuid.UUID],
) -> set[uuid.UUID]:
    """Of these incidents, the ones whose LATEST submitted Reko says
    «Kein Einsatz nötig» — batched, for the same reason as above."""
    if not incident_ids:
        return set()

    from ..models import RekoReport

    result = await db.execute(
        select(RekoReport.incident_id, RekoReport.is_relevant)
        .where(
            RekoReport.incident_id.in_(list(incident_ids)),
            RekoReport.is_draft.is_(False),
        )
        .order_by(RekoReport.submitted_at)
    )
    # Ordered oldest-first, so the newest verdict simply overwrites.
    latest: dict[uuid.UUID, bool | None] = {}
    for incident_id, is_relevant in result.all():
        latest[incident_id] = is_relevant
    return {incident_id for incident_id, is_relevant in latest.items() if is_relevant is False}
