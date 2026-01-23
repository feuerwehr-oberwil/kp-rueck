# Thermal Printer Integration

**Status**: Future Feature (Not Implemented)

## Overview

Integration of Epson TM-T20III thermal receipt printer for:
- **Assignment Slips**: Auto-print when incident status changes to "Anfahrt"
- **Board Snapshots**: Manual "Print Board" button for overview

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
│  KP Rueck       │                      │  Print Agent    │                 │  TM-T20III  │
│  Backend        │◄───── WebSocket ─────│  (Python)       │──── Ethernet ──►│  Printer    │
│  (Railway)      │      (Internet)      │  (KP Computer)  │   (Local LAN)   │  (Static IP)│
└─────────────────┘                      └─────────────────┘                 └─────────────┘
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

1. Connect printer power supply and Ethernet cable
2. Power on printer (green light should illuminate)

### 2. Set Static IP Address

Use EpsonNet Config utility or printer web interface:
- IP Address: `192.168.1.100` (or preferred static IP)
- Subnet Mask: `255.255.255.0`
- Default Gateway: `192.168.1.1`

### 3. Verify Connection

```bash
ping 192.168.1.100
```

---

## Print Agent

A Python agent runs on the command post computer and:
- Connects to backend via WebSocket
- Receives print jobs
- Formats and sends to printer via `python-escpos`

### Dependencies

```bash
pip install python-escpos python-socketio[asyncio_client] aiohttp
```

### Configuration

```bash
BACKEND_URL=https://kp-api.fwo.li
PRINTER_IP=192.168.1.100
PRINTER_PORT=9100
```

### Auto-Start

Configure as systemd service (Linux) or Scheduled Task (Windows) for automatic startup.

---

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `print_agent_register` | Agent -> Backend | Register agent with printer info |
| `print_assignment` | Backend -> Agent | Print assignment slip |
| `print_board` | Backend -> Agent | Print board snapshot |
| `print_result` | Agent -> Backend | Report success/failure |

---

## Assignment Slip Payload

```json
{
  "vehicle_name": "Omega 1",
  "vehicle_type": "TLF",
  "incident_type": "Elementarereignis",
  "location": "Hauptstrasse 45, Oberwil",
  "description": "Wasser im Keller nach Starkregen",
  "contact": "Hr. Mueller 079 123 45 67",
  "crew": [
    {"name": "Weber", "role": "Fahrer"},
    {"name": "Fischer", "role": null}
  ],
  "materials": ["Tauchpumpe TP4", "Wassersauger"],
  "reko": {
    "dangers": ["Elektrisch"],
    "summary": "Keller 50cm unter Wasser",
    "personnel_count": 4,
    "duration_hours": 2
  }
}
```

---

## Board Snapshot Payload

```json
{
  "incidents": [
    {
      "title": "Wasserschaden Keller",
      "status": "in_arbeit",
      "location": "Hauptstrasse 45",
      "vehicles": ["Omega 1"],
      "crew": ["Weber", "Fischer"]
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

## Slip Layout

```
==========================================
           OMEGA 1
            (TLF)
==========================================

ELEMENTAREREIGNIS
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
REKO:
  ! Elektrisch
  Keller 50cm unter Wasser
  4 Pers | 2h
------------------------------------------

            22.01.2025 14:30

[AUTO-CUT]
```

---

## Resources

- [python-escpos Documentation](https://python-escpos.readthedocs.io/)
- [Epson TM-T20III Support](https://epson.com/Support/Point-of-Sale/Thermal-Printers/Epson-TM-T20III-Series/s/SPT_C31CH51001)
- [ESC/POS Command Reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/tmt20iii.html)
