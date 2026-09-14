# Print Agent

The print agent connects the KP Rueck dashboard to a printer on the local network. It runs near the printer and polls the backend for pending print jobs – as a container in the compose stack (`printing` profile, the normal case) or standalone on a small box such as a Raspberry Pi. Both are covered under [Deployment](#deployment-docker-compose) below.

> **One agent, both systems.** The agent lives at [`tools/print-agent/`](../tools/print-agent/) and speaks **both** KP Rück's protocol (structured JSON → ESC/POS thermal) and KP Front's (opaque PDF → CUPS/A4 laser). A station running both systems runs **one** service with a `backends` list, not two agents on the same box. Everything on this page describes the KP Rück half; see [`tools/print-agent/README.md`](../tools/print-agent/README.md) for the configuration file, the KP Front half, and the dependency budget.
>
> It is published under the neutral name `ghcr.io/feuerwehr-oberwil/kp-print-agent` – it is not a KP Rück component, it just lives in this repository. The old `kp-rueck-print-agent` name is still published for one release so existing compose files keep working.

> **The backend print queue is transport-neutral.** Jobs are stored as structured JSON – the backend knows nothing about ESC/POS, paper widths, or any printer brand. The bundled agent is the *reference* implementation for an 80 mm ESC/POS thermal printer, but any department can point their own agent at the same four endpoints and render the jobs however they like (a CUPS/A4 laser printer, a PDF spooler, a second printer). See [Writing your own agent](#writing-your-own-agent) below. This mirrors the alarm connectors ([docs/ALARM-INTEGRATIONS.md](ALARM-INTEGRATIONS.md)): the core stays vendor-neutral, the device-specific part lives at the edge.

## Architecture

```
┌──────────────┐     HTTPS polling       ┌──────────────────┐
│  Print Agent │ ◄──────────────────────► │  Backend         │
│  (Raspi/Mac) │  /api/print/jobs/...    │  (Railway/local) │
└──────┬───────┘                          └──────────────────┘
       │ ESC/POS TCP:9100
       ▼
┌──────────────┐
│  Thermal     │
│  Printer     │
└──────────────┘
```

The agent is **pull-based**. No inbound ports, proxies, or tunnels required. The backend queues print jobs in the database, the agent fetches, prints, and reports completion.

### Long Polling

The agent asks the backend to hold the pending-jobs request open (`?wait=25`) instead of asking again and again. The backend answers the moment a job is queued, so **a slip reaches the printer within milliseconds** and an idle agent makes about two requests a minute.

That matters most for the very first print of an operation – the Einsatzzettel at alarm time – which used to be the *slowest* case: the old agent only sped up after it had already printed something.

`wait` is optional and defaults to 0, so an agent that predates it sees the endpoint behave exactly as before.

### Fallback pacing

Against a backend too old to long-poll (it answers empty immediately, which the agent measures), and while printing is switched off in the settings, the agent paces itself with two intervals:

| Mode | Interval | Condition |
|---|---|---|
| **Idle** | 10s | Default – no recent print activity |
| **Active** | 5s | After a job is printed, stays active for 15 minutes |

## Print Jobs

Each job carries a `job_type` and a structured JSON `payload`. The agent decides how to render each type; nothing about the format is fixed by the backend.

| `job_type` | Trigger | Content |
|---|---|---|
| `assignment` | Incident moved to "Disponiert" or "Einsatz" (auto), or manual "Thermo" button | Location, incident type, priority, description, vehicles, crew, materials |
| `board` | "Thermo" button → confirmation sheet with options | Event overview, incidents (with crew/materials/description), vehicle status, individual personnel list |
| `qr_code` | QR slip action | Encoded content + label (e.g. a check-in link) |
| `test` | Settings → connection test | Static test content |

Auto-printing triggers when:
- Printer is enabled in settings (`printer.enabled = true`)
- Auto-print is enabled (`printer.auto_anfahrt = true`)
- An incident status changes to `enroute` or `active`

A 30-second deduplication window prevents duplicate prints for the same incident.

## Printer Hardware

- **Type**: 80mm ESC/POS thermal receipt printer (Epson TM-T20III or compatible)
- **Connection**: TCP port 9100 (network printer)
- **Codepage**: WPC1252 (ESC t 16) for German umlauts (ä, ö, ü, ß)
- **Font A**: ~22 characters/line (used for titles, list items, separators)
- **Font B**: ~32 characters/line (used for descriptions only)

## API Endpoints (Agent)

These four endpoints are the entire contract between the backend and any agent:

| Endpoint | Method | Description |
|---|---|---|
| `/api/print/config/` | GET | Fetch printer IP/port/enabled from backend settings |
| `/api/print/jobs/pending/` | GET | Fetch pending print jobs (JSON payloads) |
| `/api/print/jobs/{id}/claim/` | PATCH | Claim a job (status → printing) |
| `/api/print/jobs/{id}/complete/` | PATCH | Report job completion or failure |

**Authentication:** the agent endpoints authenticate with the `X-Agent-Token` header, matched against the backend's `PRINT_AGENT_TOKEN` environment variable. They are **fail-closed**: with the variable unset the four endpoints answer `403` for everyone, so a deployment that never configures printing has no print surface at all. Setting the token is the opt-in – on a LAN install too, not just a cloud-hosted one.

**Reliability:** every poll doubles as a heartbeat (the backend shows the agent online for ~30 s after the last one). Jobs stuck in `printing` for over 120 s are re-offered, and failed jobs are retried up to 3 times – so an agent may crash and restart at any time without losing jobs.

## Writing your own agent

Because the queue is just JSON, a custom agent is a small poll loop against the four endpoints above – no dependency on the reference code:

```python
while True:
    # `wait` is optional: leave it off for a plain poll, or set it (max 30) to have the
    # backend hold the request open until a job is queued. Give your HTTP client a timeout
    # comfortably above it, and don't sleep after a call that really did hang.
    jobs = GET("/api/print/jobs/pending/?wait=25", headers={"X-Agent-Token": TOKEN})
    for job in jobs:
        PATCH(f"/api/print/jobs/{job['id']}/claim/", headers=...)
        try:
            render_and_print(job["job_type"], job["payload"])   # your device logic
            PATCH(f"/api/print/jobs/{job['id']}/complete/", json={"status": "completed"}, headers=...)
        except Exception as e:
            PATCH(f"/api/print/jobs/{job['id']}/complete/", json={"status": "failed", "error": str(e)}, headers=...)
    if not jobs and the_call_returned_immediately:
        sleep(10)
```

Render each `job_type` however your hardware needs – the reference agent (`tools/print-agent/`) uses python-escpos for an 80 mm thermal printer; a CUPS-based agent would hand the same payload to `lp` for an A4 laser printer instead.

## Local Development

```bash
# Start print agent (requires backend running)
just printer

# Dry-run mode (no printer needed, logs what would print)
just printer dry

# Background mode
just printer bg

# Check status / stop / logs
just printer status
just printer stop
just printer logs
```

Environment variables:
- `BACKEND_URL` - Backend API URL (default: `http://localhost:8000`)
- `LONG_POLL_SEC` - Seconds the backend is asked to hold the pending call open (default: `25`, backend max `30`)
- `POLL_INTERVAL_IDLE` - Fallback seconds between polls when idle (default: `10`)
- `POLL_INTERVAL_ACTIVE` - Fallback seconds between polls after recent job (default: `5`)
- `ACTIVE_DURATION` - Seconds to stay in active mode after last job (default: `900` = 15 min)
- `DRY_RUN` - Set to `true` to simulate printing
- `LOG_LEVEL` - Logging level (default: `INFO`)
- `PRINT_TZ` - Timezone for times printed on slips (default: `Europe/Zurich`). The backend
  serialises UTC; the slip converts, because a crew reads it against the clock on the wall.
  It used not to, so every slip showed an alarm time one to two hours early. If the host
  has no tz database the agent falls back to UTC and labels it as such rather than
  refusing to print.
- `PRINT_TZ_LABEL` - What that timezone is called on paper (default: `Ortszeit`)

## Deployment: Docker Compose

**On a compose deployment there is nothing to install.** `docker-compose.yml` already carries
the agent as the `print-agent` service, on the same published image as everything else
(`ghcr.io/feuerwehr-oberwil/kp-print-agent`, pinned by the one `KP_RUECK_TAG`). No `scp`, no
venv, no systemd unit – all of that is the Raspberry Pi recipe below, which is the *alternative*
for a printer the Docker host cannot reach.

It is behind the `printing` compose profile and runs with `network_mode: host`, because it has
to open a TCP connection to a printer on the station LAN. A deployment with no printer should
not be handed a host-network container it never uses, which is what the profile is for.

Three lines in `.env`:

```bash
COMPOSE_PROFILES=backup,printing               # add to the list – do NOT replace it, see below
PRINT_AGENT_TOKEN=…                            # openssl rand -hex 24
PRINT_AGENT_BACKEND_URL=https://kp.example.ch  # the same URL as CORS_ORIGINS
```

then bring the stack up the normal way:

```bash
just up          # = docker compose up -d, then waits for the backend
```

The token is one value with two names, and both ends must see it: the backend reads
`PRINT_AGENT_TOKEN`, the agent reads `AGENT_TOKEN`, and compose feeds the one `.env` value to
both. There is nothing to keep in sync by hand.

### Do not run `docker compose --profile printing up -d`

It looks like the obvious command, it is probably in somebody's shell history, and **it silently
deletes your nightly backup sidecar.**

Compose treats `COMPOSE_PROFILES` as the *default value* of `--profile`, so passing the flag
**replaces** the variable rather than adding to it. Measured, not guessed:

| `.env` | command | services that come up |
| --- | --- | --- |
| `COMPOSE_PROFILES=backup` | `docker compose up -d` | always-on + **backup** |
| `COMPOSE_PROFILES=backup` | `docker compose --profile printing up -d` | always-on + print-agent, **backup gone** |
| `COMPOSE_PROFILES=backup,printing` | `docker compose up -d` | always-on + backup + print-agent |

`.env.example` ships `COMPOSE_PROFILES=backup`, so the flag version turns printing on by
switching backups *off*. And that is the one failure with no signal: `docker compose ps` reports
a sidecar `unhealthy` when a backup fails, but a container that was never created cannot report
anything at all. You find out on the evening you need the dump.

So the profile list lives in `.env`, where it applies to every compose command in this directory
– including the plain `docker compose up -d` in the update path and the `docker compose down` in
`just down`, neither of which would carry a command-line flag anyway. Older docs here taught the
flag; if you have been using it, put `printing` in `COMPOSE_PROFILES` and check
`docker compose ps backup` prints a row.

### `PRINT_AGENT_BACKEND_URL`: the trap is the hostname

The agent is on the host network, so it cannot reach the stack by Docker service name –
`http://backend:8000` resolves to nothing. That much is expected. The part that costs an evening
is the *next* guess: `http://localhost:8080` reaches Caddy fine, but arrives with
`Host: localhost`, and Caddy on a deployment with a `DOMAIN` has exactly one site block, keyed on
that domain. No site matches, so Caddy answers **404** – to a URL that works perfectly in your
browser.

Set it to the deployment's own URL, character for character the same value as `CORS_ORIGINS`.
The `http://localhost:8080` default in `.env.example` is correct only for a LAN install: empty
`DOMAIN`, `HTTP_PORT` still 8080, Caddy's site address `:80` matching any hostname.

### Confirm it

```bash
docker compose ps print-agent      # a row, "Up". NO row = the printing profile isn't active
docker compose logs print-agent
```

What the log tells you:

| Line | Meaning |
| --- | --- |
| `[kp-rueck] FATAL: backend rejected the agent token (HTTP 403)` | The two ends disagree, or the backend has no `PRINT_AGENT_TOKEN` at all. A wrong secret is not a bad minute, so the agent gives up rather than hammering the endpoint – and compose's restart policy then starts it again, so the tell is the same FATAL line repeating and `docker compose ps` showing it `Restarting`. |
| `WARN: printer config → HTTP 404` | Not the token. `PRINT_AGENT_BACKEND_URL` is reaching Caddy under a hostname it does not serve – read the section above. |
| `printing is switched off in the settings – waiting` | The agent is healthy and connected. Switch the printer on and give it its IP in **Einstellungen**; the backend owns those, not the container. |

The printer's address is a *setting*, not an environment variable, so a printer that moves is
fixed in the UI and needs no restart of anything.

## Raspberry Pi Deployment

Use this when the Docker host cannot reach the printer – a printer on a different network
segment, or a station where the board runs on Railway and only the command post is near the
printer. If the printer is reachable from the Docker host, the compose service above is less to
own and updates with the rest of the stack.

### Example Setup

- **Host**: Raspberry Pi (Raspbian Bullseye, armv7l)
- **Python**: 3.12 via uv
- **Agent location**: `~/print-agent/` (files copied via scp, not git clone)
- **Service**: `kp-print-agent.service` (systemd, enabled, auto-restart)
- **Backend**: Your Railway or local backend URL
- **Printer**: Network thermal printer on TCP port 9100

### 1. Flash OS

Use **Raspberry Pi OS Lite** (64-bit). Enable SSH and Wi-Fi during flashing with Raspberry Pi Imager.

### 2. Install uv and Pillow build dependencies

```bash
ssh <user>@<raspberry-ip>

# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.local/bin/env

# Install Pillow build deps (required by python-escpos)
sudo apt install -y libjpeg-dev zlib1g-dev libfreetype6-dev \
  liblcms2-dev libopenjp2-7-dev libtiff5-dev libwebp-dev
```

### 3. Copy print-agent files

```bash
# From your dev machine – copy only the agent files
ssh <user>@<raspberry-ip> "mkdir -p ~/print-agent"
scp -r tools/print-agent/ <user>@<raspberry-ip>:~/print-agent/
```

### 4. Install dependencies & test

```bash
cd ~/print-agent
uv python install 3.12   # if system Python is too old
uv sync --python 3.12 --extra escpos   # the ESC/POS output is the only part needing packages
BACKEND_URL=https://your-backend.example.com AGENT_TOKEN=<PRINT_AGENT_TOKEN> DRY_RUN=true uv run python agent.py once
```

### 5. Create systemd service

```bash
sudo tee /etc/systemd/system/kp-print-agent.service << 'EOF'
[Unit]
Description=KP Rueck Print Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/print-agent
Environment=BACKEND_URL=https://your-backend.example.com
Environment=PATH=/home/<user>/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/<user>/.local/bin/uv run python agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable kp-print-agent   # auto-start on boot
sudo systemctl start kp-print-agent    # start now
```

### 6. Manage

```bash
sudo systemctl status kp-print-agent    # check status
sudo journalctl -u kp-print-agent -f    # tail logs
sudo systemctl restart kp-print-agent   # restart after updates
```

### Network Requirements

The Raspberry Pi needs:
- **Internet access** to reach the backend (e.g. `https://your-backend.example.com`)
- **LAN access** to reach the printer (e.g. `PRINTER_IP:9100`)

Both are outbound connections only. No port forwarding or firewall changes needed.

### Updating

```bash
# From your dev machine
scp -r tools/print-agent/ <user>@<raspberry-ip>:~/print-agent/
ssh <user>@<raspberry-ip> "sudo systemctl restart kp-print-agent"
```

## Files

```
print-agent/
├── agent.py          # Main polling loop, job processing
├── formatters.py     # ESC/POS formatting (assignment slip, board snapshot)
├── printer.py        # Printer connection wrapper
└── pyproject.toml    # Dependencies (python-escpos, httpx, pillow)

backend/app/
├── api/print.py      # Print API endpoints
├── crud/print_jobs.py # Print job CRUD with deduplication
└── models.py         # PrintJob model
```

## Printer Settings (Dashboard)

Configure in the Settings page of the dashboard:

| Setting | Key | Default | Description |
|---|---|---|---|
| Printer enabled | `printer.enabled` | `false` | Master on/off switch |
| Printer IP | `printer.ip` | `` | Printer network address |
| Printer port | `printer.port` | `9100` | ESC/POS port |
| Auto-print | `printer.auto_anfahrt` | `true` | Auto-print on status change |

### Board Snapshot Options

When clicking the "Thermo" button, a confirmation sheet opens with toggleable options:

| Option | Default | Description |
|---|---|---|
| Abgeschlossene Einsätze | Off | Include completed incidents |
| Fahrzeug-Status | On | Include vehicle availability section |
| Personal-Übersicht | On | Include individual personnel list with assignment status |

### Remote Configuration (Railway)

Settings can also be configured via API using a master token (set `MASTER_TOKEN` env var on Railway):

```bash
TOKEN="<your-master-token>"
curl -X PATCH https://your-backend.example.com/api/settings/printer.enabled \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "true"}'
```
