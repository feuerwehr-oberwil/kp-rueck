"""Wake-up signal that turns the print agent's poll into a long poll.

The agent used to learn about a new job only on its next poll — up to a minute after the
slip was queued, and the minute-long gap is exactly the first print of an operation, because
the agent only speeds up *after* it has printed something. So the backend now holds the
pending-jobs request open and this is what ends the wait: every place that queues a job calls
`notify_job_queued`, and the parked request returns within milliseconds.

Deliberately in-memory, and that is sound here rather than merely convenient: the deployment
runs a single uvicorn worker (`backend/start.sh`), so the waiter and the notifier are always
in the same event loop. It is also only an optimisation — `api/print.py` re-queries the
database on a short timer while it waits, so a missed signal costs a few seconds, never a
lost job. Should the backend ever be scaled to several workers, that fallback is what keeps
it correct, and this module is where the note to replace it with LISTEN/NOTIFY belongs.
"""

import asyncio

# Cleared before each database look, set by whoever queues a job. Arming *before* the query
# is what makes the sequence race-free: a job that arrives while the query runs either shows
# up in that query's result or re-sets the event, and never falls between the two.
_queued = asyncio.Event()


def notify_job_queued() -> None:
    """Wake every agent parked on the pending-jobs endpoint. Safe to call when none is."""
    _queued.set()


def arm() -> None:
    """Clear the signal ahead of a database look. See the note on `_queued`."""
    _queued.clear()


async def wait_for_job() -> None:
    """Block until a job is queued. Unbounded on purpose — the caller owns the deadline.

    The endpoint has to bound the hang anyway (a proxy would drop it otherwise), so a
    timeout argument here would only be a second place to get that number wrong. Wrap the
    call in `asyncio.timeout` instead.
    """
    await _queued.wait()
