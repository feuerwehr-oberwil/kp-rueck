"""The operator's manual order of a short list – shared by an Auftrag's stops and a Reko person's Rekos.

Both lists behave the same (owner, 19.11.2026: «reko and auftrag behave the same but just show
things differently»): the board drags a row, the client sends the whole new order, and the
server applies it to the rows it holds NOW. Each caller locks and reads its rows, asks
``plan_manual_order`` for the order to write, and writes its own position column.
"""

import uuid


class OrderChangedError(Exception):
    """The list is no longer what the caller expected (→ 409 «… wurde inzwischen geändert»)."""


def plan_manual_order(
    current_ids: list[uuid.UUID],
    ordered_ids: list[uuid.UUID],
    expected_ids: list[uuid.UUID] | None = None,
) -> list[uuid.UUID]:
    """The full order to write: ``ordered_ids`` that still exist, then the rest as they stood.

    ``current_ids`` is the list as the caller read it under its lock. Unknown or stale ids in
    ``ordered_ids`` are skipped; a row the client did not know about keeps its place after the
    ordered ones rather than vanishing from the list.

    With ``expected_ids`` the write is conditional: ``current_ids`` must equal it exactly, else
    ``OrderChangedError`` and the caller writes nothing. Checking under the caller's lock is the
    point – a check in the browser alone leaves a gap in which another device adds, removes or
    reorders a row.
    """
    if expected_ids is not None and current_ids != expected_ids:
        raise OrderChangedError("the list changed since the order was read")
    known = set(current_ids)
    placed: list[uuid.UUID] = []
    for item_id in ordered_ids:
        if item_id in known and item_id not in placed:
            placed.append(item_id)
    placed_set = set(placed)
    return placed + [item_id for item_id in current_ids if item_id not in placed_set]
