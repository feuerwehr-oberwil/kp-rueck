"""Structured logging configuration for the KP Rück backend."""

import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import ClassVar


class RequestIdFilter(logging.Filter):
    """Attach the current request ID (from the request-ID middleware) to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        from app.middleware.request_id import get_request_id

        record.request_id = get_request_id() or "-"
        return True


class AccessLogPrivacyFilter(logging.Filter):
    """Exclude query credentials from Uvicorn logs, even when access logging is enabled."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) == 5:
            client, method, target, version, status = record.args
            if isinstance(target, str):
                record.args = (client, method, target.partition("?")[0], version, status)
        return True


# Credential-bearing QUERY parameters on OUTBOUND URLs. Divera authenticates every call with
# `?accesskey=` in the URL (there is no header form), and that URL reaches a log line in more
# ways than anyone will remember to guard at the call site: httpx's own INFO line for every
# request, the text of an `HTTPStatusError` ("… for url 'https://…?accesskey=…'"), a traceback.
# Anchored on `?`/`&` so it only ever touches a query string — the word «token» in an ordinary
# sentence stays. Not `telemetry.scrub.scrub_text`: that one also blanks every IP, path and
# address, which is right for a report leaving the station and wrong for the station's own log.
_SECRET_QUERY = re.compile(r"([?&](?:accesskey|access_key|api_key|apikey|token|secret)=)[^&\s\"'#]+", re.I)
# ASCII on purpose: this lands on stdout, which under a bare systemd/Docker locale may not be
# UTF-8, and a log line that cannot be encoded is a log line that is lost.
_REDACTED = "[redacted]"


def redact_secrets(text: str) -> str:
    """Blank the value of every credential query parameter in `text`."""
    return _SECRET_QUERY.sub(rf"\1{_REDACTED}", text)


class SecretQueryFilter(logging.Filter):
    """Redact credential query parameters from every record, whoever logged it.

    Sits on the root HANDLER, not on a logger: a logger's filters do not see records that
    propagate up from its children, a handler's filters see everything it writes. The message
    is rendered once here and frozen, and a traceback is pre-formatted into `exc_text` so the
    formatters print the redacted copy instead of rendering the exception themselves.

    ⚠️ This is the backstop, not the fix. Call sites still log status codes and hosts rather
    than URLs, and httpx is held at WARNING; this catches the path nobody thought of.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # a malformed record is the formatter's problem, not ours
            return True
        redacted = redact_secrets(message)
        if redacted != message:
            record.msg, record.args = redacted, None
        if record.exc_info and not record.exc_text:
            record.exc_text = redact_secrets(logging.Formatter().formatException(record.exc_info))
        elif record.exc_text:
            record.exc_text = redact_secrets(record.exc_text)
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
        # `exc_text` first: SecretQueryFilter leaves the redacted rendering there.
        if record.exc_text:
            log_record["exception"] = record.exc_text
        elif record.exc_info:
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
    handler.addFilter(SecretQueryFilter())

    # Use appropriate formatter
    if json_format:
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(ConsoleFormatter())

    root_logger.addHandler(handler)

    # Reduce noise from third-party libraries
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").addFilter(AccessLogPrivacyFilter())
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    # httpx logs every request at INFO with its FULL URL, query string included — for Divera
    # that is the access key, once per poll. Warnings and errors still come through.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for the given name.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)
