# Thermal Print Agent

The print agent connects the KP Rueck dashboard to a 58mm ESC/POS thermal printer. It runs locally (e.g. on a Raspberry Pi) and polls the backend for pending print jobs.

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

The agent is **pull-based** with **adaptive polling**. No inbound ports, proxies, or tunnels required. The backend queues print jobs in the database, the agent fetches, prints, and reports completion.

### Adaptive Polling

To minimize unnecessary requests (emergencies are rare), the agent uses two poll intervals:

| Mode | Interval | Condition |
|---|---|---|
| **Idle** | 60s | Default — no recent print activity |
| **Active** | 5s | After a job is printed, stays active for 15 minutes |

This means ~60 requests/hour when idle (instead of ~1800 at a fixed 2s interval), while still responding quickly during active operations. The agent automatically switches back to idle after 15 minutes without a print job.

## Print Jobs

Two job types are supported:

| Job Type | Trigger | Content |
|---|---|---|
| **Assignment Slip** | Incident moved to "Disponiert" or "Einsatz" (auto), or manual "Thermo" button | Location, incident type, priority, description, vehicles, crew, materials |
| **Board Snapshot** | "Thermo" button → confirmation sheet with options | Event overview, incidents (with crew/materials/description), vehicle status, individual personnel list |

Auto-printing triggers when:
- Printer is enabled in settings (`printer.enabled = true`)
- Auto-print is enabled (`printer.auto_anfahrt = true`)
- An incident status changes to `disponiert` or `einsatz`

A 30-second deduplication window prevents duplicate prints for the same incident.

## Printer Hardware

- **Type**: 58mm ESC/POS thermal receipt printer
- **Connection**: TCP port 9100 (network printer)
- **Codepage**: WPC1252 (ESC t 16) for German umlauts (ä, ö, ü, ß)
- **Font A**: ~22 characters/line (used for titles, list items, separators)
- **Font B**: ~32 characters/line (used for descriptions only)

## API Endpoints (No Auth Required)

These endpoints are used by the print agent and don't require authentication:

| Endpoint | Method | Description |
|---|---|---|
| `/api/print/config/` | GET | Fetch printer IP/port/enabled from backend settings |
| `/api/print/jobs/pending/` | GET | Fetch pending print jobs |
| `/api/print/jobs/{id}/claim/` | PATCH | Claim a job (status → printing) |
| `/api/print/jobs/{id}/complete/` | PATCH | Report job completion or failure |

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
- `POLL_INTERVAL_IDLE` - Seconds between polls when idle (default: `60`)
- `POLL_INTERVAL_ACTIVE` - Seconds between polls after recent job (default: `5`)
- `ACTIVE_DURATION` - Seconds to stay in active mode after last job (default: `900` = 15 min)
- `DRY_RUN` - Set to `true` to simulate printing
- `LOG_LEVEL` - Logging level (default: `INFO`)

## Raspberry Pi Deployment

### Current Setup

- **Host**: `beichenberger@10.10.10.210` (Raspbian Bullseye, armv7l)
- **Python**: 3.12 via uv (system has 3.9)
- **Agent location**: `~/print-agent/` (files copied via scp, not git clone)
- **Service**: `kp-print-agent.service` (systemd, enabled, auto-restart)
- **Backend**: `https://kp-api.fwo.li` (Railway)
- **Printer**: `10.10.10.230:9100` (Epson thermal, 58mm paper)

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
# From your dev machine — copy only the agent files
ssh <user>@<raspberry-ip> "mkdir -p ~/print-agent"
scp print-agent/*.py print-agent/pyproject.toml <user>@<raspberry-ip>:~/print-agent/
```

### 4. Install dependencies & test

```bash
cd ~/print-agent
uv python install 3.12   # if system Python is too old
uv sync --python 3.12
BACKEND_URL=https://kp-api.fwo.li DRY_RUN=true uv run python agent.py
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
Environment=BACKEND_URL=https://kp-api.fwo.li
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
- **Internet access** to reach the backend (e.g. `https://kp-api.fwo.li`)
- **LAN access** to reach the printer (e.g. `10.10.10.230:9100`)

Both are outbound connections only. No port forwarding or firewall changes needed.

### Updating

```bash
# From your dev machine
scp print-agent/*.py print-agent/pyproject.toml <user>@<raspberry-ip>:~/print-agent/
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
curl -X PATCH https://kp-api.fwo.li/api/settings/printer.enabled \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "true"}'
```
