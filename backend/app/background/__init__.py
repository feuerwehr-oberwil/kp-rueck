"""Background tasks and schedulers."""

from .sync_scheduler import start_sync_scheduler, stop_sync_scheduler

__all__ = [
    "start_sync_scheduler",
    "stop_sync_scheduler",
]


def start_demo_reset_scheduler():
    """Start the demo reset scheduler (lazy import to avoid circular deps)."""
    from .demo_reset import start_demo_reset_scheduler as _start

    _start()


def stop_demo_reset_scheduler():
    """Stop the demo reset scheduler (lazy import to avoid circular deps)."""
    from .demo_reset import stop_demo_reset_scheduler as _stop

    _stop()
