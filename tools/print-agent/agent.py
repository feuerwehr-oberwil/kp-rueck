#!/usr/bin/env python3
"""kp-print-agent — one print agent, both KP protocols.

A station running KP Front and KP Rück used to need two print agents on the same box: two
services, two secrets, two install methods, two log streams. This is one agent that speaks
both wire protocols and drives both kinds of printer. Neither backend changed; neither
protocol changed.

    protocol: kp-front  → long-poll claim, opaque PDF     → output: cups   (A4 laser)
    protocol: kp-rueck  → long-poll pending, structured JSON → output: escpos (80 mm thermal)

Pull-based, like both agents before it: only outbound HTTPS, no inbound ports, no exposure of
CUPS or the printer to anything but this machine. Each backend gets its own worker thread, so
one unreachable backend never stalls the other, and the poll doubles as the heartbeat that
shows the relay online in each app.

The core is stdlib-only so it installs on a bare Pi with no venv (`--help` explains the
systemd path); only `output: escpos` needs python-escpos and pillow, imported lazily.

CONFIGURATION — either a JSON file with a `backends` list:

    {"backends": [
      {"name": "front", "protocol": "kp-front", "url": "https://front.example.org",
       "secret": "…", "output": "cups", "printer": "HP_LaserJet"},
      {"name": "rueck", "protocol": "kp-rueck", "url": "https://rueck.example.org",
       "secret": "…", "output": "escpos"}
    ]}

passed as `--config /etc/kp-print-agent.json` or `KP_PRINT_AGENT_CONFIG`; or, for a station
running just one of the two, the environment variables the previous agents already used —
those keep working unchanged, see `_backend_from_env`.

A backend may list ordered `destinations` instead of one `output`; they are tried in turn
until one takes the job, so a dead primary means paper one room over rather than no paper:

    {"name": "rueck", "protocol": "kp-rueck", "url": "…", "secret": "…",
     "destinations": [{"output": "escpos"},
                      {"output": "escpos", "ip": "192.168.1.51"}]}

Subcommands:
  (none)     run until stopped
  once       one poll cycle per backend, then exit — for smoke-testing the wiring
  install    print the systemd unit and setup steps
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core import FatalError, PrintResult, log  # noqa: E402
from outputs.cups import DEFAULT_CUPS_TIMEOUT_SEC, CupsOutput  # noqa: E402
from outputs.escpos import EscposOutput  # noqa: E402
from protocols.front import (  # noqa: E402
    DEFAULT_CLAIM_TIMEOUT_SEC,
    DEFAULT_POLL_SEC,
    FrontProtocol,
)
from protocols.rueck import (  # noqa: E402
    DEFAULT_ACTIVE_DURATION_SEC,
    DEFAULT_LONG_POLL_SEC,
    DEFAULT_POLL_ACTIVE_SEC,
    DEFAULT_POLL_IDLE_SEC,
    RueckProtocol,
)

BACKOFF_MAX_SEC = 60.0
BACKOFF_START_SEC = 5.0


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


class Backend:
    """One backend: a protocol driver, an ordered list of destinations, and the loop joining them.

    The destinations are tried in order and the first one that takes the job wins. A command
    post does not want a queue that waits for the right printer — it wants paper, now, and
    would rather walk to the machine one room over than read a slip that arrives after the
    decision it was meant to inform.
    """

    def __init__(self, name: str, protocol, outputs) -> None:
        self.name = name
        self.protocol = protocol
        # Accept a bare output for the single-destination case that every caller used before.
        self.outputs = list(outputs) if isinstance(outputs, (list, tuple)) else [outputs]

    @property
    def output(self):
        """The primary destination. Kept as a name because that is what it is."""
        return self.outputs[0]

    def describe(self) -> str:
        chain = " → ".join(o.describe() for o in self.outputs)
        return f"{self.name}: {self.protocol.name} @ {self.protocol.url} → {chain}"

    def _print_somewhere(self, job) -> tuple[PrintResult, int, list[str]]:
        """Walk the chain until a destination takes the job.

        Returns the winning (or final) result, which destination produced it, and the
        failures collected on the way — those are what the operator needs to hear even when
        the paper did come out, because a backup that quietly covers for a dead primary is a
        station with one printer and nobody aware of it.
        """
        skipped: list[str] = []
        result = PrintResult(False, "no destination configured")
        for index, output in enumerate(self.outputs):
            # The ESC/POS printer's address lives in the KP Rück backend, so adopt whatever
            # the protocol last saw before printing. Pinned destinations ignore this.
            if hasattr(output, "resolve") and hasattr(self.protocol, "printer_ip"):
                output.resolve(self.protocol.printer_ip, self.protocol.printer_port)

            result = PrintResult.coerce(output.print_job(job))
            if result.ok:
                return result, index, skipped
            skipped.append(f"{output.describe()}: {result.error}")
            # A job the printer REFUSED (unrenderable, wrong type, missing document) fails
            # identically everywhere. Walking the chain with it would only spread the same
            # error across every printer in the station and delay the honest failure.
            if not result.unreachable:
                break
        return result, -1, skipped

    def _cycle(self) -> None:
        for job in self.protocol.poll():
            result, index, skipped = self._print_somewhere(job)

            if result.ok and index > 0:
                # Printed, but not where it was supposed to. Both halves matter: where the
                # paper is (somebody has to fetch it) and that the primary is down.
                note = f"auf Ersatzdrucker gedruckt ({self.outputs[index].describe()}) — {skipped[0]}"
                self.protocol.report(job.id, True, note=note)
                log(f"[{self.name}] job {job.id}: printed on fallback #{index} — {'; '.join(skipped)}")
            elif result.ok:
                self.protocol.report(job.id, True)
                log(f"[{self.name}] job {job.id}: printed")
            else:
                error = "; ".join(skipped) if len(skipped) > 1 else result.error
                self.protocol.report(job.id, False, error, unreachable=result.unreachable)
                log(f"[{self.name}] job {job.id}: FAILED — {error}")

    def run(self, stop: threading.Event, once: bool = False) -> None:
        log(f"[{self.name}] {self.describe()}")
        backoff = BACKOFF_START_SEC
        while not stop.is_set():
            try:
                self._cycle()
                backoff = BACKOFF_START_SEC
            except FatalError as e:
                # A wrong secret is not a bad minute; retrying cannot fix it.
                log(f"[{self.name}] FATAL: {e}")
                return
            except Exception as e:  # one bad cycle must never kill the loop
                log(f"[{self.name}] WARN: {e} — retrying in {backoff:.0f}s")
                stop.wait(backoff)
                backoff = min(backoff * 2, BACKOFF_MAX_SEC)
            if once:
                return


def _build(entry: dict) -> Backend:
    """Turn one config entry into a Backend, failing loudly on a mismatch."""
    name = entry.get("name") or entry.get("protocol") or "backend"
    proto_name = (entry.get("protocol") or "").strip()
    url = (entry.get("url") or "").strip()
    secret = (entry.get("secret") or "").strip()
    if not url:
        raise SystemExit(f"config: backend '{name}' has no url")

    def tuning(key: str, default: float) -> float:
        """A tuning knob that is passed through, not quietly ignored.

        The previous agent accepted `POLL_INTERVAL` from compose and read
        `POLL_INTERVAL_IDLE` — dead config that looked configured. Every knob a caller can
        set is threaded to the driver here, and an unparseable value is refused rather than
        silently replaced by the default.
        """
        raw = entry.get(key)
        if raw is None or raw == "":
            return default
        try:
            return float(raw)
        except (TypeError, ValueError):
            raise SystemExit(f"config: backend '{name}' has a non-numeric {key}: {raw!r}")

    if proto_name == "kp-front":
        protocol = FrontProtocol(
            url, secret,
            poll_sec=tuning("poll_sec", DEFAULT_POLL_SEC),
            claim_timeout_sec=tuning("claim_timeout_sec", DEFAULT_CLAIM_TIMEOUT_SEC),
        )
    elif proto_name == "kp-rueck":
        protocol = RueckProtocol(
            url, secret,
            poll_idle_sec=tuning("poll_idle_sec", DEFAULT_POLL_IDLE_SEC),
            poll_active_sec=tuning("poll_active_sec", DEFAULT_POLL_ACTIVE_SEC),
            active_duration_sec=tuning("active_duration_sec", DEFAULT_ACTIVE_DURATION_SEC),
            long_poll_sec=tuning("long_poll_sec", DEFAULT_LONG_POLL_SEC),
        )
    else:
        raise SystemExit(f"config: backend '{name}' has unknown protocol '{proto_name}' (kp-front | kp-rueck)")

    def build_output(spec: dict, where: str):
        """One destination. `spec` is either the backend entry itself or a `destinations` item."""
        out_name = (spec.get("output") or "").strip()
        if out_name == "cups":
            printer = (spec.get("printer") or "").strip()
            if not printer:
                raise SystemExit(f"config: {where} uses the cups output but names no printer")
            return CupsOutput(
                printer,
                lp_options=spec.get("lp_options") or [],
                cups_timeout_sec=tuning("cups_timeout_sec", DEFAULT_CUPS_TIMEOUT_SEC),
            )
        if out_name == "escpos":
            port = spec.get("port")
            return EscposOutput(
                (spec.get("ip") or "").strip(),
                int(port) if port else 9100,
                dry_run=bool(spec.get("dry_run")),
            )
        raise SystemExit(f"config: {where} has unknown output '{out_name}' (cups | escpos)")

    # `destinations` is the ordered chain; a bare `output` is the one-destination form every
    # existing config and every env-var install uses, and stays exactly as valid.
    specs = entry.get("destinations")
    if specs:
        if not isinstance(specs, list):
            raise SystemExit(f"config: backend '{name}' has a 'destinations' that is not a list")
        outputs = [build_output(s, f"backend '{name}' destination #{i + 1}") for i, s in enumerate(specs)]
    else:
        outputs = [build_output(entry, f"backend '{name}'")]

    # Catch the pairing mistake here rather than at 3am on the first real job. Every
    # destination has to consume what this protocol delivers: KP Rück sends structured JSON
    # that only the ESC/POS renderer understands, so a laser cannot stand in for the thermal
    # printer until somebody writes a payload→PDF renderer. Refusing here is the honest
    # answer; accepting it would mean a backup that fails on the night it is needed.
    for i, output in enumerate(outputs):
        if protocol.wants != output.consumes:
            position = f"destination #{i + 1} " if len(outputs) > 1 else ""
            raise SystemExit(
                f"config: backend '{name}' pairs protocol '{proto_name}' (delivers "
                f"{protocol.wants}) with {position}output '{output.name}' (needs "
                f"{output.consumes}) — kp-front goes with cups, kp-rueck with escpos"
            )
    return Backend(name, protocol, outputs)


def _backend_from_env() -> list[dict]:
    """Reconstruct a single-backend config from the variables the old agents used.

    Both previous agents are still deployed this way, so their environments must keep working
    untouched — a station that only runs one of the two systems should never have to learn
    about a config file to keep printing.
    """
    entries: list[dict] = []

    # kp-front's agent: KP_BASE_URL + KP_PRINT_AGENT_SECRET + KP_PRINTER
    if _env("KP_BASE_URL"):
        entries.append({
            "name": "kp-front",
            "protocol": "kp-front",
            "url": _env("KP_BASE_URL"),
            "secret": _env("KP_PRINT_AGENT_SECRET"),
            "output": "cups",
            "printer": _env("KP_PRINTER"),
            "lp_options": _env("KP_LP_OPTS").split(),
            "poll_sec": _env("KP_POLL_SEC"),
            "claim_timeout_sec": _env("KP_CLAIM_TIMEOUT_SEC"),
            "cups_timeout_sec": _env("KP_CUPS_TIMEOUT_SEC"),
        })

    # kp-rueck's agent: BACKEND_URL + AGENT_TOKEN (+ DRY_RUN)
    if _env("BACKEND_URL"):
        entries.append({
            "name": "kp-rueck",
            "protocol": "kp-rueck",
            "url": _env("BACKEND_URL"),
            "secret": _env("AGENT_TOKEN"),
            "output": "escpos",
            "dry_run": _env("DRY_RUN").lower() == "true",
            "poll_idle_sec": _env("POLL_INTERVAL_IDLE"),
            "poll_active_sec": _env("POLL_INTERVAL_ACTIVE"),
            "active_duration_sec": _env("ACTIVE_DURATION"),
            "long_poll_sec": _env("LONG_POLL_SEC"),
        })

    return entries


def load_backends(path: str | None) -> list[Backend]:
    if path:
        try:
            with open(path, encoding="utf-8") as fh:
                entries = json.load(fh).get("backends") or []
        except OSError as e:
            raise SystemExit(f"config: cannot read {path}: {e}")
        except json.JSONDecodeError as e:
            raise SystemExit(f"config: {path} is not valid JSON: {e}")
        if not entries:
            raise SystemExit(f"config: {path} has an empty 'backends' list")
    else:
        entries = _backend_from_env()
        if not entries:
            raise SystemExit(
                "no configuration: pass --config <file>, set KP_PRINT_AGENT_CONFIG, or set the "
                "single-backend variables (KP_BASE_URL… for KP Front, BACKEND_URL… for KP Rück). "
                "Run `agent.py install` for the full setup."
            )
    return [_build(e) for e in entries]


INSTALL = """\
# --- kp-print-agent install (Raspberry Pi / any Debian-ish box) -----------------------
#
# One agent serves BOTH KP Front and KP Rück. Configure only the backends you run.
#
# 0) Prerequisites
#    For KP Front (A4 laser via CUPS) — a working CUPS queue:
#      lpstat -p                    # list destinations
#      lp -d <PRINTER> test.pdf     # must produce paper
#    For KP Rück (80 mm thermal) — the printer reachable on the LAN; its address is
#    configured in KP Rück's settings UI, not here.
#
#    Each backend needs its shared secret set on the backend side:
#      KP Front: PRINT_AGENT_SECRET      KP Rück: PRINT_AGENT_TOKEN
#    Both are fail-closed — unset means the agent endpoints answer 403 for everyone.
#
# 1) Install the agent (a directory now, not a single file):
#      sudo mkdir -p /opt/kp-print-agent
#      sudo cp -r tools/print-agent/* /opt/kp-print-agent/
#    ESC/POS only: sudo pip3 install python-escpos pillow
#    CUPS only needs no packages at all — the core is stdlib.
#
# 2) Dedicated system user with printing rights:
#      sudo useradd -r -s /usr/sbin/nologin -G lp kpprint
#
# 3) Config (secrets are in here — root-only):
#      sudo install -m 0600 /dev/null /etc/kp-print-agent.json
#      sudo tee /etc/kp-print-agent.json >/dev/null <<'EOF'
{
  "backends": [
    {"name": "front", "protocol": "kp-front", "url": "https://front.example.org",
     "secret": "<PRINT_AGENT_SECRET>", "output": "cups", "printer": "<lpstat -p>",
     "lp_options": []},
    {"name": "rueck", "protocol": "kp-rueck", "url": "https://rueck.example.org",
     "secret": "<PRINT_AGENT_TOKEN>", "output": "escpos"}
  ]
}
EOF
#
# 4) systemd unit:
#      sudo tee /etc/systemd/system/kp-print-agent.service >/dev/null <<'EOF'
[Unit]
Description=KP print agent (KP Front + KP Rück)
After=network-online.target cups.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/kp-print-agent/agent.py --config /etc/kp-print-agent.json
Restart=always
RestartSec=10
User=kpprint
Group=lp

[Install]
WantedBy=multi-user.target
EOF
#
# 5) Enable + verify:
#      sudo systemctl daemon-reload
#      sudo systemctl enable --now kp-print-agent
#      journalctl -u kp-print-agent -f    # heartbeat; both apps now show the relay online
#
# Smoke test without systemd:
#      python3 agent.py --config /etc/kp-print-agent.json once
#
# Replacing the old agents: stop and disable kp-front-print-agent.service and/or the
# `--profile printing` container first — two agents claiming the same queue means jobs
# print once each, at random.
"""


def main() -> None:
    argv = sys.argv[1:]
    config = _env("KP_PRINT_AGENT_CONFIG") or None
    if "--config" in argv:
        i = argv.index("--config")
        if i + 1 >= len(argv):
            raise SystemExit("--config needs a path")
        config = argv[i + 1]
        del argv[i:i + 2]

    cmd = argv[0] if argv else ""
    if cmd == "install":
        print(INSTALL)
        return
    if cmd in ("-h", "--help"):
        print(__doc__)
        return
    if cmd not in ("", "once"):
        print(__doc__)
        raise SystemExit(2)

    backends = load_backends(config)
    once = cmd == "once"
    stop = threading.Event()

    log(f"kp-print-agent: {len(backends)} backend(s)")
    if len(backends) == 1:
        # No thread for the common single-backend case: one less moving part, and Ctrl-C
        # behaves the way an operator expects.
        try:
            backends[0].run(stop, once=once)
        except KeyboardInterrupt:
            log("stopping")
        return

    threads = [threading.Thread(target=b.run, args=(stop,), kwargs={"once": once}, name=b.name, daemon=True)
               for b in backends]
    for t in threads:
        t.start()
    try:
        while any(t.is_alive() for t in threads):
            time.sleep(0.5)
    except KeyboardInterrupt:
        log("stopping")
        stop.set()
        for t in threads:
            t.join(timeout=10)


if __name__ == "__main__":
    main()
