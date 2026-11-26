"""The Ereignis delete gate: one advisory lock per Ereignis, taken before any row lock.

One rule: a transaction that deletes an Ereignis takes it exclusively – the app's delete
(``crud.locking.lock_event_for_delete``) and a synced one (``standby_sync.apply_ops``, a batch or
op with an ``events`` delete); every other user takes it shared.

An Ereignis delete locks the cards and then the Ereignis row. Writers that take the Ereignis row
before cards – a standby sync batch (``standby_sync.apply_ops``), each write phase of the bell
poll (``notification_service.evaluate_notifications``), a bell dismissal – take the gate shared as
the first lock of their transaction: they never wait for each other, and the delete
waits until they are done (and they while it runs), so the two orders never meet. The box's sync
round applies a batch in one transaction; the hosted board's ``POST /api/standby/sync`` runs each
op in its own (``api/standby._driver``), so every op enters the gate again.

Plain strings, no app imports: the standby sidecar runs ``standby_sync`` with asyncpg alone.
"""

import uuid


def gate_key(event_id: uuid.UUID) -> str:
    """The advisory key of the Ereignis' gate, for ``pg_advisory_xact_lock[_shared](hashtext(…))``."""
    return f"ereignis_delete:{event_id}"
