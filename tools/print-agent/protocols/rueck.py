"""KP Rück protocol: fetch printer config → poll pending → claim → complete.

The wire contract is unchanged from the previous `print-agent/agent.py`; what changed is the
transport, from `httpx`/asyncio to stdlib `urllib`, so the agent's core carries no
dependencies (see `core`). Nothing about the backend moved.

    GET   /api/print/config/                  → {enabled, ip, port}
    GET   /api/print/jobs/pending/?limit=10   → [job, …]
    PATCH /api/print/jobs/{id}/claim/
    PATCH /api/print/jobs/{id}/complete/      → {"status": …, "error_message": …}

Authenticated with `X-Agent-Token`, matching the backend's `PRINT_AGENT_TOKEN`. Those
endpoints are fail-closed: with no token configured on the backend they answer 403 for
everyone, so an empty token here is a configuration error, not an anonymous mode.

Polling is adaptive — brisk for a while after a job, slow when nothing is happening — because
this backend does not long-poll. The printer's address comes from the backend rather than
local config, so it is refreshed periodically and the poll is skipped entirely while printing
is switched off in the settings UI.
"""

from __future__ import annotations

import json
import time

from core import FatalError, Job, log, request

DEFAULT_POLL_IDLE_SEC = 60.0
DEFAULT_POLL_ACTIVE_SEC = 5.0
DEFAULT_ACTIVE_DURATION_SEC = 900.0
CONFIG_REFRESH_SEC = 120.0


class RueckProtocol:
    """Speaks to a KP Rück backend. Produces structured jobs, so it pairs with `escpos`."""

    name = "kp-rueck"
    wants = "payload"

    def __init__(self, url: str, token: str, *, poll_idle_sec: float = DEFAULT_POLL_IDLE_SEC,
                 poll_active_sec: float = DEFAULT_POLL_ACTIVE_SEC,
                 active_duration_sec: float = DEFAULT_ACTIVE_DURATION_SEC) -> None:
        self.url = url.rstrip("/")
        self.token = token
        self.poll_idle_sec = poll_idle_sec
        self.poll_active_sec = poll_active_sec
        self.active_duration_sec = active_duration_sec
        self._headers = {"X-Agent-Token": token} if token else {}
        self._last_job_at = 0.0
        self._config_at = 0.0
        self.enabled = False
        self.printer_ip = ""
        self.printer_port = 9100
        self._warned_disabled = False

    def _request(self, path: str, **kw):
        return request(self.url + path, headers=self._headers, **kw)

    @property
    def _gap(self) -> float:
        recent = self._last_job_at and (time.monotonic() - self._last_job_at) < self.active_duration_sec
        return self.poll_active_sec if recent else self.poll_idle_sec

    def refresh_config(self) -> None:
        """Pull printer address and on/off state. The backend, not local config, owns these."""
        status, data = self._request("/api/print/config/")
        if status in (401, 403):
            raise FatalError(
                f"backend rejected the agent token (HTTP {status}) — the print endpoints are "
                "fail-closed, so both PRINT_AGENT_TOKEN on the backend and the token here must be set"
            )
        if status != 200:
            log(f"WARN: printer config → HTTP {status}")
            return
        cfg = json.loads(data)
        was_enabled = self.enabled
        self.enabled = bool(cfg.get("enabled", False))
        self.printer_ip = cfg.get("ip") or ""
        self.printer_port = int(cfg.get("port") or 9100)
        self._config_at = time.monotonic()
        if self.enabled != was_enabled:
            log(f"printer {'enabled' if self.enabled else 'disabled'} in settings ({self.printer_ip}:{self.printer_port})")
            self._warned_disabled = False

    def poll(self) -> list[Job]:
        """Fetch pending jobs and claim each. Sleeps the adaptive gap before returning."""
        if time.monotonic() - self._config_at >= CONFIG_REFRESH_SEC:
            self.refresh_config()

        if not self.enabled:
            if not self._warned_disabled:
                log("printing is switched off in the settings — waiting")
                self._warned_disabled = True
            time.sleep(self._gap)
            return []

        status, data = self._request("/api/print/jobs/pending/?limit=10")
        if status in (401, 403):
            raise FatalError(f"backend rejected the agent token (HTTP {status})")
        if status != 200:
            log(f"WARN: pending jobs → HTTP {status}")
            time.sleep(self._gap)
            return []

        pending = json.loads(data)
        claimed: list[Job] = []
        for entry in pending:
            job_id = str(entry.get("id"))
            code, _ = self._request(f"/api/print/jobs/{job_id}/claim/", method="PATCH", body=b"")
            if code != 200:
                # Another agent got there first, or it moved on. Not ours to print.
                log(f"could not claim {job_id} (HTTP {code}) — skipping")
                continue
            claimed.append(
                Job(
                    id=job_id,
                    backend=self.url,
                    kind=entry.get("job_type") or "",
                    payload=entry.get("payload") or {},
                )
            )

        if not claimed:
            time.sleep(self._gap)
        return claimed

    def report(self, job_id: str, ok: bool, error: str | None = None) -> None:
        if ok:
            self._last_job_at = time.monotonic()
        code, _ = self._request(
            f"/api/print/jobs/{job_id}/complete/",
            method="PATCH",
            json_body={"status": "completed" if ok else "failed", "error_message": error},
        )
        if code != 200:
            log(f"WARN: completion report for {job_id} → HTTP {code}")
