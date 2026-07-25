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


def start_audit_cleanup_scheduler():
    """Start the audit cleanup scheduler (lazy import to avoid circular deps)."""
    from .audit_cleanup import start_audit_cleanup_scheduler as _start

    _start()


def stop_audit_cleanup_scheduler():
    """Stop the audit cleanup scheduler (lazy import to avoid circular deps)."""
    from .audit_cleanup import stop_audit_cleanup_scheduler as _stop

    _stop()


def start_telemetry_scheduler():
    """Start the telemetry flush scheduler (lazy import to avoid circular deps)."""
    from .telemetry_flush import start_telemetry_scheduler as _start

    _start()


def stop_telemetry_scheduler():
    """Stop the telemetry flush scheduler (lazy import to avoid circular deps)."""
    from .telemetry_flush import stop_telemetry_scheduler as _stop

    _stop()
