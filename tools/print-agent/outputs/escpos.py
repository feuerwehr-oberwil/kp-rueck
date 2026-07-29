"""ESC/POS output: render a structured job on a networked thermal printer.

**This is the only part of the agent with third-party dependencies** (`python-escpos`,
`pillow`, pulled in via `formatters`). They are imported inside `print_job`, not at module
import time, so a CUPS-only station can run the agent straight from a stdlib Python with
nothing installed — the bare-Pi install path this project actually uses. Import this module
freely; it only reaches for the packages when a job is really being printed.

Note on the filename: this is `outputs/escpos.py` while the dependency is the top-level
`escpos` package. That is safe — Python 3 imports are absolute, so `from escpos.printer
import Network` below resolves to the installed package, not to this file.
"""

from __future__ import annotations

from core import Job, log

# Connection-ish failures worth reporting as "the printer is unreachable" rather than as a
# raw traceback: the command post can act on the first (check the printer) and not the second.
_CONNECTION_MARKERS = (
    "could not open socket",
    "no route to host",
    "connection refused",
    "timed out",
    "timeout",
    "network is unreachable",
    "errno",
    "broken pipe",
)


class EscposOutput:
    """Prints structured jobs on an ESC/POS printer over TCP (typically port 9100).

    The printer's address is not configured here: the KP Rück backend owns it and the
    protocol driver refreshes it, so changing the printer in the settings UI takes effect
    without touching this machine. `resolve` is called before each job to pick it up.
    """

    name = "escpos"
    consumes = "payload"

    def __init__(self, ip: str = "", port: int = 9100, *, dry_run: bool = False) -> None:
        self.ip = ip
        self.port = port
        self.dry_run = dry_run

    def describe(self) -> str:
        if self.dry_run:
            return "ESC/POS (dry run — nothing is printed)"
        return f"ESC/POS → {self.ip or '?'}:{self.port}"

    def resolve(self, ip: str, port: int) -> None:
        """Adopt the printer address the backend reported."""
        self.ip, self.port = ip, port

    def print_job(self, job: Job) -> tuple[bool, str | None]:
        if self.dry_run:
            log(f"[dry run] would print {job.kind or 'job'} {job.id}: {sorted(job.payload)[:6]}")
            return True, None

        if not self.ip:
            return False, "no printer address — the backend has not reported one yet"

        try:
            from escpos.printer import Network

            from formatters import (
                format_assignment_slip,
                format_board_snapshot,
                format_qr_code_slip,
                format_test_print,
            )
        except ImportError as e:
            return False, (
                f"ESC/POS support is not installed ({e}). This output needs python-escpos and "
                "pillow — they are an OPTIONAL extra, so plain `uv sync` does not install "
                "them: run `uv sync --extra escpos` in tools/print-agent, or use the "
                "published image, which bakes the extra in."
            )

        renderers = {
            "assignment": format_assignment_slip,
            "board": format_board_snapshot,
            "test": format_test_print,
            "qr_code": format_qr_code_slip,
        }
        render = renderers.get(job.kind)
        if render is None:
            return False, f"unknown job type: {job.kind}"

        printer = None
        try:
            # A fresh connection per job: these printers drop idle sockets, and a stale
            # handle fails in ways that look like a formatting bug.
            printer = Network(self.ip, port=self.port)
            render(printer, job.payload)
            return True, None
        except Exception as e:
            raw = str(e)
            lowered = raw.lower()
            if isinstance(e, OSError) or any(m in lowered for m in _CONNECTION_MARKERS):
                return False, f"Drucker nicht erreichbar unter {self.ip}:{self.port}"
            return False, raw
        finally:
            if printer is not None:
                try:
                    printer.close()
                except Exception:
                    pass
