"""CUPS output: hand the PDF to `lp` and wait for the queue to drain.

Ported from kp-front's agent. Stdlib only — `lp` and `lpstat` are the interface, which is why
a CUPS-only station needs no Python packages at all.

The one behaviour worth preserving deliberately: **a job still sitting in the CUPS queue is
pending, not failed.** CUPS stores and forwards, so a printer that is off, out of paper, or
briefly off the network will print the job once it recovers. Reporting failure at that moment
would tell the command post the print was lost when it is merely late. So the agent waits, and
only after a long timeout gives up — saying, in the error it reports, that the job may still
come out.
"""

from __future__ import annotations

import os
import re
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlparse

from core import Job, PrintResult, log

# A4, duplex, and monochrome unless the job carries colour. `lp_options` from the config are
# appended AFTER these: for a repeated option CUPS takes the last occurrence, so a station can
# override any default without us maintaining a matrix of printer quirks.
BASE_LP_OPTS = ["-o", "media=A4", "-o", "sides=two-sided-long-edge"]
MONO_LP_OPTS = ["-o", "print-color-mode=monochrome"]

DEFAULT_CUPS_TIMEOUT_SEC = 1800.0

# How long to give a network printer to answer a TCP connect before calling it off.
# A station LAN answers in milliseconds; anything that has not answered in two seconds is
# not busy, it is unplugged — and the whole point of asking is to find that out FAST, before
# handing CUPS a job it will hold for half an hour.
DEVICE_PROBE_TIMEOUT_SEC = 2.0

# Default ports by URI scheme, for device URIs that do not name one.
_SCHEME_PORTS = {"socket": 9100, "ipp": 631, "ipps": 631, "http": 631, "https": 443, "lpd": 515}

_REQUEST_ID = re.compile(r"request id is (\S+)")
_DEVICE_URI = re.compile(r"device for [^:]+:\s*(\S+)")


class CupsOutput:
    """Prints PDFs on a CUPS destination."""

    name = "cups"
    consumes = "document"

    def __init__(self, printer: str, *, lp_options: list[str] | None = None,
                 cups_timeout_sec: float = DEFAULT_CUPS_TIMEOUT_SEC) -> None:
        self.printer = printer
        self.lp_options = list(lp_options or [])
        self.cups_timeout_sec = cups_timeout_sec

    def describe(self) -> str:
        return f"CUPS → {self.printer}"

    def device_address(self) -> tuple[str, int] | None:
        """Host and port of this destination's printer, if it is one we can knock on.

        Read from the queue's device URI (`lpstat -v`). A USB or otherwise local printer has
        no host and returns None — there is nothing to probe, and a station that prints over
        USB must not be held up by this.
        """
        try:
            run = subprocess.run(["lpstat", "-v", self.printer], capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.SubprocessError):
            return None
        match = _DEVICE_URI.search(run.stdout or "")
        if not match:
            return None
        uri = urlparse(match.group(1))
        if not uri.hostname:
            return None
        port = uri.port or _SCHEME_PORTS.get(uri.scheme.lower())
        return (uri.hostname, port) if port else None

    def unreachable_device(self) -> str | None:
        """Whether the printer itself is off, as opposed to its queue being stopped.

        This is the case the queue state cannot answer. CUPS stops a queue only AFTER a job
        has failed on it, so a printer somebody switched off — or unplugged from the network —
        still reports `idle` and `accepting requests`. Handing it a job then means the slip
        disappears into a spooler for half an hour, which is exactly the outcome a backup
        printer exists to prevent. So we knock on the device first.

        A refusal counts as reachable: something answered, and CUPS knows the protocol here
        better than a bare socket does.
        """
        address = self.device_address()
        if address is None:
            return None
        host, port = address
        try:
            with socket.create_connection((host, port), timeout=DEVICE_PROBE_TIMEOUT_SEC):
                return None
        except (ConnectionRefusedError, ConnectionResetError):
            return None
        except OSError:
            return f"Drucker {self.printer} antwortet nicht ({host}:{port})"

    def unavailable(self) -> str | None:
        """Why this destination cannot print right now — or None if it looks fine.

        CUPS store-and-forward is a virtue for the printer it is aimed at and a trap for a
        chain: `lp` accepts a job for a stopped queue just as cheerfully as for a working
        one, so without this the first destination would swallow every job and the backup
        would never see one. Asked BEFORE handing over, so "disabled" becomes a fail-over
        instead of half an hour of waiting.

        Deliberately optimistic on anything it cannot read: an unparseable `lpstat`, a
        missing binary or a timeout must not stop a station printing. The job then takes the
        old path — handed over, and waited for.
        """
        try:
            state = subprocess.run(
                ["lpstat", "-p", self.printer], capture_output=True, text=True, timeout=15
            )
            accepting = subprocess.run(
                ["lpstat", "-a", self.printer], capture_output=True, text=True, timeout=15
            )
        except (OSError, subprocess.SubprocessError):
            return None

        if state.returncode != 0 and "unknown" in (state.stderr or "").lower():
            return f"CUPS kennt den Drucker '{self.printer}' nicht"
        text = (state.stdout or "").lower()
        if "disabled" in text:
            return f"CUPS-Warteschlange '{self.printer}' ist gestoppt"
        if "not accepting" in (accepting.stdout or "").lower():
            return f"CUPS-Warteschlange '{self.printer}' nimmt keine Aufträge an"
        # The queue looks healthy — which says nothing about the machine. Ask it directly.
        return self.unreachable_device()

    def _pending(self, request_id: str) -> bool:
        out = subprocess.run(
            ["lpstat", "-W", "not-completed", "-o", self.printer],
            capture_output=True, text=True, timeout=30,
        ).stdout
        return any(line.split()[:1] == [request_id] for line in out.splitlines() if line.strip())

    def print_job(self, job: Job) -> PrintResult:
        if job.document is None:
            return PrintResult(False, "cups output received a job with no document — check the backend's protocol")

        blocked = self.unavailable()
        if blocked:
            return PrintResult(False, blocked, unreachable=True)

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fh:
            fh.write(job.document)
            tmp = fh.name
        try:
            opts = BASE_LP_OPTS + ([] if job.color else MONO_LP_OPTS) + self.lp_options
            cmd = ["lp", "-d", self.printer, "-t", job.filename or job.id, *opts, tmp]
            run = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if run.returncode != 0:
                # `lp` refused to even queue it. Nothing was handed over, so another
                # destination may still take this job.
                return PrintResult(False, f"lp: {run.stderr.strip()[:500]}", unreachable=True)

            m = _REQUEST_ID.search(run.stdout)
            request_id = m.group(1) if m else ""
            log(f"job {job.id} → CUPS {request_id or '?'} ({len(job.document)} bytes)")

            deadline = time.monotonic() + self.cups_timeout_sec
            while request_id and self._pending(request_id):
                if time.monotonic() > deadline:
                    # NOT unreachable, however much it looks like it: CUPS is holding a copy
                    # and will print it when the printer comes back. Sending the same slip to
                    # a backup — or letting the backend requeue it — is how a station ends up
                    # with the same Einsatzzettel twice, on two printers, an hour apart.
                    return PrintResult(False, (
                        f"CUPS job {request_id} is still queued — it may still print once the "
                        "printer is available again"
                    ))
                time.sleep(5)
            return PrintResult(True)
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
