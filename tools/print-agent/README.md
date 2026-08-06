# kp-print-agent

One print agent for **both** KP systems. A station running KP Front and KP Rück used to need
two agents on the same box — two services, two secrets, two install methods, two log streams.
This is one program that speaks both wire protocols and drives both kinds of printer.

| | KP Front | KP Rück |
| --- | --- | --- |
| `protocol:` | `kp-front` | `kp-rueck` |
| Job arrives as | an opaque PDF, composed server-side | structured JSON, rendered here |
| Polling | long-poll (~25 s hang, near-instant claim) | long-poll (~25 s hang); falls back to 10 s idle / 5 s after a job against an older backend |
| Auth header | `X-Print-Agent-Secret` | `X-Agent-Token` |
| Backend sets | `PRINT_AGENT_SECRET` | `PRINT_AGENT_TOKEN` |
| Pairs with | `output: cups` (A4 laser) | `output: escpos` (80 mm thermal) |

**Neither backend changed and neither protocol changed.** The agent lives in this repository
for a single maintainer's convenience; it is not a KP Rück component, which is why it is
published as `ghcr.io/feuerwehr-oberwil/kp-print-agent` rather than `kp-rueck-*`.

## The dependency budget

The **core is stdlib only** — HTTP, both protocol drivers, and the CUPS output. That is
deliberate: the A4 relay installs on a bare Raspberry Pi with no venv and no Docker, which is
the path stations actually use, and a `pip install` step there is a thing that breaks at 3am.

`output: escpos` is the one part that needs packages (`python-escpos`, `pillow`). They are
imported *inside* the print call, so an agent without them runs fine for CUPS backends and
reports a clear, actionable error if a thermal job ever reaches it.

```bash
uv sync --extra escpos     # only needed for the thermal printer
```

## Configuration

A JSON file with a `backends` list — `--config /etc/kp-print-agent.json`, or
`KP_PRINT_AGENT_CONFIG`:

```json
{
  "backends": [
    {"name": "front", "protocol": "kp-front", "url": "https://front.example.org",
     "secret": "…", "output": "cups", "printer": "HP_LaserJet", "lp_options": []},
    {"name": "rueck", "protocol": "kp-rueck", "url": "https://rueck.example.org",
     "secret": "…", "output": "escpos"}
  ]
}
```

Each backend gets its own worker thread, so one unreachable backend never stalls the other.

**Single-backend installs need no config file.** The environment variables both previous
agents used still work unchanged — `KP_BASE_URL` / `KP_PRINT_AGENT_SECRET` / `KP_PRINTER`
(plus `KP_LP_OPTS`, `KP_POLL_SEC`, `KP_CLAIM_TIMEOUT_SEC`, `KP_CUPS_TIMEOUT_SEC`) for KP
Front, and `BACKEND_URL` / `AGENT_TOKEN` (plus `DRY_RUN`, `POLL_INTERVAL_IDLE`,
`POLL_INTERVAL_ACTIVE`, `ACTIVE_DURATION`, `LONG_POLL_SEC`) for KP Rück. A station that runs
only one system never has to learn about the config file.

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
- **The chain cannot mix paper types.** Every destination must consume what the protocol
  delivers: KP Rück sends structured JSON that only the ESC/POS renderer understands, so a
  laser cannot stand in for the thermal printer. That is refused when the config is read, with
  the offending destination named.

Optional per-backend keys mirror those knobs: `poll_sec`, `claim_timeout_sec`,
`cups_timeout_sec`, `poll_idle_sec`, `poll_active_sec`, `active_duration_sec`,
`long_poll_sec`, `dry_run`.
A non-numeric value is refused at startup rather than silently replaced by the default.

## Running

```bash
python3 agent.py --config /etc/kp-print-agent.json   # run until stopped
python3 agent.py --config /etc/kp-print-agent.json once   # one cycle per backend, for smoke tests
python3 agent.py install                             # systemd unit + setup steps
python3 agent.py --help
```

Or the container, which ships the ESC/POS extra and `cups-client`:

```bash
docker compose --profile printing up -d
```

## Things worth knowing

- **A queued CUPS job is pending, not failed.** CUPS stores and forwards, so a printer that is
  off, out of paper or briefly off the network will print once it recovers. Reporting failure
  then would tell the command post the print was lost when it is merely late — so the agent
  waits (`cups_timeout_sec`, default 30 min) and, if it does give up, says the job may still
  come out.
- **`lp_options` are appended after the defaults** (A4, duplex, monochrome-unless-colour).
  CUPS honours the last occurrence of a repeated option, so a station can override any default
  without this project maintaining a matrix of printer quirks.
- **The thermal printer's address comes from KP Rück's settings UI**, not from this machine —
  the agent re-reads it every two minutes, so changing the printer there needs no redeploy.
  Backup destinations are the exception: they are pinned in this file (see above).
- **An unreachable printer costs the job nothing.** The agent says whether a failure was the
  printer not answering or the printer refusing the job; KP Rück only counts the second against
  the three attempts, so a printer that is rebooting no longer loses the Einsatzzettel. How
  long the job then stays worth printing is the queue's TTL, not the retry count.
- **A stopped CUPS queue fails over instead of swallowing the job.** `lp` accepts jobs for a
  disabled destination just as cheerfully as for a working one, so the agent asks `lpstat`
  first. Anything it cannot read (no `lpstat`, odd output, timeout) counts as available — a
  parsing quirk must never stop a station printing.
- **A switched-off printer is found before the job is handed over.** The queue state cannot
  tell you this: CUPS stops a queue only *after* a job has failed on it, so an unplugged
  printer still reports `idle` and `accepting requests`. The agent therefore reads the queue's
  device URI (`lpstat -v`) and knocks on the printer itself — a 2 s TCP connect. No answer
  means the next destination gets the job now, instead of it disappearing into the spooler for
  half an hour. A *refused* connection counts as reachable (something is there, and CUPS knows
  the protocol better than a bare socket), and a USB queue has no host, so it is never probed.
- **A wrong secret stops that worker** instead of retrying forever. Both backends' agent
  endpoints are fail-closed: an unset token means 403 for everyone, not an anonymous mode.
- **Don't run two agents against one queue.** When migrating, stop the old
  `kp-front-print-agent.service` and/or the old `--profile printing` container first, or jobs
  get claimed at random by whichever asks first.

## Tests

```bash
python -m pytest -q        # from this directory; needs only pytest
```

They run the real HTTP client against stub servers speaking each backend's actual contract,
and the real CUPS driver against fake `lp`/`lpstat` binaries — so everything short of paper
coming out is covered. One test blocks `escpos`/`pillow`/`httpx` from importing to prove the
core still works without them. **What tests cannot cover is the printer itself**; that is a
manual check on the station Pi.
