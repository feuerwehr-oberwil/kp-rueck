"""Structured logging configuration for the KP Rück backend."""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import ClassVar


class RequestIdFilter(logging.Filter):
    """Attach the current request ID (from the request-ID middleware) to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        from app.middleware.request_id import get_request_id

        record.request_id = get_request_id() or "-"
        return True


class JSONFormatter(logging.Formatter):
    """JSON formatter for structured logging in production."""

    def format(self, record: logging.LogRecord) -> str:
        log_record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        request_id = getattr(record, "request_id", "-")
        if request_id != "-":
            log_record["request_id"] = request_id

        # Add extra fields if present
        if hasattr(record, "extra"):
            log_record.update(record.extra)

        # Add exception info if present
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_record)


class ConsoleFormatter(logging.Formatter):
    """Pretty formatter for local development."""

    COLORS: ClassVar[dict[str, str]] = {
        "DEBUG": "\033[36m",  # Cyan
        "INFO": "\033[32m",  # Green
        "WARNING": "\033[33m",  # Yellow
        "ERROR": "\033[31m",  # Red
        "CRITICAL": "\033[35m",  # Magenta
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        request_id = getattr(record, "request_id", "-")
        rid_prefix = f"[{request_id}] " if request_id != "-" else ""
        return f"{color}[{timestamp}] {record.levelname:8}{self.RESET} {rid_prefix}{record.name}: {record.getMessage()}"


def setup_logging(
    level: str = "INFO",
    json_format: bool = False,
) -> None:
    """
    Configure logging for the application.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        json_format: Use JSON format for logs (recommended for production)
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Create console handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(getattr(logging, level.upper()))
    handler.addFilter(RequestIdFilter())

    # Use appropriate formatter
    if json_format:
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(ConsoleFormatter())

    root_logger.addHandler(handler)

    # Reduce noise from third-party libraries
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for the given name.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)
