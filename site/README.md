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
node site/build.mjs            # fragt GitHub nach dem neusten Release, schreibt index.html, die Sprachseiten und dist/
node site/build.mjs --offline  # dasselbe aus content/release.json, ohne GitHub zu fragen
node site/build.mjs --check    # schreibt nichts, meldet nur Abweichungen (das macht die CI – offline)
```

**Nach einem Release neu bauen und committen.** Die Footer-Zeile («Aktuelle Version v… · Datum ·
Release Notes») und `softwareVersion`, `dateModified` und `releaseNotes` der App kommen aus dem
neusten GitHub-Release, gespeichert in `content/release.json`. Ist GitHub nicht erreichbar, bleibt
der gespeicherte Stand; ohne einen fallen Zeile und Eigenschaften ganz weg – nie leer.
`WebPage.dateModified` ist pro Sprachseite der Tag ihrer letzten Änderung: ein Bauen, das nichts
ändert, behält ihn.

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

- **Language choices are text links**, without flags, cookies or redirects. Compact headers
  collect them with appearance in one menu; real links stay crawlable and keep the language in
  a shared URL.
- **Keine Weiterleitung nach `Accept-Language`.** Ein deutschsprachiger Feuerwehrmann, den eine
  Browsereinstellung nach `/fr/` schickt, ist schlimmer als ein Umschalter, den er sieht.
- **Die Screenshots bleiben deutsch, auf jeder Sprachfassung.** Sie kommen aus einer echten
  Instanz; nachgestellte Bilder wären eine Behauptung.
- **Die Sprachen der App stehen an genau zwei Stellen, getrennt von denen der Website:** in
  der FAQ «In welchen Sprachen ist KP Rück verfügbar?» und in `product.inLanguage`
  (`config.json`, → `SoftwareApplication.inLanguage`). Wer der App eine Sprache gibt, zieht
  beide nach, in allen fünf Texten. Die Website-Sprachen stehen auf `WebSite`/`WebPage`.
- **Eine Übersetzung, die keine französischsprachige Feuerwehr-Person gelesen hat, sagt das
  oben auf der Seite** (`notice` in `fr.json`). Diese Zeile verschwindet, wenn jemand
  gegengelesen hat – sie ist kein Dekor. Es ist dieselbe Freigabe-Person, die Plan 06 braucht.

## Theme assets and shared runtime

`theme.js` follows the device appearance until a visitor makes an explicit choice.
Desktop uses a header button; compact headers group language and appearance in one native
menu, closed by Escape or a tap outside. Language choices remain real links. The theme
choice is a local preference (`kp-landing-theme`), shared across language pages on the same
origin. Keep `theme.js`, `build.mjs` and `landing.css` byte-identical in both repositories.
The builder embeds the runtime in the page head, including the single-file hand-out.

Capture both real app palettes: the existing `shots/<name>.webp` is light, and
`shots/dark/<name>.webp` is its night counterpart, with matching names and dimensions.
Both heroes also have a 992px version. The link-preview JPEG and README PNGs remain light.
Do not simulate night mode by filtering a day screenshot.

```bash
node site/capture.mjs --site-only             # both themes, leave README PNGs alone
node site/capture.mjs --theme dark --site-only # night variants only
```

The offline builder preserves and embeds both picture sources; changing the theme must
never make the hand-out request an image from a server.

## Screenshots aktualisieren

```bash
node site/capture.mjs                            # gegen https://demo.kp-rueck.ch
node site/capture.mjs --base http://localhost:3000
node site/capture.mjs --only board,karte         # nur einzelne Bilder
node site/build.mjs                              # danach neu bauen
```

`capture.mjs` drives a running instance with Playwright (from `frontend/node_modules`),
signs in as a demo editor, captures both board themes, skips the welcome dialog and hides
the DEMO ribbon and toasts. Each view is captured at 1500 × 937. Gegen eine nicht-öffentliche Instanz laufen
`KP_RUECK_USER` / `KP_RUECK_PASS`. Neue Bilder kommen als neuer Eintrag in die `shots`-Liste im
Skript **und** als Eintrag unter `shots.items` in `content/de.json` – die Dateinamen sind der
Vertrag zwischen beiden. Der Dateiname steht nur in `de.json`; die Übersetzungen erben ihn und
beschriften nur.

**Das Format ist WebP** – dieselbe Aufnahme wiegt deutlich weniger als das JPEG von früher, und
encodiert wird im Chromium, den Playwright ohnehin mitbringt (keine zweite Abhängigkeit, kein
`cwebp` auf dem Rechner). Day captures produce three outputs; night captures produce both WebP sizes:

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
(`.github/ISSUE_TEMPLATE/bug_report.yml` und `feature_request.md`) und ein Formular, das an einen
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
