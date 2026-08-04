"""Background tasks and schedulers."""

from .sync_scheduler import start_sync_scheduler, stop_sync_scheduler

__all__ = [
    "start_sync_scheduler",
    "stop_sync_scheduler",
]


def start_demo_reset_scheduler() -> None:
    """Start the demo reset scheduler (lazy import to avoid circular deps)."""
    from .demo_reset import start_demo_reset_scheduler as _start

    _start()


def stop_demo_reset_scheduler() -> None:
    """Stop the demo reset scheduler (lazy import to avoid circular deps)."""
    from .demo_reset import stop_demo_reset_scheduler as _stop

    _stop()


def start_audit_cleanup_scheduler() -> None:
    """Start the audit cleanup scheduler (lazy import to avoid circular deps)."""
    from .audit_cleanup import start_audit_cleanup_scheduler as _start

    _start()


def stop_audit_cleanup_scheduler() -> None:
    """Stop the audit cleanup scheduler (lazy import to avoid circular deps)."""
    from .audit_cleanup import stop_audit_cleanup_scheduler as _stop

    _stop()


def start_telemetry_scheduler() -> None:
    """Start the telemetry flush scheduler (lazy import to avoid circular deps)."""
    from .telemetry_flush import start_telemetry_scheduler as _start

    _start()


def stop_telemetry_scheduler() -> None:
    """Stop the telemetry flush scheduler (lazy import to avoid circular deps)."""
    from .telemetry_flush import stop_telemetry_scheduler as _stop

    _stop()


def start_heartbeat_scheduler() -> None:
    """Start the dead-man's-switch heartbeat (lazy import to avoid circular deps)."""
    from .heartbeat import start_heartbeat_scheduler as _start

    _start()


def stop_heartbeat_scheduler() -> None:
    """Stop the dead-man's-switch heartbeat (lazy import to avoid circular deps)."""
    from .heartbeat import stop_heartbeat_scheduler as _stop

    _stop()
