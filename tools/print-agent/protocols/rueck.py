"""KP Rück protocol: fetch printer config → poll pending → claim → complete.

The wire contract is unchanged from the previous `print-agent/agent.py`; what changed is the
transport, from `httpx`/asyncio to stdlib `urllib`, so the agent's core carries no
dependencies (see `core`). Nothing about the backend moved.

    GET   /api/print/config/                          → {enabled, ip, port}
    GET   /api/print/jobs/pending/?limit=10&wait=25   → [job, …]
    PATCH /api/print/jobs/{id}/claim/
    PATCH /api/print/jobs/{id}/complete/              → {"status": …, "error_message": …}

Authenticated with `X-Agent-Token`, matching the backend's `PRINT_AGENT_TOKEN`. Those
endpoints are fail-closed: with no token configured on the backend they answer 403 for
everyone, so an empty token here is a configuration error, not an anonymous mode.

The pending call LONG-POLLS, like kp-front's claim: `wait` asks the backend to hold the
request open until a job is queued, so a slip reaches the printer in milliseconds rather
than on the next poll. That matters most for the very first print of an operation — the
Einsatzzettel at alarm time — which is exactly when the old adaptive poll was at its slowest,
since it only sped up *after* it had printed something.

Against a backend too old to know `wait`, the parameter is ignored and an empty list comes
back at once; `poll()` measures that and falls back to the adaptive gap, so an updated agent
keeps working against an un-updated station.

The printer's address comes from the backend rather than local config, so it is refreshed
periodically and the poll is skipped entirely while printing is switched off in the settings UI.
"""

from __future__ import annotations

import json
import time

from core import FatalError, Job, log, request

# The fallback gaps, used when the backend does not long-poll (and while printing is switched
# off). Idle was 60 s for as long as polling was the only mechanism; 10 s is the honest
# number now that it is a fallback — the cost is a handful of tiny queries a minute against a
# backend on the same LAN, and the benefit is that an un-updated station still prints within
# ten seconds instead of a minute.
DEFAULT_POLL_IDLE_SEC = 10.0
DEFAULT_POLL_ACTIVE_SEC = 5.0
DEFAULT_ACTIVE_DURATION_SEC = 900.0
CONFIG_REFRESH_SEC = 120.0

# How long to ask the backend to hold the pending call open. Must stay under the backend's
# own LONG_POLL_MAX_SECONDS (30) and under any proxy idle timeout in between.
DEFAULT_LONG_POLL_SEC = 25.0
# Headroom on top, so a completed hang is never mistaken for a network timeout.
LONG_POLL_TIMEOUT_MARGIN_SEC = 20.0


class RueckProtocol:
    """Speaks to a KP Rück backend. Produces structured jobs, so it pairs with `escpos`."""

    name = "kp-rueck"
    wants = "payload"

    def __init__(self, url: str, token: str, *, poll_idle_sec: float = DEFAULT_POLL_IDLE_SEC,
                 poll_active_sec: float = DEFAULT_POLL_ACTIVE_SEC,
                 active_duration_sec: float = DEFAULT_ACTIVE_DURATION_SEC,
                 long_poll_sec: float = DEFAULT_LONG_POLL_SEC) -> None:
        self.url = url.rstrip("/")
        self.token = token
        self.poll_idle_sec = poll_idle_sec
        self.poll_active_sec = poll_active_sec
        self.active_duration_sec = active_duration_sec
        self.long_poll_sec = long_poll_sec
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
        # While printing is switched off, re-read the config every cycle instead of every
        # two minutes: the cycle is only a short sleep anyway, and the alternative is that
        # someone flips the switch in the settings UI and watches nothing happen for a
        # minute and a half, with no way to tell a slow agent from a broken one.
        if not self.enabled or time.monotonic() - self._config_at >= CONFIG_REFRESH_SEC:
            self.refresh_config()

        if not self.enabled:
            if not self._warned_disabled:
                log("printing is switched off in the settings — waiting")
                self._warned_disabled = True
            time.sleep(self._gap)
            return []

        started = time.monotonic()
        status, data = self._request(
            f"/api/print/jobs/pending/?limit=10&wait={self.long_poll_sec:g}",
            timeout=self.long_poll_sec + LONG_POLL_TIMEOUT_MARGIN_SEC,
        )
        held_open = time.monotonic() - started
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
            # A hang that lasted means the backend long-polls and has already done the
            # waiting for us; sleeping again on top would only add latency. A near-instant
            # empty answer means it ignored `wait` (an older backend), so the gap is ours to
            # provide or the loop would spin.
            if held_open < self.long_poll_sec / 2:
                time.sleep(self._gap)
        return claimed

    def report(self, job_id: str, ok: bool, error: str | None = None, *,
               unreachable: bool = False, note: str | None = None) -> None:
        """Report the outcome. `note` rides along on a SUCCESS — «printed, but on the backup».

        `retryable` tells the backend this failure was the printer not answering, not the job
        being bad. The backend then leaves `retry_count` alone, so a printer that is rebooting
        costs the slip nothing: it waits in the queue for as long as its content is still
        worth printing, instead of using up three attempts in ninety seconds.
        An older backend ignores both fields, and behaves exactly as it does today.
        """
        if ok:
            self._last_job_at = time.monotonic()
        code, _ = self._request(
            f"/api/print/jobs/{job_id}/complete/",
            method="PATCH",
            json_body={
                "status": "completed" if ok else "failed",
                "error_message": note if ok else error,
                "retryable": bool(unreachable) and not ok,
            },
        )
        if code != 200:
            log(f"WARN: completion report for {job_id} → HTTP {code}")
