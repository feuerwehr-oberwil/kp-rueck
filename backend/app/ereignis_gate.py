"""The Ereignis delete gate: one advisory lock per Ereignis, taken before any row lock.

An Ereignis delete (``crud.locking.lock_event_for_delete``) locks the cards and then the Ereignis
row. Two writers take the Ereignis row before cards: a standby sync batch
(``standby_sync.apply_ops``) and each write phase of the bell poll
(``notification_service.evaluate_notifications``). They take the gate shared as the first lock of
their transaction, the delete takes it exclusively: they never wait for each other, and the delete
waits until they are done (and they while it runs), so the two orders never meet.

Plain strings, no app imports: the standby sidecar runs ``standby_sync`` with asyncpg alone.
"""

import uuid


def gate_key(event_id: uuid.UUID) -> str:
    """The advisory key of the Ereignis' gate, for ``pg_advisory_xact_lock[_shared](hashtext(…))``."""
    return f"ereignis_delete:{event_id}"
