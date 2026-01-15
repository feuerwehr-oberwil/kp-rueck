# Thermal Printer Integration

## Overview

Integration of Epson TM-T20III thermal receipt printer for automatic assignment slip printing and manual board snapshots.

| Feature | Trigger | Output |
|---------|---------|--------|
| Assignment Slip | Auto when incident status → "Anfahrt" | One slip per dispatched vehicle |
| Board Snapshot | Manual "Print Board" button | All active incidents + resource status |

---

## Hardware

| Component | Details |
|-----------|---------|
| Printer | Epson TM-T20III (Ethernet model) |
| Connection | Ethernet (RJ45) to local network |
| Paper | 80mm thermal receipt rolls |
| Agent Host | Command post computer (same one running browser) |

---

## Architecture

```
┌─────────────────┐                      ┌─────────────────┐                 ┌─────────────┐
│  KP Rück        │                      │  Print Agent    │                 │  TM-T20III  │
│  Backend        │◄───── WebSocket ─────│  (Python)       │──── Ethernet ──►│  Printer    │
│  (Railway)      │      (Internet)      │  (KP Computer)  │   (Local LAN)   │  (Static IP)│
└─────────────────┘                      └─────────────────┘                 └─────────────┘
        │                                        │
        │ HTTPS                                  │ Runs alongside
        ▼                                        ▼
┌─────────────────┐                      ┌─────────────────┐
│  KP Rück        │                      │  Browser Tab    │
│  Frontend       │                      │  (Same PC)      │
│  (Vercel)       │                      │                 │
└─────────────────┘                      └─────────────────┘
```

**Flow:**
1. Incident status changes to "Anfahrt" in browser
2. Frontend triggers print request to backend
3. Backend sends print job via WebSocket to connected print agent
4. Print agent formats and sends to printer over Ethernet
5. Printer outputs assignment slip and auto-cuts

---

## Printer Setup

### 1. Physical Connection

1. Connect printer power supply
2. Connect Ethernet cable from printer to local network (router/switch)
3. Power on printer (green light should illuminate)

### 2. Find Current IP Address

Print a status sheet to see current network settings:

1. Turn off printer
2. Hold Feed button while turning on
3. Release after it starts printing
4. Note the IP address (e.g., `192.168.1.xxx`)

### 3. Set Static IP Address

**Option A: Via EpsonNet Config (Recommended)**

1. Download [EpsonNet Config](https://epson.com/Support/Point-of-Sale/Thermal-Printers/Epson-TM-T20III-Series/s/SPT_C31CH51001) from Epson
2. Install and run on any computer on the same network
3. It will discover the printer automatically
4. Right-click printer → Configuration
5. Set:
   - IP Address: `192.168.1.100` (or your preferred static IP)
   - Subnet Mask: `255.255.255.0`
   - Default Gateway: `192.168.1.1` (your router)
6. Apply and restart printer

**Option B: Via Printer Web Interface**

1. Open browser and go to printer's current IP (e.g., `http://192.168.1.xxx`)
2. Navigate to TCP/IP settings
3. Change from DHCP to Static
4. Set IP address, subnet, gateway
5. Save and restart printer

### 4. Verify Connection

```bash
# Ping the printer
ping 192.168.1.100

# Should respond with replies
```

---

## Print Agent Setup

### Prerequisites

- Python 3.10 or newer
- Network access to printer (same LAN)
- Internet access to backend (Railway)

### 1. Create Agent Directory

```bash
# On the command post computer
mkdir ~/kp-print-agent
cd ~/kp-print-agent
```

### 2. Create Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install python-escpos python-socketio[asyncio_client] aiohttp
```

### 4. Create Agent Script

Create file `agent.py`:

```python
#!/usr/bin/env python3
"""
KP Rück Print Agent
Receives print jobs from backend via WebSocket, prints to thermal printer.
"""

import asyncio
import socketio
from escpos.printer import Network
from datetime import datetime
import logging
import sys
import os

# Configuration
BACKEND_URL = os.environ.get("BACKEND_URL", "https://kp-api.fwo.li")
PRINTER_IP = os.environ.get("PRINTER_IP", "192.168.1.100")
PRINTER_PORT = int(os.environ.get("PRINTER_PORT", "9100"))

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

class PrintAgent:
    def __init__(self):
        self.sio = socketio.AsyncClient(reconnection=True, reconnection_delay=5)
        self.printer = None
        self._setup_handlers()

    def _setup_handlers(self):
        self.sio.on("connect", self._on_connect)
        self.sio.on("disconnect", self._on_disconnect)
        self.sio.on("print_assignment", self._on_print_assignment)
        self.sio.on("print_board", self._on_print_board)

    def _connect_printer(self) -> bool:
        """Connect to thermal printer via network."""
        try:
            self.printer = Network(PRINTER_IP, port=PRINTER_PORT)
            logger.info(f"✓ Printer connected at {PRINTER_IP}:{PRINTER_PORT}")
            return True
        except Exception as e:
            logger.error(f"✗ Printer connection failed: {e}")
            self.printer = None
            return False

    async def _on_connect(self):
        logger.info(f"✓ Connected to backend: {BACKEND_URL}")
        # Register as print agent
        await self.sio.emit("print_agent_register", {
            "type": "thermal",
            "model": "TM-T20III",
            "printer_ip": PRINTER_IP,
            "status": "ready" if self.printer else "no_printer"
        })

    async def _on_disconnect(self):
        logger.warning("✗ Disconnected from backend, will retry...")

    async def _on_print_assignment(self, data: dict):
        """Print assignment slip for a vehicle."""
        logger.info(f"📄 Assignment slip: {data.get('vehicle_name', 'Unknown')}")

        if not self.printer:
            if not self._connect_printer():
                await self.sio.emit("print_result", {"success": False, "error": "No printer"})
                return

        try:
            self._print_assignment_slip(data)
            await self.sio.emit("print_result", {"success": True, "type": "assignment"})
            logger.info("✓ Assignment slip printed")
        except Exception as e:
            logger.error(f"✗ Print failed: {e}")
            await self.sio.emit("print_result", {"success": False, "error": str(e)})

    async def _on_print_board(self, data: dict):
        """Print board snapshot."""
        logger.info("📄 Board snapshot requested")

        if not self.printer:
            if not self._connect_printer():
                await self.sio.emit("print_result", {"success": False, "error": "No printer"})
                return

        try:
            self._print_board_snapshot(data)
            await self.sio.emit("print_result", {"success": True, "type": "board"})
            logger.info("✓ Board snapshot printed")
        except Exception as e:
            logger.error(f"✗ Print failed: {e}")
            await self.sio.emit("print_result", {"success": False, "error": str(e)})

    def _print_assignment_slip(self, data: dict):
        """Format and print assignment slip."""
        p = self.printer

        # Header - Vehicle
        p.set(align="center", bold=True, double_height=True, double_width=True)
        p.text(f"{data.get('vehicle_name', 'FAHRZEUG')}\n")
        p.set(double_height=False, double_width=False)
        if data.get('vehicle_type'):
            p.text(f"({data['vehicle_type']})\n")
        p.text("=" * 42 + "\n\n")

        # Incident info
        p.set(align="left", bold=True)
        incident_type = data.get('incident_type', 'EINSATZ').upper()
        p.text(f"{incident_type}\n")
        p.set(bold=False)

        if data.get('location'):
            p.text(f"{data['location']}\n")

        if data.get('description'):
            p.text(f"{data['description']}\n")

        if data.get('contact'):
            p.text(f"Tel: {data['contact']}\n")

        p.text("-" * 42 + "\n")

        # Crew
        crew = data.get('crew', [])
        if crew:
            p.set(bold=True)
            p.text("BESATZUNG:\n")
            p.set(bold=False)
            for member in crew:
                role = f" ({member['role']})" if member.get('role') else ""
                p.text(f"  {member['name']}{role}\n")
            p.text("-" * 42 + "\n")

        # Materials
        materials = data.get('materials', [])
        if materials:
            p.set(bold=True)
            p.text("MATERIAL:\n")
            p.set(bold=False)
            for mat in materials:
                p.text(f"  {mat}\n")
            p.text("-" * 42 + "\n")

        # Reko
        reko = data.get('reko')
        if reko:
            p.set(bold=True)
            p.text("REKO:\n")
            p.set(bold=False)

            # Dangers
            dangers = reko.get('dangers', [])
            if dangers:
                p.text(f"  ! {', '.join(dangers)}\n")

            # Summary
            if reko.get('summary'):
                # Word wrap long text
                summary = reko['summary']
                while len(summary) > 40:
                    p.text(f"  {summary[:40]}\n")
                    summary = summary[40:]
                if summary:
                    p.text(f"  {summary}\n")

            # Additional notes
            if reko.get('notes'):
                p.text(f"  {reko['notes']}\n")

            # Effort
            effort_parts = []
            if reko.get('personnel_count'):
                effort_parts.append(f"{reko['personnel_count']} Pers")
            if reko.get('duration_hours'):
                effort_parts.append(f"{reko['duration_hours']}h")
            if effort_parts:
                p.text(f"  {' | '.join(effort_parts)}\n")

            p.text("-" * 42 + "\n")

        # Footer
        p.set(align="center")
        timestamp = datetime.now().strftime("%d.%m.%Y %H:%M")
        p.text(f"\n{timestamp}\n")

        # Cut paper
        p.cut()

    def _print_board_snapshot(self, data: dict):
        """Format and print board snapshot."""
        p = self.printer

        # Header
        p.set(align="center", bold=True, double_height=True)
        p.text("EINSATZÜBERSICHT\n")
        p.set(double_height=False)
        timestamp = datetime.now().strftime("%d.%m.%Y %H:%M")
        p.text(f"{timestamp}\n")
        p.text("=" * 42 + "\n\n")

        # Incidents by status
        incidents = data.get('incidents', [])
        if incidents:
            for incident in incidents:
                p.set(align="left", bold=True)
                status = incident.get('status', '').upper()
                p.text(f"[{status}] {incident.get('title', 'Einsatz')}\n")
                p.set(bold=False)

                if incident.get('location'):
                    p.text(f"  {incident['location']}\n")

                # Assigned resources
                vehicles = incident.get('vehicles', [])
                if vehicles:
                    p.text(f"  Fzg: {', '.join(vehicles)}\n")

                crew = incident.get('crew', [])
                if crew:
                    p.text(f"  Pers: {', '.join(crew)}\n")

                p.text("\n")
        else:
            p.text("Keine aktiven Einsätze\n\n")

        p.text("-" * 42 + "\n")

        # Resource summary
        p.set(bold=True)
        p.text("RESSOURCEN:\n")
        p.set(bold=False)

        vehicles = data.get('vehicle_status', [])
        for v in vehicles:
            status_icon = "+" if v.get('available') else "-"
            p.text(f"  [{status_icon}] {v['name']}\n")

        personnel = data.get('personnel_summary', {})
        if personnel:
            p.text(f"\n  Anwesend: {personnel.get('present', 0)}/{personnel.get('total', 0)}\n")
            p.text(f"  Verfügbar: {personnel.get('available', 0)}\n")

        p.text("\n")
        p.cut()

    async def run(self):
        """Main run loop."""
        logger.info("=" * 50)
        logger.info("KP Rück Print Agent")
        logger.info("=" * 50)
        logger.info(f"Backend: {BACKEND_URL}")
        logger.info(f"Printer: {PRINTER_IP}:{PRINTER_PORT}")
        logger.info("=" * 50)

        # Initial printer connection
        self._connect_printer()

        # Connect to backend
        try:
            await self.sio.connect(
                BACKEND_URL,
                transports=["websocket"],
                namespaces=["/"]
            )
            await self.sio.wait()
        except Exception as e:
            logger.error(f"Failed to connect: {e}")
            raise

async def main():
    agent = PrintAgent()
    await agent.run()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\nShutting down...")
        sys.exit(0)
```

### 5. Create Configuration File (Optional)

Create file `.env` for easy configuration:

```bash
BACKEND_URL=https://kp-api.fwo.li
PRINTER_IP=192.168.1.100
PRINTER_PORT=9100
```

### 6. Test the Agent

```bash
# Activate virtual environment
source venv/bin/activate

# Run agent
python agent.py

# Expected output:
# ==================================================
# KP Rück Print Agent
# ==================================================
# Backend: https://kp-api.fwo.li
# Printer: 192.168.1.100:9100
# ==================================================
# ✓ Printer connected at 192.168.1.100:9100
# ✓ Connected to backend: https://kp-api.fwo.li
```

---

## Running the Agent

### Manual Start

```bash
cd ~/kp-print-agent
source venv/bin/activate
python agent.py
```

### Auto-Start on Boot (Linux/Mac)

Create a systemd service or launchd plist to start automatically.

**Linux (systemd):**

```bash
# Create service file
sudo nano /etc/systemd/system/kp-print-agent.service
```

```ini
[Unit]
Description=KP Rück Print Agent
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/kp-print-agent
Environment=BACKEND_URL=https://kp-api.fwo.li
Environment=PRINTER_IP=192.168.1.100
ExecStart=/home/YOUR_USERNAME/kp-print-agent/venv/bin/python agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl enable kp-print-agent
sudo systemctl start kp-print-agent

# Check status
sudo systemctl status kp-print-agent
```

### Auto-Start on Boot (Windows)

1. Create a batch file `start-agent.bat`:
   ```batch
   @echo off
   cd C:\Users\YOUR_USERNAME\kp-print-agent
   call venv\Scripts\activate
   python agent.py
   ```

2. Add to Startup folder or create a Scheduled Task

---

## Troubleshooting

### Printer Not Responding

```bash
# Check if printer is reachable
ping 192.168.1.100

# Check if port 9100 is open
nc -zv 192.168.1.100 9100
# or on Windows:
Test-NetConnection -ComputerName 192.168.1.100 -Port 9100
```

**Solutions:**
- Verify printer is powered on
- Check Ethernet cable connection
- Confirm IP address is correct (print status sheet)
- Ensure computer and printer are on same network/subnet

### Agent Can't Connect to Backend

**Solutions:**
- Check internet connection
- Verify BACKEND_URL is correct
- Check if backend WebSocket endpoint is available
- Look for firewall blocking outbound connections

### Print Quality Issues

**Solutions:**
- Clean print head (run cleaning from printer utility)
- Check paper roll is installed correctly (thermal side facing out)
- Replace paper roll if old/faded

### Agent Crashes

**Solutions:**
- Check Python version (needs 3.10+)
- Reinstall dependencies: `pip install --force-reinstall python-escpos`
- Check logs for specific error messages

---

## Backend Integration (Developer Reference)

The backend needs to emit WebSocket events when printing is requested.

### WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `print_agent_register` | Agent → Backend | `{type, model, printer_ip, status}` |
| `print_assignment` | Backend → Agent | See below |
| `print_board` | Backend → Agent | See below |
| `print_result` | Agent → Backend | `{success, type?, error?}` |

### Assignment Slip Payload

```json
{
  "vehicle_name": "Omega 1",
  "vehicle_type": "TLF",
  "incident_type": "Elementarereignis",
  "location": "Hauptstrasse 45, Oberwil",
  "description": "Wasser im Keller nach Starkregen",
  "contact": "Hr. Müller 079 123 45 67",
  "crew": [
    {"name": "Weber", "role": "Fahrer"},
    {"name": "Fischer", "role": null},
    {"name": "Brunner", "role": null}
  ],
  "materials": ["Tauchpumpe TP4", "Wassersauger"],
  "reko": {
    "dangers": ["Elektrisch"],
    "summary": "Keller 50cm unter Wasser, Sicherung ausgeschaltet",
    "notes": "Zugang über Garageneinfahrt",
    "personnel_count": 4,
    "duration_hours": 2
  }
}
```

### Board Snapshot Payload

```json
{
  "incidents": [
    {
      "title": "Wasserschaden Keller",
      "status": "in_arbeit",
      "location": "Hauptstrasse 45",
      "vehicles": ["Omega 1"],
      "crew": ["Weber", "Fischer", "Brunner"]
    }
  ],
  "vehicle_status": [
    {"name": "Omega 1", "available": false},
    {"name": "Omega 2", "available": true}
  ],
  "personnel_summary": {
    "total": 31,
    "present": 12,
    "available": 8
  }
}
```

---

## Appendix

### Paper Specifications

| Spec | Value |
|------|-------|
| Width | 80mm |
| Core diameter | 12mm |
| Roll diameter | Up to 83mm |
| Recommended | Epson branded thermal paper |

### Useful Commands

```bash
# Print test page (from agent directory)
python -c "
from escpos.printer import Network
p = Network('192.168.1.100')
p.text('Test print from KP Rück\n')
p.cut()
print('Done!')
"
```

### Resources

- [python-escpos Documentation](https://python-escpos.readthedocs.io/)
- [Epson TM-T20III Support](https://epson.com/Support/Point-of-Sale/Thermal-Printers/Epson-TM-T20III-Series/s/SPT_C31CH51001)
- [ESC/POS Command Reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/tmt20iii.html)
