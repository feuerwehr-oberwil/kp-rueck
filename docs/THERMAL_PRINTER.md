# Thermal Printer Integration

**Status**: Implemented (Local Installations Only)

## Overview

Integration of Epson TM-T20II/III thermal receipt printer for:
- **Assignment Slips**: Auto-print when incident status changes to "Einsatz"
- **Manual Print**: Print button in incident context menu
- **Board Snapshots**: Manual "Thermo" button in footer

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Local Docker Stack (Command Post)                              │
│  ┌──────────┐   ┌──────────┐   ┌─────────────┐   ┌───────────┐ │
│  │ Frontend │──►│ Backend  │◄──│ Print Agent │──►│ TM-T20II  │ │
│  │ :3000    │   │ :8000    │   │ (Python)    │   │ (Network) │ │
│  └──────────┘   └────┬─────┘   └─────────────┘   └───────────┘ │
│                      │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

**Flow:**
1. User triggers print (manual or auto on status change)
2. Frontend calls `POST /api/print/assignment/{incident_id}/` or `POST /api/print/board/`
3. Backend queues print job in `print_jobs` table
4. Print agent polls `GET /api/print/jobs/pending/`
5. Agent claims job with `PATCH /api/print/jobs/{id}/claim/`
6. Agent formats and sends to printer via ESC/POS
7. Agent reports completion with `PATCH /api/print/jobs/{id}/complete/`

---

## Hardware Requirements

| Component | Details |
|-----------|---------|
| Printer | Epson TM-T20II or TM-T20III (Ethernet model) |
| Connection | Ethernet (RJ45) to local network |
| Paper | 80mm thermal receipt rolls |
| Agent Host | Command post computer (same one running Docker) |

---

## Configuration

### Settings (via Settings Page)

| Setting | Description |
|---------|-------------|
| `printer.enabled` | Master toggle for printer functionality |
| `printer.ip` | Printer IP address (e.g., "10.10.10.230") |
| `printer.port` | Printer port (default: 9100) |
| `printer.auto_anfahrt` | Auto-print when status changes to "Einsatz" |

### Environment Variables (for Print Agent)

```bash
BACKEND_URL=http://localhost:8000  # Backend API URL
POLL_INTERVAL=2                    # Seconds between polls
DRY_RUN=false                      # Set to "true" for testing without printer
LOG_LEVEL=INFO                     # Logging level
```

**Note**: Printer IP and port are fetched from the backend settings automatically.

---

## Quick Start

### 1. Configure Printer IP

1. Connect printer to network
2. Set static IP via EpsonNet Config or printer panel
3. Verify connection: `ping 10.10.10.230`

### 2. Enable in Settings

1. Go to Settings > Drucker
2. Enable "Drucker aktiviert"
3. Enter printer IP and port
4. Optionally enable "Auto-Druck bei Anfahrt"

### 3. Start Print Agent

```bash
# With Docker Compose (foreground)
just print-agent

# Or in background
just print-agent-bg

# Dry-run mode (testing without physical printer)
just print-agent-dry

# Check status
just print-agent-status

# View logs
just print-agent-logs

# Stop
just print-agent-stop
```

The agent automatically fetches printer configuration from the backend settings.

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/print/config/` | GET | No | Get printer config (for agent) |
| `/api/print/status/` | GET | Yes | Get printer status and configuration |
| `/api/print/assignment/{incident_id}/` | POST | Yes | Queue assignment slip |
| `/api/print/board/` | POST | Yes | Queue board snapshot |
| `/api/print/jobs/pending/` | GET | No | Get pending jobs (for agent) |
| `/api/print/jobs/{id}/claim/` | PATCH | No | Claim a job (for agent) |
| `/api/print/jobs/{id}/complete/` | PATCH | No | Report completion (for agent) |
| `/api/print/jobs/{id}/` | DELETE | Yes | Delete a job |

**Note**: Endpoints marked "No" auth do NOT require authentication.
They are intended for the local print agent running on the same network.

---

## Print Formats

### Assignment Slip

```
==========================================
           OMEGA 1
            (TLF)
==========================================

!!! BRANDBEKAEMPFUNG [NH]
Hauptstrasse 45, Oberwil
Wasser im Keller nach Starkregen
Tel: Hr. Mueller 079 123 45 67
------------------------------------------
BESATZUNG:
  Weber (Fahrer)
  Fischer
------------------------------------------
MATERIAL:
  Tauchpumpe TP4
  Wassersauger
------------------------------------------

            22.01.2025 14:30

[AUTO-CUT]
```

### Board Snapshot

```
==========================================
            EINSATZ
          Event Name
==========================================
Erstellt: 22.01.2025 14:30

AKTIVE EINSAETZE (3):
------------------------------------------
1. !!! Wasserschaden Keller
   [Im Einsatz] Hauptstrasse 45
   Fz: Omega 1, Omega 2
------------------------------------------
2. Sturmschaden Dach
   [Rekognoszierung] Bahnhofstr 12
------------------------------------------

FAHRZEUGE:
  [ ] Omega 1 (TLF) - Belegt
  [X] Omega 2 (MTW) - Frei
------------------------------------------

PERSONAL: 12 anwesend (von 31)

[AUTO-CUT]
```

---

## Project Structure

```
kp-rueck/
├── backend/
│   └── app/
│       ├── models.py           # PrintJob model
│       ├── schemas.py          # Print schemas
│       ├── api/print.py        # Print API endpoints
│       ├── crud/print_jobs.py  # Print job CRUD
│       └── services/settings.py # Printer settings
├── frontend/
│   ├── components/settings/printer-settings.tsx  # Settings UI
│   └── lib/api-client.ts       # Print API client methods
├── print-agent/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── agent.py                # Main polling loop
│   ├── printer.py              # ESC/POS wrapper
│   └── formatters.py           # Slip/board formatting
└── docker-compose.dev.yml      # print-agent service
```

---

## Troubleshooting

### Printer not reachable

1. Verify network connection: `ping <printer-ip>`
2. Check printer power and network cable
3. Verify IP address matches configuration

### Print jobs pending but not printing

1. Check print agent is running: `just print-agent-status`
2. Check agent logs: `just print-agent-logs`
3. Verify printer is enabled and IP is set in Settings > Drucker
4. Test with dry-run mode: `just print-agent-dry`

### Agent can't connect to backend

1. Ensure backend is running on port 8000
2. Check BACKEND_URL environment variable
3. For Docker, use `http://localhost:8000` with host network mode

---

## Resources

- [python-escpos Documentation](https://python-escpos.readthedocs.io/)
- [Epson TM-T20III Support](https://epson.com/Support/Point-of-Sale/Thermal-Printers/Epson-TM-T20III-Series/s/SPT_C31CH51001)
- [ESC/POS Command Reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/tmt20iii.html)
