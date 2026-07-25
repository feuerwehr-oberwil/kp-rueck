# Anfrage-Mail an «118 swissfire.ch» – KP Front + KP Rück

Status: Entwurf v4, 2026-07-19. Ziel dieser Runde: **eine überzeugende Anfrage-Mail**,
noch kein fertiger Artikel. Platzhalter [in Klammern] vor dem Versand füllen.

---

## Die Mail

**Betreff:** Zwei quelloffene Führungswerkzeuge aus einer Milizfeuerwehr – Idee für einen Fachbeitrag?

> Guten Tag [Name/Redaktion]
>
> Ich bin seit 2019 bei der Feuerwehr Oberwil (BL), als Leutnant und Fourier für
> den rückwärtigen Führungsbetrieb mitverantwortlich – und hauptberuflich Data
> Scientist. In beiden Welten stört mich dasselbe: Passt ein Werkzeug nicht zu den
> eigenen Abläufen, passt am Ende die Organisation sich dem Werkzeug an, nicht
> umgekehrt. Für unseren Führungsdienst wollte ich das nicht. Statt teure
> Einsatzführungssoftware zu kaufen und unsere Abläufe an sie zu biegen, habe ich
> selber gebaut – bewusst schlank, entlang unserer Checklisten. Dass das neben dem
> Milizdienst machbar war, liegt auch an modernen KI-Werkzeugen.
>
> Entstanden sind zwei quelloffene Web-Anwendungen, die zusammen das ganze
> Führungsbild abdecken: **KP Front** ersetzt am Einsatzort die Lagekarte und den
> Führungstisch (Lage mit taktischen Zeichen, Atemschutzüberwachung, offline-fähig),
> **KP Rück** im rückwärtigen KP das Magnettableau (Einsatzboard, Disposition,
> Alarmeingang, Einsatzbericht). Beide stehen seit [Monat/Jahr] im Übungs- und
> Einsatzbetrieb, der Quellcode ist offen, und jede Feuerwehr kann sie ohne
> Lizenzgebühr übernehmen.
>
> Drei Punkte dürften auch andere Milizfeuerwehren interessieren:
>
> - **Eigenentwicklung statt teurer Speziallösung** – und wie moderne KI-Werkzeuge
>   das für eine Milizorganisation überhaupt erst realistisch machen.
> - **Üben am echten Werkzeug** – ein Übungsgenerator speist simulierte Lagen und
>   Alarme ein; der KP-Dienst trainiert im Ernstfall-System statt an einer Attrappe.
> - **«Papier führt»** – ein konsequentes Papier-Fallback auf Basis des kantonalen
>   Führungsformulars, falls im Ereignis das Netz wegbricht.
>
> Daraus würde ich gerne einen Fachbeitrag für «118» machen (Digitalisierung /
> «Aus den Feuerwehren»): ca. [750] Wörter, eine Infobox und [6–8] Bilder in
> Druckauflösung; zwei öffentliche Demos kann ich verlinken. Exklusiv für «118».
> Passt das grundsätzlich – und wenn ja, in welcher Länge und Form? Gerne schicke
> ich einen fertigen Entwurf oder zuerst eine Kurzfassung.
>
> Freundliche Grüsse
> Bastian Eichenberger, Leutnant und Fourier, Feuerwehr Oberwil (BL)
> [E-Mail / Telefon]

---

## Beilagen / auf Nachfrage (noch nicht ausformuliert)

### Gliederung des möglichen Beitrags

- **Lead (persönlich):** wer ich bin, der Ärger mit Tableau und Lagekarte,
  «Werkzeug an uns anpassen statt umgekehrt», KI als Ermöglicher.
- **Am Einsatzort – KP Front:** Lagekarte mit FKS-Zeichen, Atemschutz, offline,
  Rapport/Kroki.
- **Im KP – KP Rück:** Kanban-Board in Echtzeit auf allen Geräten, Disposition mit
  Konfliktwarnung, QR-Check-in, Karte.
- **Vom Alarm zum Bericht:** Meldeformular/DIVERA-Webhook → Pool → Einsatz;
  Reko-Link; GPS-Statusvorschlag; Thermodrucker; PDF-Einsatzbericht mit
  Einsatztagebuch und Reaktionszeiten.
- **«Papier führt»:** Board-Ausdruck alle 15 Min, Lageblatt angelehnt ans
  Führungsformular Elementarschaden FWI BL/BS, Ausfall-SOP.
- **Üben mit dem Ernstfall-Werkzeug:** Übungsmodus + Generator.
- **Offen für alle:** Open Source, ohne Lizenzgebühr, Demos, Kontakt.

### Infobox «In Kürze»

- Zwei quelloffene Web-Apps einer Milizfeuerwehr – decken das ganze Führungsbild ab
- **KP Front** (Einsatzort): Lagekarte mit FKS-Zeichen, Plan, Atemschutz,
  Mannschaft/Mittel, offline-fähig, Rapport + Kroki
- **KP Rück** (Kommandoposten): Kanban-Board in Echtzeit auf allen Geräten,
  Personal-/Fahrzeug-/Materialdisposition mit Konfliktwarnung, QR-Check-in, Karte
- Alarmeingang: Meldeformular + providerneutraler Webhook (DIVERA 24/7),
  Ein-Klick-Übernahme, Mannschaftsaufgebot
- Mobile Reko mit Fotos; GPS-Statusvorschlag bei Ankunft; Thermodrucker
- Papier-Fallback: Board-Ausdruck alle 15 Min + Lageblatt angelehnt ans
  Führungsformular Elementarschaden FWI BL/BS
- Übungsmodus mit Generator (simulierte Alarme/Lagen); Einsatzbericht als PDF
  (Einsatztagebuch, Reaktionszeiten)
- Open Source (AGPL), Eigenbetrieb ohne Lizenzgebühr, Hell-/Dunkelmodus, deutsch
  (französisch geplant); Demos: [URLs]

### Bildvorschläge (Druckauflösung, Legenden ergänzen)

1. KP Front: Tablet mit Lagekarte und taktischen Zeichen (Übungslage) [Screenshot]
2. KP Rück im Betrieb: Grossbildschirm mit Board, davor Bedienstation [Foto]
3. Thermodrucker mit frischem Einsatzzettel / Board-Schnappschuss [Foto]
4. Lageblatt (A4) neben dem leeren Führungsformular – «digital trifft bewährt» [Foto]
5. KP Front: Atemschutzüberwachung mit laufender Trupp-Uhr [Screenshot]

---

## Intern: vor dem Versand (nicht Teil der Mail)

- **Platzhalter füllen:** seit wann im Betrieb, Anekdote fürs Lead, Hosting-Kosten,
  GitHub- + Demo-Links, Kontakt.
- **Vor Publikation (Traffic-Spike!):** externes Monitoring (Frontend, Backend
  `/api/health`, Demo), `PRINT_AGENT_TOKEN` auf Railway + Pi, Demo/Backend unter
  Last testen – Demo auf **1 Railway-Replica** pinnen (2-h-Reset + In-Memory-Limits).
  Sammelliste: `docs/TODO.md` → «Before the 118 magazine publication».
- **KP Front vor dem Verlinken öffentlich machen:** sauberer Neuschnitt (Squash in
  ein frisches Public-Repo), **kein** Sichtbarkeits-Flip – die Historie enthält
  echte Objektpläne und alte PINs. Die Demo (fiktives «Musterdorf») ist unbedenklich.
- **Screenshots** aus klar fiktiver Übungslage; Oberwiler Schauplätze sind ok,
  tabu sind nur echte Einsätze und echte Namen von AdF (Datenschutz).
- **Ehrlich bleiben (gegen den Code geprüft):** GPS-Statuswechsel = Vorschlag
  (Vollautomatik optional); Lageblatt «angelehnt an» das Formular, nicht dessen
  amtliche Vorlage; Übungsgenerator erzeugt Einsätze/Alarme automatisch,
  Verschärfungen/Störungen von Hand; keinen lokalen Offline-Weiterbetrieb
  (Spiegel-Server) für KP Rück behaupten – KP Front ist aber echt offline-fähig.
- **Ton:** nüchtern/miliztauglich; kein Verkauf, keine Vergleiche mit kommerziellen
  Anbietern.
