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

import contextlib

from core import Job, PrintResult, log

# Connecting and printing want very different patience, and python-escpos has one knob for
# both (`timeout`, applied to the socket for its whole life). So we open with the short one
# and widen it once the printer has answered.
#
# CONNECT: a printer that is powered off on Wi-Fi black-holes the SYN — no refusal, no reset —
# and the library's default left the worker thread hanging a full minute per attempt, three
# times over, with nothing else printing meanwhile. On a station LAN a printer that has not
# answered in five seconds is not busy, it is off.
DEFAULT_CONNECT_TIMEOUT_SEC = 5.0
# SESSION: sending is not instant once the printer starts pulling paper — a long board
# snapshot can block on a full buffer for a while, and cutting that off would truncate the
# print. Generous on purpose; it only ever bounds a printer that answered and then died.
DEFAULT_SESSION_TIMEOUT_SEC = 60.0

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

    The PRIMARY printer's address is not configured here: the KP Rück backend owns it and the
    protocol driver refreshes it, so changing the printer in the settings UI takes effect
    without touching this machine. `resolve` is called before each job to pick it up.

    A destination configured with an explicit `ip` is PINNED and ignores `resolve` — that is
    how a backup printer is named, since the backend knows about one address only. So the
    chain reads: primary follows the settings UI, backups follow this machine's config file.
    """

    name = "escpos"
    consumes = "payload"

    def __init__(self, ip: str = "", port: int = 9100, *, dry_run: bool = False,
                 connect_timeout_sec: float = DEFAULT_CONNECT_TIMEOUT_SEC,
                 session_timeout_sec: float = DEFAULT_SESSION_TIMEOUT_SEC) -> None:
        self.ip = ip
        self.port = port
        self.dry_run = dry_run
        self.connect_timeout_sec = connect_timeout_sec
        self.session_timeout_sec = session_timeout_sec
        # Set at construction, not per job: an address that came from the config file is a
        # deliberate choice about WHICH printer, and the backend's single address must not
        # overwrite the second one in a chain.
        self.pinned = bool(ip)

    def describe(self) -> str:
        if self.dry_run:
            return "ESC/POS (dry run — nothing is printed)"
        where = f"{self.ip or '?'}:{self.port}"
        return f"ESC/POS → {where}{' (fest)' if self.pinned else ''}"

    def resolve(self, ip: str, port: int) -> None:
        """Adopt the printer address the backend reported, unless this one is pinned."""
        if self.pinned:
            return
        self.ip, self.port = ip, port

    def print_job(self, job: Job) -> PrintResult:
        if self.dry_run:
            log(f"[dry run] would print {job.kind or 'job'} {job.id}: {sorted(job.payload)[:6]}")
            return PrintResult(True)

        if not self.ip:
            # Unreachable rather than permanent: the address arrives with the next config
            # refresh, so this is "not yet", and the next destination may well have one.
            return PrintResult(False, "no printer address — the backend has not reported one yet",
                               unreachable=True)

        try:
            from escpos.printer import Network

            from formatters import (
                format_assignment_slip,
                format_board_snapshot,
                format_qr_code_slip,
                format_test_print,
            )
        except ImportError as e:
            return PrintResult(False, (
                f"ESC/POS support is not installed ({e}). This output needs python-escpos and "
                "pillow — they are an OPTIONAL extra, so plain `uv sync` does not install "
                "them: run `uv sync --extra escpos` in tools/print-agent, or use the "
                "published image, which bakes the extra in."
            ))

        renderers = {
            "assignment": format_assignment_slip,
            "board": format_board_snapshot,
            "test": format_test_print,
            "qr_code": format_qr_code_slip,
        }
        render = renderers.get(job.kind)
        if render is None:
            return PrintResult(False, f"unknown job type: {job.kind}")

        printer = None
        try:
            # A fresh connection per job: these printers drop idle sockets, and a stale
            # handle fails in ways that look like a formatting bug.
            printer = Network(self.ip, port=self.port, timeout=self.connect_timeout_sec)
            # Connected — the printer is there, so give the actual printing room to breathe.
            with contextlib.suppress(AttributeError, OSError):
                printer.device.settimeout(self.session_timeout_sec)
            render(printer, job.payload)
            return PrintResult(True)
        except Exception as e:
            raw = str(e)
            lowered = raw.lower()
            if isinstance(e, OSError) or any(m in lowered for m in _CONNECTION_MARKERS):
                return PrintResult(False, f"Drucker nicht erreichbar unter {self.ip}:{self.port}",
                                   unreachable=True)
            return PrintResult(False, raw)
        finally:
            if printer is not None:
                try:
                    printer.close()
                except Exception:
                    pass
