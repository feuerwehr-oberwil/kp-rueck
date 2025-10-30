# Check-In & Reko-Formulare

Mobile Workflows für Personal-Erfassung und Einsatz-Erkundung.

---

## Personal Check-In

Erfassen Sie, wer vor Ort anwesend ist.

### Online-Modus (Railway)

**QR-Code Workflow:**

Die Einsatzzentrale generiert einen QR-Code ("Check-In QR" Button im Kanban-Board). Eine Person scannt den Code mit dem Smartphone, die Check-In-Seite öffnet sich automatisch. Personen können als "Anwesend" markiert werden, der Status ist sofort auf allen Geräten sichtbar.

### Offline-Modus (Localhost)

QR-Codes funktionieren nur im gleichen lokalen Netzwerk. Stattdessen können Sie die Ressourcen-Seite (`/resources`, Tab "Personal") nutzen, um Personen manuell als anwesend zu markieren, oder die Anwesenheit per Funk/Telefon erfassen.

---

## Reko-Formulare

Erkundungsberichte mit Fotos und Lageinformationen.

### Online-Modus (Railway)

**QR-Code Workflow:**

Die Einsatzzentrale öffnet einen Einsatz und generiert einen Reko QR-Code. Der Offizier vor Ort scannt den Code, das Formular ist bereits mit dem Einsatz verknüpft. Er füllt Lagebeurteilung, Ressourcenbedarf, Gefahren aus und kann Fotos hochladen (max. 10 Fotos, 10 MB). GPS-Koordinaten werden automatisch erfasst. Nach dem Absenden ist der Bericht sofort in der Einsatzzentrale sichtbar.

### Offline-Modus (Localhost)

QR-Codes funktionieren nur im gleichen lokalen Netzwerk. Das Reko-Team meldet Informationen per Funk/Telefon, die Einsatzzentrale trägt sie in die Einsatznotizen ein. Fotos können separat gemacht und später manuell hochgeladen werden.

### Formular-Felder

**Pflicht:** Einsatz-Auswahl (falls nicht via QR), Ersteller (Name), Lagebeurteilung

**Optional:** Ressourcenbedarf (Personal/Fahrzeuge/Material), Gefahren (Einsturz, Chemikalien, Verkehr), Zugang (frei/eingeschränkt/gesperrt), Fotos (bis 10 Stück), GPS-Koordinaten (auto)

### Reko-Berichte anzeigen

In der Einsatzzentrale: Einsatz öffnen → Tab "Reko-Berichte" → Alle Berichte des Einsatzes sichtbar → Details ansehen, Fotos in Galerie
