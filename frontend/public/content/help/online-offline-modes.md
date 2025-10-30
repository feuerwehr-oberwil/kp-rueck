# Online & Offline Betrieb

KP Rück kann in zwei Modi betrieben werden: **Online (Railway)** und **Offline (Localhost)**. Jeder Modus hat unterschiedliche Funktionen.

## Online-Modus (Railway / Produktion)

**Zugriff:** https://kp-rueck.railway.app (oder Ihre Railway-URL)

### Verfügbare Funktionen
QR-Code Check-In funktioniert, QR-Code Reko-Formulare funktionieren, automatische Synchronisation aller Geräte, mobile Zugriffe von überall, Echtzeit-Updates über Polling (≤5s).

### Typisches Setup
**Einsatzzentrale:**
- Admin auf PC/Laptop (Verwaltung, Übersicht)
- Einsatzleiter auf grossem Touchscreen (Drag & Drop, Status-Änderungen)

**Vor Ort:**
- Personal scannt QR-Code für Check-In mit Smartphone
- Offizier scannt Einsatz-QR, füllt Reko-Formular vor Ort aus

Alle Geräte sehen automatisch die gleichen Daten in Echtzeit.

### Setup
Keine Installation nötig. Einfach im Browser öffnen, mit Benutzername/Passwort anmelden, Ereignis auswählen und loslegen.

---

## Offline-Modus (Localhost / Docker)

**Zugriff:** http://localhost:3000 oder http://<LOKALE-IP>:3000

Funktioniert nur, wenn Geräte im gleichen Netzwerk sind!

### Verfügbare Funktionen
Vollständiges Kanban-Board, alle CRUD-Operationen, mehrere Events/Training-Modus.

QR-Codes funktionieren NICHT (kein externes Netzwerk). Nur Geräte im gleichen lokalen Netzwerk können zugreifen.

### Alternative Workflows

**Check-In ohne QR:**
Nutzen Sie die Ressourcen-Seite (`/resources`, Tab "Personal"), um Personen manuell als "Anwesend" zu markieren. Alternativ: Separates Gerät im gleichen Netzwerk öffnet `http://<LOKALE-IP>:3000/check-in`.

**Reko ohne QR:**
Reko-Team meldet Informationen per Funk, Einsatzzentrale trägt Infos in Einsatznotizen ein. Alternativ: Laptop vor Ort im gleichen Netzwerk öffnet `http://<LOKALE-IP>:3000/reko`.

### Setup (Localhost)

**Via Docker (empfohlen):**
```bash
cd /pfad/zum/projekt

# Docker starten
docker-compose -f docker-compose.dev.yml up

# Frontend läuft auf: http://localhost:3000
# Backend läuft auf: http://localhost:8000
```

**Alternativen ohne `make dev`:**
```bash
# Option 1: Docker Compose direkt
docker-compose -f docker-compose.dev.yml up

# Option 2: Manuell (Frontend + Backend separat)
cd backend && uv run uvicorn app.main:app --reload &
cd frontend && pnpm dev
```

**Zugriff im lokalen Netzwerk:**
Finden Sie Ihre lokale IP (Windows: `ipconfig`, Mac: `ifconfig`, Linux: `ip addr`), z.B. `192.168.1.10`. Andere Geräte öffnen: `http://192.168.1.10:3000`.

Firewall muss Port 3000 freigeben!

---

## Synchronisation zwischen Modi

Railway/Online kann NICHT von Localhost "pullen", da Localhost nicht von aussen erreichbar ist.

### Von Localhost → Online (Push)
Nutzen Sie die Sync-Funktion in den Einstellungen (`/settings?tab=sync`):
1. **Localhost:** Export → Events/Einsätze als JSON
2. **Railway:** Online anmelden
3. **Railway:** Import → JSON-Datei hochladen

### Von Online → Localhost (Pull)
1. **Railway:** Export → Daten als JSON
2. **Localhost:** Import → JSON-Datei in lokaler Installation
3. **Weiterarbeiten:** Offline ohne Internet-Abhängigkeit

Sync ist nur in eine Richtung zur Zeit möglich (manuell Export/Import).

---

## Wann welchen Modus?

| Situation | Empfehlung |
|-----------|-----------|
| **Übung im Feuerwehrhaus** | ✅ **Online** - Volle Funktionalität, Teams können QR nutzen |
| **Einsatz vor Ort** | ✅ **Online** - Mobile Reko-Teams, Check-In funktioniert |
| **Keine Internet-Verbindung** | ⚠️ **Offline** - Nur Einsatzzentrale, manuelle Workflows |
| **Test/Entwicklung** | ⚠️ **Offline** - Schnell, keine Cloud-Kosten |
| **Grossübung mit vielen Teilnehmern** | ✅ **Online** - QR-Check-In spart Zeit |
