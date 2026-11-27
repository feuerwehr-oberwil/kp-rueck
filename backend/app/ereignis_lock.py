"""The Ereignis lock: one advisory lock per Ereignis, the first lock of every transaction that
writes a row of it (the Ereignis, its cards, Aufträge, stops, crews, alarms, bell entries,
field requests, Reko, journal …).

Two writers of the same Ereignis therefore run one after the other, whatever rows they then
lock in whatever order. A transaction that writes several Ereignisse takes all their locks up
front, in the order of ``ereignis_lock_keys``. The app takes it with ``crud.locking.lock_ereignis``;
the rule and the rows without an Ereignis are in ``docs/BACKEND.md`` «Row locks».

Plain Python, no app imports: the standby sidecar (``standby_sync``) takes it with asyncpg alone.
"""

import uuid
from collections.abc import Iterable

#: Takes one key (``ereignis_lock_key``) to the end of the transaction. asyncpg style (``$1``).
LOCK_SQL = "SELECT pg_advisory_xact_lock($1)"


def ereignis_lock_key(event_id: uuid.UUID | str) -> int:
    """The advisory key of one Ereignis: the first 64 bits of its id, as a signed bigint."""
    return int.from_bytes(uuid.UUID(str(event_id)).bytes[:8], "big", signed=True)


def ereignis_lock_keys(event_ids: Iterable[uuid.UUID | str | None]) -> list[int]:
    """The keys to take for these Ereignisse, in the one order: sorted by key, once each.

    Sorted by key rather than by id, so two Ereignisse whose keys collide cannot be taken in
    opposite orders. ``None`` (a row with no Ereignis) is skipped.
    """
    return sorted({ereignis_lock_key(event_id) for event_id in event_ids if event_id is not None})
