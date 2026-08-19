# site/ – die öffentliche Landingpage (kp-rueck.ch)

Statische Seite, kein Framework – aber seit der zweiten Sprache **generiert**:

```
site/
  index.template.html   ← Struktur und Markup (Text steht hier NICHT)
  content/config.json   ← welche Sprachen es gibt, und unter welcher URL
  content/de.json       ← der deutsche Text – die Grundlage
  content/fr.json       ← die Übersetzung, über de.json gelegt
  landing.css           ← das gemeinsame Design von KP Rück und KP Front
  fonts/                ← Sora + Spline Sans Mono (variable, gehostet, kein CDN)
  shots/                ← Screenshots aus einer echten Instanz (generiert, WebP)
  capture.mjs           ← nimmt shots/ neu auf
  build.mjs             ← baut aus Vorlage + Texten die Seiten

  index.html            ← gebaut, eingecheckt, wird ausgeliefert
  fr/index.html         ← dito
  dist/…/index.html     ← alles eingebettet, nicht eingecheckt
```

## Bauen

```bash
node site/build.mjs          # schreibt index.html, fr/index.html und dist/
node site/build.mjs --check  # schreibt nichts, meldet nur Abweichungen (das macht die CI)
```

⚠️ **`index.html` und `fr/index.html` sind Ergebnisse, keine Quellen.** Wer dort hineinschreibt,
verliert es beim nächsten Bauen. Trotzdem sind beide eingecheckt: GitHub Pages liefert `site/`
unverändert aus, die Seite im Repo **ist** die Seite im Netz. Damit das nicht auseinanderläuft,
prüft die CI (`node site/build.mjs --check`) bei jedem Push, dass die gebauten Seiten zum Stand
von Vorlage und Texten passen.

`build.mjs` ist in kp-rueck und kp-front **byte-identisch** – wie `landing.css`. Wer am
Generator etwas ändert, kopiert ihn ins andere Repo hinüber.

## Sprachen

Deutsch ist die Grundlage, jede weitere Sprache **überlagert** sie. Eine Übersetzung schreibt
nur, was sie übersetzt; alles andere fällt sichtbar auf Deutsch zurück, und `build.mjs` meldet
nach jedem Lauf, wie viele Texte das sind.

Eine dritte Sprache ist **ein Eintrag in `content/config.json` und eine Datei in `content/`** – an
der Vorlage ändert sich nichts. Umgekehrt gilt: **eine Sprache wird erst ausgeliefert, wenn sie in
`config.json` steht.** Ein halb übersetztes `it/` ist schlimmer als gar keins.

Bewusst entschieden und nicht aus Versehen so:

- **Umschalter sind zwei Textlinks**, keine Flaggen, kein Dropdown, kein Cookie. Echte Links,
  damit sie crawlbar bleiben und ein geteilter Link seine Sprache mitbringt.
- **Keine Weiterleitung nach `Accept-Language`.** Ein deutschsprachiger Feuerwehrmann, den eine
  Browsereinstellung nach `/fr/` schickt, ist schlimmer als ein Umschalter, den er sieht.
- **Die Screenshots bleiben deutsch, auf jeder Sprachfassung.** Sie kommen aus einer echten
  Instanz; nachgestellte Bilder wären eine Behauptung.
- **Über die Sprache der App steht auf der Seite nichts.** Deutsch wird nur dort erwähnt, wo
  es der Besucher sofort merkt: die **Demo** läuft auf Deutsch, und die Screenshots kommen
  aus ihr. Das ist eine Tatsache über die Demo, keine Aussage über das Produkt – und sie
  stimmt auch dann noch, wenn `frontend/messages/fr.json` gefüllt ist. Genau deshalb steht
  sie so da: sie muss nach Plan 06 nicht nachgezogen werden.
- **Eine Übersetzung, die keine französischsprachige Feuerwehr-Person gelesen hat, sagt das
  oben auf der Seite** (`notice` in `fr.json`). Diese Zeile verschwindet, wenn jemand
  gegengelesen hat – sie ist kein Dekor. Es ist dieselbe Freigabe-Person, die Plan 06 braucht.

## Screenshots aktualisieren

```bash
node site/capture.mjs                            # gegen https://demo.kp-rueck.ch
node site/capture.mjs --base http://localhost:3000
node site/capture.mjs --only board,karte         # nur einzelne Bilder
node site/build.mjs                              # danach neu bauen
```

`capture.mjs` fährt eine laufende Instanz mit Playwright an (aus `frontend/node_modules`, keine
zusätzliche Abhängigkeit), meldet sich in der Demo als Editor an, erzwingt das helle
Board-Theme, überspringt den Willkommensdialog, blendet DEMO-Banderole und Toasts aus und
schiesst jede Ansicht in 1500 × 937. Gegen eine nicht-öffentliche Instanz laufen
`KP_RUECK_USER` / `KP_RUECK_PASS`. Neue Bilder kommen als neuer Eintrag in die `shots`-Liste im
Skript **und** als Eintrag unter `shots.items` in `content/de.json` – die Dateinamen sind der
Vertrag zwischen beiden. Der Dateiname steht nur in `de.json`; die Übersetzungen erben ihn und
beschriften nur.

**Das Format ist WebP** – dieselbe Aufnahme wiegt deutlich weniger als das JPEG von früher, und
encodiert wird im Chromium, den Playwright ohnehin mitbringt (keine zweite Abhängigkeit, kein
`cwebp` auf dem Rechner). Drei Ausgaben statt einer, alle aus derselben Aufnahme:

| Datei | wofür |
| --- | --- |
| `<name>.webp` | die Kacheln und die Lightbox, je in der Breite des Shots (1500 px, die Formulare 900 px) |
| `board-992.webp` | das Hero-Bild auf Telefonen und 1x-Bildschirmen – breiter als 992 px wird es nie gezeigt (`.wrap` = 1040 px minus 2×24 px) |
| `board.jpg` | **nur** die Linkvorschau (`og:image`): WhatsApp, Facebook und Co. zeigen kein WebP |

Die kleine Fassung und das JPEG entstehen an dem einen Shot, der im Skript `hero: true` trägt.

Zwei Dinge zur Demo: jeder Besuch legt eine eigene Übungslage an, und die Demo wird täglich um
00:00 zurückgesetzt. Ein Capture-Lauf hinterlässt also eine zusätzliche Lage, die beim nächsten
Reset wieder verschwindet.

## Kontakt

Drei Wege, alle ohne eigenes Backend: zwei vorausgefüllte GitHub-Issue-Templates
(`.github/ISSUE_TEMPLATE/bug_report.md` und `feature_request.md`) und ein Formular, das an einen
externen Formulardienst postet. Ohne JavaScript bleibt das Formular ein gewöhnlicher POST.

Wer die Templates umbenennt, muss die `?template=…`-Links in `index.template.html` mitziehen.

## Design

Das Aussehen («Schweizer Plakat × Tageslicht») steckt komplett in `landing.css`, und **diese
Datei ist in kp-rueck und kp-front identisch**. Wer das Design ändert, kopiert sie ins andere
Repo hinüber – sonst laufen die beiden Schwesterseiten auseinander. Nur Vorlage und Texte
unterscheiden sich: Inhalt, Bilder und die gegenseitige Verlinkung
(`kp-rueck.ch` ⇄ `kp-front.ch`).

## Hosten

`site/` ist direkt ausrollbar (statische Dateien, keine Server-Logik). `dist/index.html` und
`dist/fr/index.html` sind dieselben Seiten als je eine einzige Datei mit eingebetteten Schriften
und Bildern – zum Weitergeben oder für einen Host, der nur eine Datei annimmt.

### README-Bilder

Shots mit `docs:` schreiben denselben Seitenzustand zusätzlich als PNG nach `docs/images/` –
das ist der Grund, warum die README-Bilder früher ein halbes Jahr älter waren als die
Landingpage. Beide Ausgaben entstehen aus einer Aufnahme, wollen aber nicht dieselbe
Auflösung: die Landingpage bindet die Bilder inline ein (1x, Seitengewicht zählt), die
README-Bilder werden auf GitHub vergrössert betrachtet.

```bash
node site/capture.mjs                    # Landingpage-WebP (1x) + README-PNGs
node site/capture.mjs --scale 2 --docs-only --only board,karte
```

`--docs-only` lässt die Bilder der Landingpage unangetastet. Aktuell liegen die README-Bilder bei 1500 px Breite.
