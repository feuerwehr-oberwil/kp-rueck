"""KP Front protocol: long-poll claim → download PDF → report status.

Ported from kp-front's `tools/print_agent.py`, which this replaces. The wire contract is
kp-front's and is unchanged — that is the point of the whole restructure: one agent that
speaks both protocols, no backend changes on either side.

    POST /api/print-agent/claim              → 200 job | 204 empty
    GET  /api/print-agent/jobs/{id}/file     → the composed PDF
    POST /api/print-agent/jobs/{id}/status   → {"status": …, "error": …}

Authenticated with `X-Print-Agent-Secret`, matching the backend's `PRINT_AGENT_SECRET`.

The claim LONG-POLLS: the backend holds the request open until a job is queued or ~25 s
pass, so a freshly queued job is claimed near-instantly and an idle agent makes roughly one
request per hang instead of one every few seconds. Against an older backend that answers 204
straight away this degrades to plain polling — see the timing check in `poll()`.
"""

from __future__ import annotations

import json
import time

from core import FatalError, Job, log, request

# The backend hangs the claim ~25 s; give the HTTP timeout comfortable headroom.
DEFAULT_CLAIM_TIMEOUT_SEC = 60.0
DEFAULT_POLL_SEC = 5.0


class FrontProtocol:
    """Speaks to a KP Front backend. Produces PDF jobs, so it pairs with the `cups` output."""

    name = "kp-front"
    wants = "document"

    def __init__(self, url: str, secret: str, *, poll_sec: float = DEFAULT_POLL_SEC,
                 claim_timeout_sec: float = DEFAULT_CLAIM_TIMEOUT_SEC) -> None:
        self.url = url.rstrip("/")
        self.secret = secret
        self.poll_sec = poll_sec
        self.claim_timeout_sec = claim_timeout_sec
        self._headers = {"X-Print-Agent-Secret": secret}

    def _request(self, path: str, **kw):
        return request(self.url + path, headers=self._headers, **kw)

    def poll(self) -> list[Job]:
        """Claim at most one job. Blocks for up to `claim_timeout_sec` while long-polling.

        Returns a list for symmetry with the KP Rück driver, which fetches a batch.
        """
        started = time.monotonic()
        status, data = self._request(
            "/api/print-agent/claim", body=b"", method="POST", timeout=self.claim_timeout_sec
        )
        if status in (401, 403):
            raise FatalError(f"backend rejected the agent secret (HTTP {status}) — check the configured secret")
        if status == 204:
            # An immediate 204 means this backend does not long-poll, so the caller has to
            # provide the idle gap itself or we would spin. A slow 204 is a completed hang.
            if time.monotonic() - started < self.poll_sec:
                time.sleep(self.poll_sec)
            return []
        if status != 200:
            raise RuntimeError(f"claim: HTTP {status}")

        job = json.loads(data)
        job_id = job["id"]
        status, pdf = self._request(f"/api/print-agent/jobs/{job_id}/file", timeout=120.0)
        if status != 200:
            # Claimed but undownloadable: report it, or the job stays claimed forever.
            self.report(job_id, False, f"PDF download: HTTP {status}")
            return []

        return [
            Job(
                id=job_id,
                backend=self.url,
                # kp-front's column is `kind` (backend/app/api/print_relay.py). `job_type` is
                # kp-RUECK's name, copy-pasted in from protocols/rueck.py — it never matched,
                # so every job silently arrived as "document" and the real kind (report /
                # zeitplan / capture_report) was lost. Harmless so far only because the CUPS
                # output that serves kp-front ignores `kind`; fixed before that stops being true.
                kind=job.get("kind") or "document",
                document=pdf,
                filename=job.get("filename"),
                color=bool(job.get("color")),
            )
        ]

    def report(self, job_id: str, ok: bool, error: str | None = None, *,
               unreachable: bool = False, note: str | None = None) -> None:
        """Report the outcome. `note` rides along on a SUCCESS — «printed, but on the backup».

        KP Front stores `error` whatever the status is (api/print_relay.py), so the note needs
        no backend change on that side. `unreachable` is accepted for a uniform call from the
        Backend loop and deliberately not sent: KP Front's relay has no retry accounting to
        inform, and inventing a field it would ignore is worse than not sending one.
        """
        code, _ = self._request(
            f"/api/print-agent/jobs/{job_id}/status",
            json_body={"status": "done" if ok else "failed", "error": note if ok else error},
        )
        if code != 200:
            log(f"WARN: status report for {job_id} → HTTP {code}")
