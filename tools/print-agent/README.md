# kp-print-agent

KP Rück's print agent: it pulls print jobs from a KP Rück backend and prints them on an 80 mm
ESC/POS thermal printer on the LAN.

| | |
| --- | --- |
| `protocol:` | `kp-rueck` |
| Job arrives as | structured JSON, rendered here |
| Polling | long-poll (~25 s hang); falls back to 10 s idle / 5 s after a job against an older backend |
| Auth header | `X-Agent-Token` |
| Backend sets | `PRINT_AGENT_TOKEN` |
| Output | `output: escpos` (80 mm thermal) |

It is published as `ghcr.io/feuerwehr-oberwil/kp-print-agent` rather than `kp-rueck-*`
because it also used to serve KP Front's A4 relay (PDF → CUPS). KP Front removed that relay,
and the agent no longer speaks its protocol: a leftover `"protocol": "kp-front"` entry in the
config file, or the old `KP_BASE_URL` variables, are skipped with a line in the log saying so,
so an update never stops the thermal printer on a box that served both.

## The dependency budget

The **core is stdlib only** — HTTP and the protocol driver. `output: escpos` is the one part
that needs packages (`python-escpos`, `pillow`, Python 3.10+). They are imported *inside* the
print call, so an agent without them still starts (a dry run needs nothing more) and reports a
clear, actionable error when a job reaches it, instead of dying on an import.

```bash
uv sync --extra escpos     # needed to put paper out
```

## Configuration

A JSON file with a `backends` list — `--config /etc/kp-print-agent.json`, or
`KP_PRINT_AGENT_CONFIG`:

```json
{
  "backends": [
    {"name": "rueck", "protocol": "kp-rueck", "url": "https://rueck.example.org",
     "secret": "…", "output": "escpos"}
  ]
}
```

Each backend gets its own worker thread, so one unreachable backend (say, a training
instance next to the live one) never stalls another.

**Single-backend installs need no config file.** The environment variables the previous agent
used still work unchanged — `BACKEND_URL` / `AGENT_TOKEN` (plus `DRY_RUN`,
`POLL_INTERVAL_IDLE`, `POLL_INTERVAL_ACTIVE`, `ACTIVE_DURATION`, `LONG_POLL_SEC`).

### Backup printers

A backend may name an ordered list of `destinations` instead of a single `output`. They are
tried in order and the first one that takes the job wins — the command post gets paper now,
one room over, instead of a queue that waits for the right printer:

```json
{"name": "rueck", "protocol": "kp-rueck", "url": "https://rueck.example.org", "secret": "…",
 "destinations": [
   {"output": "escpos"},
   {"output": "escpos", "ip": "192.168.1.51", "port": 9100}
 ]}
```

Four things to know:

- **The first ESC/POS destination follows the settings UI.** A destination with no `ip` adopts
  whatever KP Rück reports, exactly as before. One with an `ip` is *pinned* and keeps it —
  which is how a backup is named, since the backend knows about one address only.
- **Only "the printer did not answer" moves to the next destination.** A job the printer
  *refused* (unrenderable, wrong type) would fail identically everywhere, so it fails once,
  loudly, instead of being spread across every printer in the station.
- **A fall-over is reported, not hidden.** The job completes — paper did come out — and carries
  «auf Ersatzdrucker gedruckt (…)», which KP Rück shows as a warning in the operations room.
  A silent backup is a station with one printer and nobody aware of it.
- **The chain cannot mix paper types.** KP Rück sends structured JSON that only the ESC/POS
  renderer understands, so a laser cannot stand in for the thermal printer. Any output other
  than `escpos` is refused when the config is read, with the offending destination named.

Optional per-backend keys mirror those knobs: `poll_idle_sec`, `poll_active_sec`,
`active_duration_sec`, `long_poll_sec`, `dry_run`.
A non-numeric value is refused at startup rather than silently replaced by the default.

## Running

```bash
python3 agent.py --config /etc/kp-print-agent.json   # run until stopped
python3 agent.py --config /etc/kp-print-agent.json once   # one cycle per backend, for smoke tests
python3 agent.py install                             # systemd unit + setup steps
python3 agent.py --help
```

Or the container, which ships the ESC/POS extra:

```bash
docker compose --profile printing up -d
```

## Things worth knowing

- **The thermal printer's address comes from KP Rück's settings UI**, not from this machine —
  the agent re-reads it every two minutes, so changing the printer there needs no redeploy.
  Backup destinations are the exception: they are pinned in this file (see above).
- **An unreachable printer costs the job nothing.** The agent says whether a failure was the
  printer not answering or the printer refusing the job; KP Rück only counts the second against
  the three attempts, so a printer that is rebooting no longer loses the Einsatzzettel. How
  long the job then stays worth printing is the queue's TTL, not the retry count.
- **A wrong secret stops that worker** instead of retrying forever. KP Rück's agent
  endpoints are fail-closed: an unset token means 403 for everyone, not an anonymous mode.
- **Don't run two agents against one queue.** When migrating, stop the old
  `--profile printing` container (or the old service) first, or jobs get claimed at random by
  whichever asks first.

## Tests

```bash
python -m pytest -q        # from this directory; needs only pytest
```

They run the real HTTP client against stub servers speaking KP Rück's actual contract, and
the ESC/POS output in dry-run mode — so everything short of paper coming out is covered. One test blocks `escpos`/`pillow`/`httpx` from importing to prove the
core still works without them. **What tests cannot cover is the printer itself**; that is a
manual check on the station Pi.
