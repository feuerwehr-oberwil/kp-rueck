"""Whether anyone is using the public demo right now – so its background work can stop.

The demo runs on Railway Serverless: a service sleeps once it has sent no packets for 5–10
minutes, and the next request wakes it (a cold boot, which resets the demo – see
background/demo_reset.py). Any job that reads Postgres or calls out keeps the backend AND the
database awake, so on the demo such a job asks `demo_idle()` first and skips its tick while
nobody is there. A job that only touches memory needs no check.

«Somebody is there» means a board is connected over the socket – every open board holds one;
a hidden tab drops it after a while (components/demo-banner.tsx). For `BOOT_GRACE_SECONDS`
after the start the demo counts as used anyway: on Serverless a boot is caused by a visitor
whose board is still loading, and the jobs' first runs (weather, notifications) are for them.

Never idle outside demo mode: a station's board does its work whether or not a tab is open.
"""

import time

from .config import settings

BOOT_GRACE_SECONDS = 120.0
_booted_at = time.monotonic()


def demo_unwatched() -> bool:
    """On the demo: no board is connected. False everywhere else."""
    if not settings.demo_mode:
        return False
    from .websocket_manager import ws_manager  # websocket_manager imports half the app

    return not ws_manager.user_sessions


def demo_idle() -> bool:
    """On the demo: no board connected and the boot grace is over. False everywhere else."""
    return demo_unwatched() and time.monotonic() - _booted_at > BOOT_GRACE_SECONDS
