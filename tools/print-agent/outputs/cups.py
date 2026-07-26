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
import subprocess
import tempfile
import time

from core import Job, log

# A4, duplex, and monochrome unless the job carries colour. `lp_options` from the config are
# appended AFTER these: for a repeated option CUPS takes the last occurrence, so a station can
# override any default without us maintaining a matrix of printer quirks.
BASE_LP_OPTS = ["-o", "media=A4", "-o", "sides=two-sided-long-edge"]
MONO_LP_OPTS = ["-o", "print-color-mode=monochrome"]

DEFAULT_CUPS_TIMEOUT_SEC = 1800.0

_REQUEST_ID = re.compile(r"request id is (\S+)")


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

    def _pending(self, request_id: str) -> bool:
        out = subprocess.run(
            ["lpstat", "-W", "not-completed", "-o", self.printer],
            capture_output=True, text=True, timeout=30,
        ).stdout
        return any(line.split()[:1] == [request_id] for line in out.splitlines() if line.strip())

    def print_job(self, job: Job) -> tuple[bool, str | None]:
        if job.document is None:
            return False, "cups output received a job with no document — check the backend's protocol"

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as fh:
            fh.write(job.document)
            tmp = fh.name
        try:
            opts = BASE_LP_OPTS + ([] if job.color else MONO_LP_OPTS) + self.lp_options
            cmd = ["lp", "-d", self.printer, "-t", job.filename or job.id, *opts, tmp]
            run = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if run.returncode != 0:
                return False, f"lp: {run.stderr.strip()[:500]}"

            m = _REQUEST_ID.search(run.stdout)
            request_id = m.group(1) if m else ""
            log(f"job {job.id} → CUPS {request_id or '?'} ({len(job.document)} bytes)")

            deadline = time.monotonic() + self.cups_timeout_sec
            while request_id and self._pending(request_id):
                if time.monotonic() > deadline:
                    return False, (
                        f"CUPS job {request_id} is still queued — it may still print once the "
                        "printer is available again"
                    )
                time.sleep(5)
            return True, None
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
