# Print-Agent-Protokoll (eigenen Druck-Agenten anbinden)

Der Backend-Druck ist eine **transportneutrale Job-Queue**: das Backend weiss
nichts über ESC/POS oder Papierbreiten — es speichert Druckaufträge als JSON
und ein Agent im lokalen Netz holt sie ab und druckt sie. Der mitgelieferte
Agent (`print-agent/`, Raspberry Pi + Epson-Thermodrucker 58/80 mm) ist **eine**
Implementierung; jede Feuerwehr kann einen eigenen Agenten schreiben
(z. B. CUPS/A4-Laserdrucker) — es braucht nur die vier Endpunkte unten.

## Ablauf

```
Agent (LAN, nur ausgehend)                Backend (Cloud)
        │  GET  /api/print/config/            │  Druckerkonfiguration + Poll-Intervall
        │  GET  /api/print/jobs/pending/      │  wartende Jobs (JSON-Payload)
        │  PATCH /api/print/jobs/{id}/claim/  │  Job übernehmen (Status → printing)
        │  …drucken…                          │
        │  PATCH /api/print/jobs/{id}/complete/ │ Erfolg/Fehler zurückmelden
```

- **Authentifizierung:** Header `X-Agent-Token` gegen die Umgebungsvariable
  `PRINT_AGENT_TOKEN` des Backends. Ohne gesetztes Token sind die
  Agenten-Endpunkte offen (nur für reine LAN-Installationen gedacht —
  in der Cloud immer setzen).
- **Polling:** adaptiv, z. B. 5 s bei Aktivität / 60 s im Leerlauf. Jeder
  Poll gilt zugleich als Heartbeat (Online-Anzeige in den Einstellungen).
- **Zuverlässigkeit:** Jobs, die > 120 s in `printing` hängen, werden vom
  Backend wieder freigegeben; fehlgeschlagene Jobs werden bis zu 3× erneut
  angeboten. Ein Agent darf also jederzeit abstürzen und neu starten.

## Job-Typen

| `job_type`   | Inhalt der `payload` (JSON) | Zweck |
|--------------|------------------------------|-------|
| `assignment` | Einsatzdaten: Titel, Typ, Priorität, Adresse, Crew, Fahrzeuge, Material, Notizen | Einsatzzettel beim Disponieren |
| `board`      | Board-Schnappschuss: alle Einsätze mit Status/Crew/Material, Fahrzeugstatus, Personalliste | Papier-Fallback («Papier führt») |
| `qr_code`    | `data` (zu codierender Inhalt), Beschriftung | QR-Zettel (z. B. Check-in-Link) |
| `test`       | statischer Testinhalt | Verbindungstest aus den Einstellungen |

Die Darstellung (Schriftbreiten, Trennlinien, Papierformat) ist **allein Sache
des Agenten** — die Payload ist reines strukturiertes JSON. Neue Agenten
rendern dieselben Payloads beliebig anders (A4, PDF, zweiter Drucker, …).

## Minimalbeispiel (Pseudo-Loop)

```python
while True:
    jobs = GET(f"{BASE}/api/print/jobs/pending/", headers={"X-Agent-Token": TOKEN})
    for job in jobs:
        PATCH(f"{BASE}/api/print/jobs/{job['id']}/claim/", headers=...)
        try:
            render_and_print(job["job_type"], job["payload"])   # eigene Logik
            PATCH(f".../{job['id']}/complete/", json={"status": "completed"}, headers=...)
        except Exception as e:
            PATCH(f".../{job['id']}/complete/", json={"status": "failed", "error": str(e)}, headers=...)
    sleep(5 if jobs else 60)
```

Referenz-Implementierung: `print-agent/agent.py` (Python-Stdlib + python-escpos,
läuft als systemd-Service, `DRY_RUN=1` simuliert ohne Hardware).
