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

The agent is **pull-based**: it polls the backend every 2 seconds for pending jobs. No inbound ports, proxies, or tunnels required. The backend queues print jobs in the database, the agent fetches, prints, and reports completion.

## Print Jobs

Two job types are supported:

| Job Type | Trigger | Content |
|---|---|---|
| **Assignment Slip** | Incident moved to "Disponiert" or "Einsatz" (auto), or manual "Thermo" button | Location, incident type, priority, description, vehicles, crew, materials |
| **Board Snapshot** | Manual "Thermo" button on board view | Event overview, active incidents, vehicle status, personnel count |

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
just print-agent

# Dry-run mode (no printer needed, logs what would print)
just print-agent-dry

# Background mode
just print-agent-bg

# Check status / stop
just print-agent-status
just print-agent-stop
```

Environment variables:
- `BACKEND_URL` - Backend API URL (default: `http://localhost:8000`)
- `POLL_INTERVAL` - Seconds between polls (default: `2`)
- `DRY_RUN` - Set to `true` to simulate printing
- `LOG_LEVEL` - Logging level (default: `INFO`)

## Raspberry Pi Deployment

### 1. Flash OS

Use **Raspberry Pi OS Lite** (64-bit, Bookworm). Enable SSH and Wi-Fi during flashing with Raspberry Pi Imager.

### 2. Install uv

```bash
ssh pi@<raspberry-ip>
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.local/bin/env
```

### 3. Copy print-agent

```bash
# Option A: Clone full repo
git clone https://github.com/<org>/kp-rueck.git
cd kp-rueck/print-agent

# Option B: Copy only the print-agent directory
scp -r print-agent/ pi@<raspberry-ip>:~/print-agent/
```

### 4. Install dependencies & test

```bash
cd ~/kp-rueck/print-agent
uv sync
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
User=pi
WorkingDirectory=/home/pi/kp-rueck/print-agent
Environment=BACKEND_URL=https://kp-api.fwo.li
Environment=POLL_INTERVAL=2
ExecStart=/home/pi/.local/bin/uv run python agent.py
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
cd ~/kp-rueck
git pull
sudo systemctl restart kp-print-agent
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
