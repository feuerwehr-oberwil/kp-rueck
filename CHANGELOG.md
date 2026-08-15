# Changelog

All notable changes to KP Rück are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**What the version number means for a deployment** – KP Rück is a self-hosted app, not a
library, so the number answers one question: *how much attention does this update need?*

| Bump | What it means for you |
| --- | --- |
| **MAJOR** | Operator action required – a breaking config change, a migration that can't be rolled back, a new mandatory env var, a Postgres major. Read the notes before updating. |
| **MINOR** | New features. Migrations run automatically on boot; `docker compose pull && docker compose up -d` is enough. |
| **PATCH** | Fixes only. Always safe to take. |

All four images (backend, frontend, tileserver, print-agent) are released **together** under one
version – a station runs the set, not a mix. Prod and the demo deploy continuously from `main`,
so every published image has already been carrying live operations at Feuerwehr Oberwil before
it was tagged.

**Why still 0.x?** Because exactly one fire station runs this in production, and a 1.0 claims
more than that. It becomes **1.0 when a second station is running it in the field** – not when
the feature list feels complete. Until then, read 0.x as *"not yet proven anywhere but
Oberwil"*, **not** as *"we may break things without warning"*: the table above holds today and
will keep holding.

`0.1.0` is the initial published release; the running history before it is in the git log.

## [Unreleased]

### Security

- **⚠️ A Viewer-Link now shows what the Reko found, photos included.** Until now the share
  board said only *that* a Reko had happened; it now carries the Reko summary – relevant
  yes/no, the dangers, the effort estimate, the Kurzbericht – and the photos of the damage,
  which are the useful half of a Reko. That is a real widening of what the token exposes, and
  it is deliberate: a link handed to the Gemeinde or to a Nachbarwehr is worth little if the
  one thing it will not show is what the officer actually saw.
  **Decide with that in mind who gets the link.** It is still the same 24-hour, event-scoped
  token, still read-only, and it has always shown addresses, crews and the Meldung.

  Withheld from a link whose only gate is the token, and staying withheld: **`other_notes`**,
  free text that regularly names residents; the **submitter's identity**; and the photos of a
  **draft** Reko – an unsent report is not part of the shared situation. Photos of a
  Schadenplatz-Rapport live in the same directory on disk and are **not** reachable with a
  viewer token either: `GET /api/photos/{incident}/{file}` serves a file to a token only when
  the incident belongs to that token's event **and** a submitted Reko report lists the
  filename. Anything else answers `404`, never `403`, so a forwarded link cannot be used to
  probe which photos exist in a neighbouring Ereignis. Every token-door access is written to
  the audit log with `via: viewer_token` and no user – "nobody was signed in, somebody held
  the link" is the provenance.

- **A Viewer-Link no longer carries the caller's name and phone number.** `/api/viewer/data` is
  gated by nothing but a token in a URL, and a URL gets forwarded, screenshotted and taped to a
  wall – yet it was serving whole incident rows, `contact`, `contact_phone` and `internal_notes`
  included. The person who reported a flooded cellar is not part of the situation; the address
  is. The shared payload is now an **allowlist** on both sides of the wire, built from what the
  display actually draws, so a column added to the incident table can no longer reach a shared
  link on its own – which is the property that matters in a year, not the two fields removed
  today. Operator ids, workflow flags and the Divera user id go with them. Vehicles and
  materials stay whole on purpose: a radio call sign is painted on the truck.
  Also still withheld after that pass: the pickup note (unbounded operator free text) and
  whether the KP has filed its Rapport – that is the office's state, not the situation's.
  **What the wall display kept:** which crew member leads, and that a crew is waiting to be
  picked up (a boolean and a timestamp, naming nobody). Both were collateral in the narrowing
  and are back, because a shared board that cannot show "this squad is standing at the kerb" is
  missing a fact about the incident.

- **A `/feld` link can now be bound to one person.** Every person-scoped `/feld` endpoint
  enforces the binding, and a token whose binding is unreadable is rejected outright rather than
  quietly widened to the whole event. Nothing mints a bound link yet, so every printed poster
  and Einsatzzettel keeps working exactly as before.
  ⚠️ **This does not make `/feld` an identity.** An unbound link – which is what both the wall
  poster and the printed Einsatzzettel carry – is a credential for the **whole Ereignis**:
  `/feld` hands any holder the full crew picker, so whoever has the link can read, and write as,
  any crew in that event. That is the price of one shared QR, it is now written down where the
  code says it rather than promised otherwise, and closing it needs a decision (personal links,
  or a PIN). Practical consequence unchanged: collect the printed slips at the end of an
  Ereignis – see [`docs/SETUP.md`](docs/SETUP.md) §7 and the token table in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Added

- **The landing page speaks French, and it is generated rather than written twice.**
  `site/index.html` used to be the page; it is now the *output* of `site/index.template.html`
  plus one text file per language (`site/content/de.json`, `fr.json`). German is the base and
  every other language is laid over it, so a translation writes only what it translates, a gap
  falls back to German *visibly*, and `build.mjs` prints the coverage after every run. A third
  language is one entry in `content/config.json` and one file in `content/`; the template does
  not change. The switcher is two plain text links (no flags, no dropdown, no cookie, and
  deliberately **no `Accept-Language` redirect**), with `hreflang` alternates both ways and a
  per-language `canonical`.
  This is **one** piece of work across both repos, not two: `site/build.mjs` and `site/landing.css`
  are byte-identical with kp-front, and duplicating either would drift on every design change.
  ⚠️ **The built pages are committed**, because GitHub Pages serves `site/` verbatim: the page in
  the repo *is* the page on the web. `node site/build.mjs --check` runs in `frontend-build` so a
  stale build fails loudly instead of silently serving yesterday's text.
  The page deliberately says nothing about the app's own language: German is named only where a
  visitor meets it anyway – the **demo** runs in German and the screenshots come from it. That
  is a fact about the demo, not a claim about the product, so it stayed true when the app's
  French catalogue landed later in this same release (see *"Die App spricht Französisch"* below).
  It does carry a visible line saying no French-speaking firefighter has read the translation
  yet – that line comes off when somebody has, and it is the same reviewer the interface
  translation needs.
  French terminology follows the **CSSP** (the FKS's French name) rather than French-from-France
  usage: *signes conventionnels* not *signes tactiques*, *équipe* not *binôme*, *surveillance PR*
  not *surveillance ARI*, *assistance technique* not *secours techniques*.

- **Schadenplatz-Rapport — the paper `fahrzeugrapport.pdf` becomes a form on the phone.** A crew
  opens `/feld`, taps its Schadenplatz and fills the slip: damage type, start/end of work, the
  Kurzbericht, "übergeben an", the owner block and the Kostenpflicht counts. The draft survives
  locally with a 30-second autosave, so a closed tab or a dead spot costs nothing. Filing it
  freezes who and which vehicles were there — a later board edit cannot change a rapport that has
  been handed in.

- **A material checklist instead of a material hunt.** Every unit the board has on that
  Schadenplatz is one row with two ticks: *gebraucht* and *vor Ort verblieben*. Consumables have
  only the first — what was used up is not left anywhere. What came back is then offered in the
  incident detail as **"Material zurück – freigeben"**: one list, one click. Until now somebody
  worked out by hand which of fourteen units were still out.

- **The KP can do everything the field can.** The rapport in the incident detail is a full
  editing surface, not a read-only view: an editor creates a rapport for an incident that never
  had any field contact, fills it and files it — the normal case is a radio message. Both doors
  write the same columns, and every rapport says where it came from ("Feld" vs. "Funkmeldung");
  a KP entry leaves the personnel attribution empty rather than guessing it.

- **A rapport marker on the card.** A card with a filed rapport carries a quiet chip; one that
  reached `complete` without a rapport carries a muted "kein Rapport" marker. Not a dialog and
  not a block — during a storm, a blocking gate is a gate people defeat with empty forms.

- **Fotos vom Schadenplatz, von beiden Seiten.** The crew photographs the cellar from `/feld`;
  the operator attaches the picture that arrived by WhatsApp from the incident detail. Same
  storage as the Reko form, and deliberately not the same door — a Reko form token does not open
  the field upload, and a field token does not open the Reko one.

- **The Einsatzzettel carries a second QR.** It opens `/feld` with that Schadenplatz already
  selected, using the Ereignis token the poster already carries. The slip can only preselect the
  Schadenplatz, never the person — it is printed before it is known who drives. A printed slip is
  therefore a working credential until the token expires: collect them at the end of an Ereignis
  ([`docs/SETUP.md`](docs/SETUP.md) §7).

- **Die Restliste auf der Ereignisseite.** Three counts, each clickable through to the incidents
  behind it: *"4 von 23 Schadenplätzen ohne Rapport"*, *"3 Geräte noch vor Ort"*, *"2 Trupps
  warten auf Abholung"*. This is where somebody at 02:00 finds the gaps, because nobody clicks
  twenty-three cards individually.

- **Die Abholliste auf Papier.** The material half of the Restliste prints on the thermal
  printer: address · Gerät · seit wann, one line each — the sheet somebody takes along the next
  morning. Material left on site is a different day's job and stays separate from the
  Trupp-Abholung.

- **Der Rapport steht jetzt auch auf dem Papier, das nachher gebraucht wird.** The
  Einsatzbericht (PDF) gains a "Schadenplatz-Rapport" block per Einsatz, and the Lageblatt gains
  Schadensart, Tätigkeit, "übergeben an", "Material vor Ort" und eine offene Abholung — the sheet
  the KP prints when the screens die now carries what the field reported. A count the crew
  corrected prints **with the board's own number next to it** ("8 (vom Board: 6)"), because the
  divergence is the information: it says the board was behind reality.

- **Ein Kostenpflicht-Export für die Verrechnung.** One wide row per Schadenplatz —
  Einsatz-Nr., Adresse, Schadensart, Beginn/Ende/Dauer, Personal und Fahrzeuge (mit
  `korrigiert`-Vermerk), Eigentümer- und KFZ-Block, Material, Kurzbericht und wer den Rapport
  erfasst hat. Reachable from the export menu on the Ereignisseite. It deliberately matches no
  external format: the numbers are retyped by hand, so the sheet is built to be *read while
  retyping*. Schadenplätze **ohne** Rapport get a row too — blank, with their address, because a
  missing rapport has to be visible and nothing forces one to exist.

  Every output keeps the three answers a crew can give about a unit apart: *gebraucht*, *nicht
  gebraucht* and *keine Angabe*. "Niemand hat geantwortet" is a real answer and never becomes a
  quiet "nein". Verbrauchsmaterial has no "vor Ort verblieben" state at all — what was used up is
  not left anywhere and nobody drives out for it.

- **Der Rapport lässt sich üben.** Die Übungssteuerung bekommt drei Injects: *Rapport
  eingetroffen* für einen Schadenplatz, *Rapporte eintreffen lassen* für 80 % aller
  abgeschlossenen Schadenplätze auf einmal, und *Meldung vom Feld* über die konfigurierbaren
  Meldungs-Chips. Die fehlenden 20 % sind Absicht: sie sind die Restliste, und sie zu finden ist
  die Übung. Die Rapporte sind bewusst lückenhaft — Material teilweise unbeantwortet, der
  Eigentümerblock oft leer, ein KFZ-Block nur dort, wo wirklich ein Fahrzeug beteiligt war —,
  und alle Quoten stehen in **einer** benannten Tabelle, damit "das ist zu sauber" eine Zeile
  Änderung ist.

- **"Einsatz beendet" fragt in der Übung dasselbe wie im Feld.** *Kommt der Trupp selbst
  zurück?* — vorbelegt aus der Lage (zu Fuss oder kein Fahrzeug = meist gestrandet), vom
  Übungsleiter jederzeit überstimmbar. Und die Meldung geht neu über denselben Endpunkt, den der
  KP am Board benutzt: eine Übung löst damit endlich auch die Glocke und den Journal-Eintrag aus,
  statt still eine Spalte zu setzen.

- **Die Demo zeigt den Rapport, ohne dass jemand `/feld` öffnet.** Der abgeschlossene Einsatz im
  Demo-Sandkasten hat einen erfassten Rapport mit Materialhaken — eine Pumpe blieb vor Ort und
  steht damit auf der Abholliste, der Wassersauger kam zurück und wartet in "Material zurück –
  freigeben". Muster-Namen im Eigentümerblock.

- **What `/feld` stores about third parties is written down** in
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §8. The owner block is the first citizen PII in
  KP Rück: it lives with the incident and is deleted with it, the `/feld` QR is an event-scoped
  credential that reaches it, and posters and Einsatzzettel belong in the "collect at the end of
  the Ereignis" habit.

- **Ein «Rapporte»-Rückstand in der Fusszeile.** A pill next to the other footer sheets counts
  the completed Schadenplätze that still have no filed Schadenplatz-Rapport, and opens a list
  split into **Offen** (oldest first, because the oldest is the one nobody will remember) and
  **Erfasst** (newest first). A row jumps straight to its incident. The same gap is already on
  the Ereignisseite; this is it where the work happens, on the board, without changing pages.

- **«{n} Geräte vor Ort» am Kopf der Material-Leiste.** Material a crew left standing somewhere
  is otherwise invisible on the board – it is neither free nor obviously in use. The roll-up
  names each unit, the address it is standing at and since when, oldest first, and clicking one
  opens that incident. Only shown when there is something to show.

- **The board keeps the layout you gave it.** Folded sidebars, the side panel and a dismissed
  setup checklist survive a reload, per device. Closing a sidebar you never use was, until now,
  a thing you did again after every refresh.

- **Die App spricht Französisch – Français steht jetzt in der Sprachauswahl.** `fr.json` covered
  2604 of German's 2661 keys, and the picker's gate is *complete* coverage, not *some*: 96 %
  translated showed up as no French at all. The 69 missing keys are translated, 12 dead ones
  dropped and three corrected where the German had drifted since; both catalogues now stand at
  2669 leaves. Terminology follows what the file already established – Schadenplatz = *place
  sinistrée*, Reko = *reconnaissance*, Auftrag = *mission*. The in-app help page has a French
  version too.
  Language is chosen **per device** (Einstellungen → Sprache, stored in the `NEXT_LOCALE`
  cookie), so two workstations on one Ereignis can disagree. Two honest limits: **everything the
  backend writes stays German** – PDFs, Excel exports, thermal print and API error details – and
  **no French-speaking firefighter has read the translation yet**. Italian is registered but
  empty and therefore stays out of the picker.
  ⚠️ For contributors: a German key added without its French counterpart drops French out of the
  picker entirely. The two catalogues have to stay leaf-for-leaf equal.

- **Der Speicherplatz-Alarm löst jetzt wirklich aus.** «Datenbank (GB)» and «Foto-Limit (GB)»
  were editable limits in the settings whose check behind them always returned nothing – an operator
  configured a safeguard that did not exist, on a station box where the app, Postgres and the
  photos share one disk. The two are now measured, and deliberately **never summed**: compose
  puts the database and the photos on different volumes, so one combined number would mean
  nothing. A value that cannot be measured stays silent rather than reading as "plenty of room".
  Measured at most every 5 minutes, because the notification endpoint is polled by every open
  board; with both limits off, nothing is measured at all. The warning is a warning, not a
  critical alert – a full disk must not put a dialog over the board during an Einsatz.
  **Setting a limit to 0 (or clearing the field) switches it off.** Until now the input rejected
  anything below 1 GB, so a limit could be set but never unset.

- **Die Bereitschaftscheckliste verlangt neu auch den Feld-Link.** Sie führte drei
  anmeldefreie Links auf – Check-In, Reko und Alarm – und liess ausgerechnet den weg, den eine
  Mannschaft aus dem Magazin mitnimmt. Der `/feld`-Link ist derjenige, hinter dem der
  Schadenplatz-Rapport ausgefüllt wird; er hat den Papier-Fahrzeugrapport abgelöst. Ein Trupp,
  der ohne ihn losfährt, kann gar nichts melden ausser über Funk – und niemand merkt es, bis
  er vor Ort steht. Die Zeile verhält sich wie die drei anderen: **QR drucken**, solange ein
  Thermodrucker erreichbar ist, sonst **Link kopieren**.
  ⚠️ Zur Erinnerung, weil dieser Zettel jetzt öfter gedruckt wird: ein ungebundener
  `/feld`-Link ist ein Zugang zum **ganzen Ereignis**, keine Identität – wer ihn hat, kann als
  jeder Trupp darin lesen und schreiben. Die gedruckten Zettel gehören am Ende eines
  Ereignisses eingesammelt ([`docs/SETUP.md`](docs/SETUP.md) §7).

- **Standing lines from the Leitstelle can be dropped before they reach the board.** Divera
  appends the brigade's turnout order to every alarm («Ausrückeordnung: 1. TLF → 2. PIO»); it is
  identical on every incident, so it is noise on the board and in every printout, and it crowds
  out the «Details:» line that says what actually happened. Two settings now handle that: one
  drops whole lines by prefix, the other strips a **label** and keeps the line – needed since our
  own UI already writes «Meldung» as a heading, so «Meldung: Wasser dringt …» read as the word
  twice. Order is fixed and pinned by tests: whole lines go first, labels are stripped from what
  survives. Reversed, a «Meldung: -» – what the Alarmzentrale sends when there is no text –
  would become a bare «-» instead of disappearing.
  **Both lists ship empty**: «Ausrückeordnung» is one brigade's German fire-service vocabulary,
  and a station that has never heard the word must not find a rule quietly dropping lines from
  its alarms. A station enters what its own dispatcher sends, one prefix per line, and the next
  standing line Divera grows costs a settings edit rather than a release. Applied at all three
  ingest paths (webhook, poller, generic `/api/alarms`).
  The raw emergency text and payload are kept byte-for-byte – that is the record of what the
  Leitstelle actually sent, and it is what priority inference still reads, so filtering what an
  operator sees cannot quietly change how an alarm is classified. Incidents already on the board
  are left exactly as they are.

- **Eine falsche Adresse auf kp-rueck.ch landet jetzt irgendwo.** Bisher antwortete ein
  Tippfehler mit GitHubs eigener schwarz-weisser Seite: «file not found», und sonst nichts zu
  tun. `site/404.html` sagt neu, was los ist, und bietet Startseite, Demo und GitHub an.
  Zwei Dinge bestimmen die Form. GitHub Pages liefert **eine** Datei für **jede** unbekannte
  Adresse, in jeder Tiefe – deshalb sind alle Pfade darauf absolut: ein relatives
  `landing.css` lädt auf `/tippfehler` und fehlt auf `/fr/vieux-lien`, die Fehlerseite wäre
  also genau dort kaputt, wo jemand schon auf etwas Kaputtes gestossen ist. Und dieselbe Datei
  muss zweisprachig antworten, also stecken beide Sprachen darin: Deutsch sichtbar,
  Französisch versteckt, und ein Skript zeigt die, die das erste Pfadsegment nennt. Ohne
  JavaScript bleibt Deutsch stehen – die Basissprache der Seite, ein Ausfall kostet also eine
  Übersetzung und nicht die Seite.
  Sie wird **gebaut wie jede andere Seite**, aus `site/404.template.html` plus `notFound` in
  `content/<sprache>.json`: `build.mjs` kennt neu ein zweites Template, `--check` bewacht das
  Ergebnis mit, und eine weitere Sprache kostet hier gar nichts – sie fällt aus derselben
  Textdatei mit heraus. Anders als die Landingpage kann diese Seite aber **nicht** pro Sprache
  in einen Ordner gelegt werden, weil GitHub Pages für jede Adresse dieselbe Datei ausliefert;
  sie trägt darum alle Sprachen und wählt erst beim Anzeigen.
  Der Baustein stammt aus kp-front und ist dort zuerst gelandet – `build.mjs` ist in beiden
  Repos Byte für Byte dasselbe File und bleibt es damit auch.

- **Die Landingpage spricht auch Italienisch und Englisch.** `it` und `en` stehen neu neben
  Deutsch und Französisch, alle vier zu 197/197 Texten – die Sprachauswahl zeigt eine Sprache
  erst, wenn sie vollständig ist. Damit steht kp-rueck.ch dort, wo kp-front.ch schon war.
  Die Fachbegriffe sind von der Schwesterseite übernommen, statt zweimal erfunden zu werden:
  «Milizfeuerwehr» heisst auch hier *militia fire brigade* und *pompieri di milizia*.
  ⚠️ Die italienische Seite trägt denselben sichtbaren Hinweis wie die französische: **noch
  nicht von einer italienischsprachigen Feuerwehrperson gegengelesen**. Der Hinweis kommt weg,
  sobald das jemand getan hat. Die englische Seite trägt ihn bewusst nicht.
  Die Screenshots bleiben auf allen Sprachen deutsch – die öffentliche Demo ist es, und sie
  stammen von dort; nachgestellte Bilder wären eine Behauptung statt ein Beleg. Auch das steht
  auf der Seite, statt es zu verschweigen.

### Changed

- **Der Einsatzbericht sieht aus wie der Einsatzrapport aus KP Front.** Eine Nacht kann
  zwei Dokumente hervorbringen, und die sahen aus wie aus zwei verschiedenen Produkten.
  Der Bericht übernimmt die Palette des Rapports (Tinte, gedämpftes Grau, hellgraue
  Tabellenköpfe); das satte Rot, das jede Tabellenkopfzeile füllte, ist weg – auf einem
  Dokument, das grösstenteils aus Tabellen besteht, waren das drei alarmfarbene Bänder
  pro Blatt. Der einzige warme Akzent ist der ÜBUNG-Marker. Dazu eine durchgehende
  Gliederung: jede Ebene wird von genau einer Funktion gebaut, jeder Abschnitt hat Titel,
  Linie und eine Zeile, die sagt, was darunter steht, und der Schadenplatz-Rapport ist
  neu als eigene Ebene erkennbar statt in derselben Schrift wie die Felder des Einsatzes
  darüber. Das Ereignis ist die Überschrift, «Einsatzbericht» die Zeile darüber.
  Neu am Schluss: **Unterschriften** – Ort/Datum plus Einsatzleiter und Kommandant, die
  gleichen zwei Rollen in derselben Reihenfolge wie im Einsatzrapport.

- **Der Bericht druckt nur noch, was passiert ist.** Bisher stand bei jedem Einsatz
  Kontakt, Merkmale, Personal, Fahrzeuge und Material – auch wenn es zu allen fünf nichts
  zu sagen gab. Auf einer Sturmlage waren das 188 Gedankenstriche, zwei Seiten bestanden
  aus nichts anderem. Leere Felder entfallen ersatzlos; übrig bleiben 14 «–», und die sind
  echte Zeitbereiche. Ebenfalls weg: die Spalte «Benutzer» im Einsatztagebuch und das
  «(demo-editor)» hinter jedem Statuswechsel – wer was geklickt hat, beantwortet das
  Audit-Log, das ohnehin daneben exportiert wird. Die Herkunftszeilen von Reko und
  Rapport («Erfasst von … (Feld)») bleiben, das ist keine Bedienspur.
  Dazu Wortarbeit: «Eingesetztes Personal» heisst «Personal», «{Name} freigegeben» heisst
  «{Name} vom Einsatz abgezogen», und die Reaktionszeiten stehen durchgehend als `h:mm`.
  Unter dem Strich: 12 Seiten werden zu 10.

- **One «Drucken» sheet instead of three buttons, on the key `D`.** Thermodruck, the A4
  Statusdruck and the file exports (Bericht-PDF, Lageblatt, Audit-XLSX) were three separate
  footer entries that each answered the same question – *how does this get onto paper?* They
  are now one footer sheet with three columns, opened from the footer, from `Cmd/Ctrl+K` or
  with **`D`**. The mobile bottom bar loses its separate "Thermo" entry for the same reason.
  ⚠️ **`D` was already bound, to «Seitenpanel auf Detail schalten»** – and that binding was
  dead: it was gated on the panel already being open, and the panel has had only `detail` and
  `collapsed` since the map mode went, so it set `detail` on something that was already
  `detail`. Nothing is lost except the muscle memory of anyone who kept pressing it. `I` / `\`
  still toggles the side panel, `K` still switches it to the map.

- **The Kanban search finds an Auftrag by its name.** `matchesIncidentQuery` only ever saw the
  incident, and an incident carries a `groupId`, not the route's name – so typing the name of a
  route matched nothing, on the board and on every other surface that filters incidents. Both
  search helpers now take the group lookup, so the route name is part of what a card matches on.

- **The display top bar answers `s` and `/`**, with the `S` hint on the field, the same two keys
  as the board – somebody who walks from the KP over to the wall screen does not have to learn a
  second habit. It stays silent while a field has the caret or a dialog is open: on a screen
  running unattended, a stray keystroke must do nothing at all.

- **`/display/board` is the board, not a second design of it.** The wall screen used to render
  its own card, so it silently lagged behind the one on the board: no Reko person, no Rapport
  marker, no crew or material names, no Melder, no Abholung, resources at the bottom and the
  Auftrag above the Meldung. It now renders the same card as the command post with the controls
  taken off, in the same order, and its detail shows the crew's Funkmeldungen – which reached
  the board while the wall beside it stayed silent. The shared Viewer-Link board was a third
  rendering again, showing only vehicles; it is the same card now too.
  **The wall no longer follows the operator's «Ansicht».** Kompakt exists so an operator can fit
  more cards on a board they *work* in; a wall exists to be read from across the room. The
  preset is per device and the display page has no control to change it, so a wall PC left on
  Kompakt showed nothing but addresses and nobody standing in front of it could put that right.

- **«Feld meldet beendet» moves the card to BEENDET / RÜCKFAHRT and stops there.** It used to
  open the whole completion flow – material decisions, gates, a dialog – which asked an operator
  to finish an incident whose crew is still driving home. Rückfahrt *is* the state the field
  just reported, so the move alone is the honest answer: the question is answered by the card
  being in that column, which is also why the answer now survives a reload. A crew that needs a
  lift back reports an **Abholung**, and that arrives as its own banner rather than as another
  prompt about this incident.

- **The incident detail has one action bar, and the ⋯ menu is gone.** The menu had been reduced
  to a single «Löschen» – a button behind a button – and it opened downwards into the board
  footer, where it was clipped. Every action now sits on one footer bar; in the 420 px side
  panel the icons stand alone and the label arrives on hover. **Abholung** is a banner beside
  the Feld-Meldung instead of a chip in the title row, both above «Status ändern» in the modal
  and directly under the tabs in the panel. «Abholung erledigt» no longer raises a success toast
  – the operator pressed the button and confirmed it; only a failure has something to say.

- **The card reads as three sections, and shows one time instead of two.** Kopf/Meldung,
  Ressourcen and Reko, separated by two rules and one 12 px rhythm, with the rule belonging to
  whichever block opens a section – so a section that renders nothing cannot leave a line above
  nothing. Einsatzart and the time share a row, and the time row now shows **only the mode that
  is actually selected**: picking «In diesem Status» used to print the start time beside it,
  answering a question nobody asked and crowding out the Einsatzart. The start time is one click
  away in the dropdown, which lists every mode's value anyway.

- **The board runs to the window edge.** The right edge no longer reserves an empty column for
  the reopen tabs: both are positioned out of flow, the way the Personen-Leiste's tab on the
  left always was. The detail opener sits in the top corner rather than beside the sidebar
  chevron.

- **Ein Wort pro Sache – die deutschen Bezeichnungen sind vereinheitlicht.** Material was called
  four different things (Mittel / Material / Gerät / Einheiten) while «Mittel» was *also* the
  label for medium priority, so one word meant both a resource and an urgency. Sharpest case: a
  dialog headed «Material vor Ort oder ins Magazin?» over a body reading «Entscheide pro
  Mittel». **Material** is now the category, **Mittel** is priority only, and a single countable
  item is a **Gerät** – «3 Geräte noch vor Ort» is what a crew says.
  In the same pass: «Einsatz» named both the whole thing and one of its seven columns, so a card
  could be an Einsatz in Einsatz – the column is **«Im Einsatz»** now. Aufgebot and Alarm are
  separated (the footer's «Alarm» is the *inbound* intake link, the opposite direction). Five
  names for the Reko report collapse to **Reko-Bericht**, and Personal / Personen / BESATZUNG to
  **Mannschaft**. About 20 strings gained real plural rules, replacing «Fahrzeug(e)» and
  «1 Trupps» – including a typo inside one, which rendered «Einsatze» in exactly the branch
  operators see. French mirrors every change.

- **Die Kartenränder bedeuten überall dasselbe.** Two screens hang on the same wall and
  disagreed: the coloured left edge of a card meant **priority** on the board and the share
  board, but **status** on the status display – the same stripe, two meanings, side by side in a
  command post. The edge is priority everywhere now. The status page loses nothing: rows stay
  grouped by status in board order, each group header names it in words and carries the board
  column's tint, and every row gets a status dot in that colour, so a row scrolled away from its
  header still says which column it is in. Low priority was also grey on two surfaces and green
  on all the others; there is one colour table now.

- **Spaltenköpfe sind wieder Grossbuchstaben, aber leiser.** The board's column headers had been
  set in caps deliberately; a cleanup removed it. They are back – as small spaced caps in muted
  grey, not at card-title size. A column header names a place, a card header names an Einsatz,
  and when both were drawn the same the eye stopped finding the column boundaries.

### Fixed

- **Fünf Fehler im Einsatzbericht, gefunden beim Ausdrucken statt beim Lesen des Codes.**
  Ein roher Enum stand auf dem Papier («Stromversorgung: available») – das UI übersetzt die
  Reko-Antworten, der PDF nicht, ein archivierter Bericht hätte irgendwann
  «emergency_needed» gesagt. Die Status-Aufschlüsselung war nach dem rohen Schlüssel
  sortiert und damit in einer Reihenfolge, die für den Leser keine ist; sie folgt neu dem
  Ablauf des Boards. Zwei Spaltenköpfe brachen mitten im Wort («Eingegang / en»); sie
  heissen «Eingang» und «Ende», und die Spaltenbreiten sind neu gemessen statt geschätzt.
  `SimpleDocTemplate` polstert seinen Frame mit 6 pt pro Seite, was in der Inhaltsbreite
  fehlte: jede volle Tabelle war 12 pt breiter als ihr Frame, ragte rechts über die
  Abschnittslinien hinaus, und eine Zeile, deren Inhalt eine Neuberechnung erzwang, sprang
  6 pt aus der Labelspalte. Und die Übersichtstabelle behauptete im Docstring zwei Spalten,
  die sie nie hatte.

- **Die Anwesenheit stimmt jetzt auch in der Antwort, nicht nur im Filter.**
  `GET /api/personnel/?checked_in_only=true&event_id=…` lieferte genau die anwesenden Personen
  und schrieb bei jeder einzelnen `checked_in: false` — der Filter war längst auf
  `event_attendance` umgezogen, das Antwortfeld noch nicht. Die drei Felder
  `checked_in` / `checked_in_at` / `checked_out_at` werden neu aus der Anwesenheit **des
  gefragten Ereignisses** aufgelöst, an jeder Stelle, die Personal in einem Ereignis-Kontext
  ausgibt (Board-Roster und Viewer-Board). Ohne `event_id` sind sie leer, weil Anwesenheit
  ausserhalb eines Ereignisses keine Aussage ist.
  ⚠️ Migration `c7e4a1b9f082` **entfernt** dazu die Spalten `personnel.checked_in`,
  `checked_in_at` und `checked_out_at` samt Check-Constraint und Index. Sie wurden seit dem Tag,
  an dem `event_attendance` kam, nie mehr geschrieben — es geht nichts verloren, und eine Spalte,
  die immer «niemand ist da» antwortet, ist schlimmer als keine. Läuft automatisch beim Start.

- **Eine Aushilfe, die man im Fahrer-Dialog erfasst, ist danach auch auf dem Board zu sehen.**
  Der Check-in lief über einen frisch erzeugten öffentlichen Check-in-Link; scheiterte er, wurde
  der Fehler in die Konsole geschrieben und die Person trotzdem als Fahrerin gesetzt — die
  Personalliste blieb «Keine Personen verfügbar». Der Check-in geht neu über die eigene Tür des
  Editors, und ein Fehlschlag wird gemeldet statt verschwiegen.

- **Der Fahrer-Dialog passt auf einen Laptop-Bildschirm.** Mit offenem «Person hinzufügen» wuchs
  er über den unteren Rand und legte sich über die Fussleiste; auf 1440×760 war der Titel oben
  abgeschnitten und «Schliessen» unten nicht mehr erreichbar. Er ist neu auf die Fensterhöhe
  begrenzt, die Personenliste scrollt darin.

- **Die Check-in-Antworten führen die Tags mit.** `tags` war im Schema deklariert und wurde nie
  gefüllt, also kam jede Person aus dem Check-in ohne ihr «F» zurück.

- **The selection outline stopped vanishing on exactly the cards that matter most.** Selection
  was drawn as a ring, and the `priority-high-pulse` animation sets `box-shadow` in its
  keyframes, which wipes out every `ring-*` and `shadow-*` utility – so on a high-priority card
  you could not see which one you had selected. It is a full-strength neutral outline now.
  Hovering a card no longer strips its priority colours either, and low priority closes its left
  border instead of making it transparent, which had punched a light gap into the card outline.

- **Folding a column scrolls it back into view in both directions.** Unfolding worked, folding
  did not: the folded strip and the open column are two different elements, so the ref that
  survived the toggle pointed at the unmounted one. The scroll is done by DOM query now.

- **A toast is usable over a dialog.** Radix locks the page with `pointer-events: none` on
  `<body>`, sonner portals into `<body>` and set no value of its own – so a toast raised while a
  modal was open was drawn on top of it (z-index 999999999 against 50) and could be neither
  dismissed nor clicked. Its action button was unreachable at the exact moment it was offered.

- **Meldung und Notizen wachsen wieder mit ihrem Text.** `DENSE_CONTROL`'s `h-7` was beating the
  textarea's own field-sizing, so a long Meldung was typed into a one-line box. In the same
  pass: the Funkmeldung rows keep one height whether they are toggled or not (the block no
  longer jumps as answers come in), the Einsatzort icons sit on the line, and the address
  suggestions stopped rendering at body size.

- **Ein zugeklapptes Seitenpanel bleibt zugeklappt.** `usePersistedState` tracked "has the
  stored value been read" in a ref: the read effect flipped the flag synchronously, the write
  effect ran in the same flush and persisted the fallback *over* the stored value, and
  StrictMode's second read picked that up – so a sidebar you closed came back open. Covered by a
  regression test that runs under an explicit `StrictMode`.

- **Die Glocke behauptet nicht mehr, alles sei in Ordnung, wenn sie den Server nicht erreicht.**
  A failed notification fetch was indistinguishable from an empty list, so the panel said «Alles
  ist in Ordnung» while the backend was unreachable. The honest answer is "I cannot tell", and
  that is what it says now – with one sticky toast instead of the dozen a minute a failing poll
  would otherwise raise on top of an outage.

- **Reko-Gefahren verschwinden nicht mehr fünf Sekunden nach dem Aktualisieren.** The two board
  load paths each carried their own copy of the danger derivation and the polling one had lost
  Brandgefahr: a Reko whose only hazard was fire showed its chips on a manual refresh and dropped
  them at the next poll – on the card, the wall display and the mobile warning triangle. One
  derivation feeds both now. A card whose danger *changed* (Einsturz → Brandgefahr) also kept
  showing the old chip, because the repaint check compared how many dangers there were rather
  than which. Same class of bug fixed for a renamed Reko person, the Nachbarhilfe note and the
  vehicle call signs, all of which are drawn on the card and none of which were compared.

- **Ein 3-px-Zucken auf einer Karte gilt nicht mehr als Umsortieren.** The board wrote a new
  order to the server for a mouse twitch. "Did anything actually move?" is now answered before
  anything is saved.

- **Die Wandanzeige zeigt wieder alle Spalten.** Below 1800 px the display board's column width
  floor pushed columns off-screen – 508 px of them at 1280, so BEENDET/RÜCKFAHRT and
  ABGESCHLOSSEN were simply not there. A wall screen has no mouse, so scrolling sideways was
  never a recovery. Cards get narrower instead; nothing changes at 1920. In the same pass: any
  banner (stale data, truncation) used to push the bottom chrome exactly its own height off the
  screen, and a fresh kiosk profile had no way to pick an Ereignis – the picker lives on
  `/display`, not in the wall header, because a control that changes what a whole room is
  watching should not sit one stray click from the board.

- **Ein Viewer stolpert nicht mehr über den Rapport.** Anyone opening an incident with a
  read-only account got «Rapport konnte nicht geladen werden.» plus two error toasts, every
  time: the detail always mounted the Schadenplatz-Rapport section, whose endpoint is
  editor-only because it holds citizen data. The Reko report, the Funkmeldungen and the Verlauf
  stay visible – those are open to any signed-in user.

- **Eine auswärtige Adresse zeigt ihren Ort, nicht zweimal ihre Strasse.** A raw address came out
  as «Bahnhofstrasse 12, Bahnhofstrasse»: the formatter took the component after the street as
  the town, but the geocoder puts the house number first when there is one. For a Nachbarhilfe
  incident the town is the one thing that has to be right. Two more defects fell out of it – the
  country test never matched the multilingual «Schweiz/Suisse/Svizzera/Svizra», so the whole
  string leaked onto the card, and an address with no town repeated the street. Known limit,
  written down in both copies: a canton without districts whose name differs from its town
  (Carouge GE, Baar ZG) still shows the canton.

- **Enter tut wieder das, was das fokussierte Element bedeutet.** Merely *resting* the pointer on
  a card made the board eat `Enter` – with the Karte link focused, Enter opened the hovered card
  instead of following the link. On a dense board the pointer is over a card most of the time, so
  Enter was effectively dead for the whole keyboard UI. Related: map shortcuts fired underneath
  open menus and dialogs (`l` toggled Labels while the menu's own typeahead moved the selection),
  and `b` toggled the notification sidebar under an open user menu. And the command palette
  advertised `D` twice – the side-panel command it named has no key bound to it any more, so the
  stale hint is gone while the command stays.

- **Ein Doppelklick kann ein Ereignis nicht mehr zweimal löschen.** Measured: a double-click on
  «Dauerhaft löschen» fired two deletes, and on «Archivieren» two archives. Delete takes every
  incident under the event with it and has no undo. The confirm button now disables with a
  spinner on the first click, Cancel disables with it, and the dialog refuses to close while the
  request is out – otherwise Esc dismisses it and the whole thing can be fired again.

- **Eine grosse Mannschaft begräbt die Karten unter sich nicht mehr.** A card with 30 crew
  measured 771 px, so its own header scrolled away and every card below it became unreachable.
  Crew and material cap at six chips with a «+N weitere» that opens the detail: 771 px → 355 px.
  Four more things in the same pass: the sidebars claimed «0/0 verfügbar» while still loading
  (asserting there is no crew and no material) and blanked the list on a search that matched
  nothing while the footer still read «10/17» – both are now honest, with a named empty state
  and a reset; a fresh station's material sidebar was just an empty box and now points into the
  settings; the Auftrag row on a card crammed 107 px of text into 49 px with no way to recover
  it by hovering, and takes two lines now; and the footer strip dropped Rapporte, Drucken,
  Übungs-Steuerung and Ansicht off its right edge whenever the notification sidebar was open –
  whatever does not fit moves into an overflow menu, verified from 1024 to 2560 px.

- **Vier Stellen in der Dokumentation, die einem Selbst-Hoster einen Abend oder einen Fehlkauf
  gekostet hätten.** The in-app help said the thermal printer is **58 mm** – it is **80 mm**
  (48 characters in Font A, verified on the machine), and a station buying from that sentence
  would have bought a printer that wraps every line. The same help described a six-column
  workflow ending in an «Archiv» that does not exist: there are **seven** columns, and
  archiving happens on the *Ereignis*, not on a single incident. It also still documented a
  «Meldung» switch and a map mode in the side panel, both of which the «Ansicht» menu and the
  separate map page replaced. And [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) called the
  Viewer, Check-In and Reko tokens "long-lived" when all three last **24 hours**, gave the login
  token 24 h when it is **8 h**, and omitted the two 30-day tokens (Alarm and Feld) entirely –
  that is the table somebody reads to decide who gets which link, so it now lists every token
  with its real lifetime.

- **Die Testsuite ruft nicht mehr den produktiven GPS-Server an.** Anybody running `pytest` with
  a populated `backend/.env` was making live requests to the station's Traccar box on every run.
  The suite now blocks real outbound sockets outright, so a test can neither depend on the GPS
  server being up nor add load to it.

- **Jeder Einsatz auf dem Board zeigte «Oberwil (BL)» – die Ortschaft, die der Formatierer
  entfernen soll.** Two reasons, both invisible against the addresses it had been tested on.
  Home-city matching normalised away a *postcode*, so «4104 Oberwil» matched «Oberwil, BL» while
  «Oberwil (BL)» and «Oberwil BL» did not – the brackets and the bare suffix defeated the
  comparison. And Divera delivers the town **before** the street, the inverse of the Nominatim
  shape the ordering logic was written for, so even a recognised town was read the wrong way
  round. Canton abbreviations are now recognised from the list of 26 as a standalone trailing
  token, and the street – identified by carrying its own house number – leads the output, with
  everything else following in the order it arrived. Where that is ambiguous (no house number
  anywhere, or two components carrying one) the address is passed through untouched: an
  unformatted address is untidy, a mangled one sends a crew to the wrong place.
  The canton is compared rather than discarded, so «Oberwil BE» – a different municipality – is
  no longer swallowed by a home city of «Oberwil, BL», and a foreign town keeps its canton.
  Fixes 9 of the 18 addresses in production and leaves the other 9 byte-identical; two were
  losing data outright («Oberwil (BL), Grenzweg 1, BLT Tramdepot» rendered without its street).

- **Eine Mannschaft zu Fuss liest sich auf dem Handy nicht mehr als «Keine Fahrzeuge
  zugewiesen».** The phone's incident sheet had no notion of «Zu Fuss», so a crew that walked to
  the address rendered as having no vehicles – not a missing detail but the opposite of the
  truth, on the surface people read when they are away from the board. The empty line is now
  gated on both facts. The sheet also dropped the driver-stay marker the board and the wall carry
  per vehicle, which decides whether that vehicle can be moved and changes without the incident
  changing; it is now shown there too, as state only – the toggle stays where the operator is
  actually running the board. Extracted as `DriverStayGlyph` rather than hand-rolled a third
  time: the two existing copies had already drifted, drawing «zurück» on the board and nothing on
  the wall for an assignment carrying no answer. Nothing is the honest reading, so that is what
  the shared one does.

- **`K` erreicht die Karte auch bei eingeklappter Seitenleiste.** The key navigates to `/map`,
  but was still gated on the side panel being open – a leftover from when it switched that panel
  into a map mode that no longer exists. So with the panel collapsed it did nothing at all,
  silently, while the command palette went on advertising it. The hint was right; the binding was
  wrong. `K` still stands down while typing, under an open menu and under a modal.

## [0.5.0] – 2026-08-08

> ⚠️ **Operator action for anyone running the Divera webhook without a secret.** It now answers
> `403` instead of accepting the alarm. Set `ALARM_WEBHOOK_SECRET` in `.env` before updating —
> see the Security section below and [`docs/ALARM-INTEGRATIONS.md`](docs/ALARM-INTEGRATIONS.md).
> This is why the release is 0.5.0 and not a patch: the table above promises that a PATCH is
> always safe to take, and this one is not.

### Security

- **The Divera webhook accepted alarms when no secret was configured.** Both inbound alarm
  paths write to the same Lage, so both must answer the same way. They did not: the
  provider-neutral `POST /api/alarms` failed closed, while the Divera adapter guarded with
  `if webhook_secret:` — an unset **or emptied** secret skipped the check entirely and left an
  unauthenticated write endpoint open. `alarm_webhook_secret` is in the settings PATCH
  allowlist, so any editor could reach that state from the UI without meaning to.

  Both now go through one check and fail closed: **no secret configured → `403`.**

  ⚠️ **Breaking for a deployment that runs the Divera webhook without a secret** — it will
  start answering `403` until one is set. That is the intended direction: a station that has
  not configured a secret has not authorised anyone to create incidents on its board. Set
  `ALARM_WEBHOOK_SECRET` in `.env` (the environment wins over the database value) — see
  [`docs/ALARM-INTEGRATIONS.md`](docs/ALARM-INTEGRATIONS.md).

- **Stored credentials were readable through the settings API, and the sync target host was
  freely settable.** `GET /api/settings/` now masks secrets, and reading
  `alarm_webhook_secret` directly answers `403` — otherwise any signed-in user, including a
  pure viewer, could read the key that writes incidents onto the Lage.

- **Vehicle positions were readable without a session.** `GET /api/v1/traccar/{status,positions}`
  took no authentication and the router carried no dependency, so live positions were available
  to anyone who knew the path. Both routes now require a session. *(Shipped in the previous
  release; recorded here because it was never written down.)*

- **One header was enough to claim another IP.** The rate limiter and the audit log both
  trusted a client-supplied forwarding header, so per-IP limits could be evaded and audit rows
  attributed to an address of the caller's choosing. The client IP is now derived from a
  configured trusted-proxy depth. *(Also shipped previously and unrecorded.)*

### Added
- **The capability registry now shows what you *could* point at, not only what is switched on –
  starting with a published roster contract.** `GET /api/integrations` answered "which provider is
  active for alarms, alerting, personnel, vehicles". That is the right answer to the wrong half of
  the question: a provider nobody here has configured was not discoverable at all, so a domain with
  one integration read like a domain with one vendor. The response gains `known_providers`, every
  provider this build knows about, with `configured` and – the honest part – `implemented`.

  The first entry that needs it is **`roster-snapshot`**: some stations keep their personnel list in
  a municipal HR system, a cantonal register or a nightly script, and the answer to that is a
  published, versioned schema any station can point at any URL rather than an adapter per vendor.
  Both schema files ship here – [`docs/roster-snapshot.schema.json`](docs/roster-snapshot.schema.json)
  for the file, [`docs/roster-snapshot-outcome.schema.json`](docs/roster-snapshot-outcome.schema.json)
  for the report a run must produce, because a roster sync that quietly loses people corrupts every
  attendance figure afterwards and does so invisibly. Identities travel as `(provider, external_id)`
  pairs into `personnel_external_identities`; no vendor is named anywhere in the schema. It carries
  **no medical fields, ever** – no Untersuchung, no Tauglichkeit, no Impfung, and no free-form
  `metadata` map in which such a thing could arrive unnamed.

  **Nothing here reads a snapshot yet** – the entry says `implemented: false` and means it. The
  files are byte-identical copies of KP Front's, pinned by checksum on both sides: still no shared
  library, no import, no runtime coupling between the two products ([RUNNING-BOTH.md](docs/RUNNING-BOTH.md)
  is unchanged) – a shared *file*, kept in step by a test.

### Changed

- **The nightly E2E is green again, and it was never flaky.** It had failed every night since
  05.08 on one test. The page object selected combobox options as *any* button in the popover —
  but the search box grows a clear («X») button as soon as there is text, above the result list,
  so it clicked *that*: the query was wiped, no address was ever committed, and the create button
  stayed correctly disabled until the click timed out 30 s later. It was consistent rather than
  intermittent because CI *can* reach the geocoder, so the freetext fallback never appeared and
  the wrong branch always ran. Options are now pinned to the result list with a `data-testid`,
  the same reasoning that put `data-slot` on the role badge after `[class*="badge"]` matched
  nothing. Full suite: 155 passed.

- **Main's CI was red for three days.** `get_incident_assignments` resolves names by looping over
  three model classes; mypy joins them to their common declarative `Base`, which declares neither
  `id` nor `name`, so the blocking type-check subset failed on every push since 05.08. Annotated
  as `type[Any]` per plan 14's pattern 2. No runtime change.

- **The alarm keyword list existed twice in the estate, nothing compared the copies, and it was
  named after somebody else's alerting provider.** The map from an alert's Stichwort to an incident
  category, and the keyword list deciding which alerts are high priority, were written
  independently here and in KP Front – the same 19 title keywords, same order, same casing, arrived
  at twice – and had already begun to drift: this side knew `GASLECK`, the other did not. Both now
  read one checked-in data file, `backend/app/data/alarm_keywords.json`, vendored byte-for-byte
  into both products with a checksum pinned on each side, plus a new **`alarm-keyword-drift`** CI
  job here that diffs the file against KP Front's default branch.

  **Nothing in that file is Divera's**, which is why it is not called `divera_keywords.json`: the
  keywords are German fire-service words and the categories are the FKS Schadenkategorien. Divera
  is how those words reach *this* station – the delivery, not the definition – and naming a shared
  vocabulary after one deployment's provider made it look like a Divera feature to every other
  station. Same reasoning that retired `divera_id` in favour of `source`/`source_ref`. The Divera
  intake, poller, alerting adapter and access key keep their names: those genuinely are the Divera
  attachment.

  That job is the load-bearing half and it is worth being precise about why. The checksum test
  catches an accidental edit *on this side*; it never reads the other repository, so editing both
  copies and updating both hashes leaves everything green. Only the drift job compares the two
  checkouts – exactly the split the telemetry sanitiser already uses, and the reason both are kept.
  A shared package was the obvious alternative and was rejected: `RUNNING-BOTH.md` promises
  self-hosters separate databases, separate images, separate releases, no shared library and no
  runtime coupling. That promise is published. A test that catches drift keeps it; a library that
  removes the duplication would break it.

  **If you forked this repository, both cross-repo jobs now belong to you.** They used to be
  hardcoded to `feuerwehr-oberwil/kp-front`, so a fork inherited a check that compared its files
  against ours and went red with nothing explaining why. Both now read a single `SIBLING_REPO`
  variable at the top of `.github/workflows/ci.yml` – point it at your own KP Front fork, or set it
  to an empty string to switch both off. They **skip with a message**, never fail, when the sibling
  is unset or cannot be checked out; they still fail, loudly, when it is readable and the files
  actually differ. A check that goes green when it could not answer the question is worse than no
  check, because the green tick reads as proof.

  **Behaviour is unchanged** – the resulting maps are character-for-character what they were, order
  included. Two things deliberately stayed out of the shared file and are named in it rather than
  quietly unified: the **display labels**, because this app stores keys while KP Front stores German
  strings in the database and the two disagree on a capital letter, and the **matching rule**,
  because this app requires word boundaries on short keywords like `GAS`, `VU` and `LIFT` where KP
  Front matches substrings. Word boundaries stop `GAS` firing on *Gasse* – and also stop it firing
  on *Gasflasche*. Neither behaviour is unambiguously right, it decides which alerts come out high
  priority, and it is not a call to make unilaterally on the alerting path, so it is recorded in the
  shared file as a known divergence.

## [0.4.0] – 2026-08-01

Two threads. A review pass before publishing the repository more widely – the documentation checked
claim by claim against the code, four things promises the code did not keep. And a resiliency sweep
whose findings share one shape: the capability was built, it just did not engage by itself. Several
of the entries below are things that would have failed quietly, during an incident, with nobody
watching.

**Read this one before updating:** the incident status identifiers are now English and the board no
longer translates them (see *Changed*). Any script of yours that reads the API sees new values.

### Fixed
- **Two agents could print the same slip.** The claim was a read-then-write: `SELECT`, status check
  in Python, then assignment. Both agents passed the check, both printed. What prevented it until
  now was the prose rule "never run two agents" – and compose ships a second agent behind a
  `printing` profile, so the rule sat one flag away from being broken. It is now a conditional
  `UPDATE` with the status in the `WHERE` clause: atomic, and the loser gets a 409. This also
  brought the repository's first real concurrency tests; `asyncio.gather` had appeared exactly zero
  times in either suite. Against the old logic the five-agent case reports `[1, 1, 0, 0, 0]` – two
  winners, the same slip twice. The two-agent case stayed green throughout, which is a good
  explanation of why this went undetected for so long.
- **Six settings could not be saved, among them the offline-map switch.** `api/settings.py` checks
  every key against `DEFAULT_SETTINGS`, and `home_city`, `map_mode`, `map_style` and the three
  `firestation_*` values were not in it. The seed writes them, the frontend reads them in seven
  places, the settings page renders inputs for them – and every save answered 404 behind a generic
  "Speichern fehlgeschlagen". Among them `map_mode`: the control that exists for the internet
  outage. A contract break between two lists that five lines of test would have caught; those lines
  now exist, and they read the frontend source rather than a copied list, because a copy drifts
  exactly like the thing it is meant to secure.
- **Safari never saw "Verbindung verloren", and "Gedruckt" was a guess.** Three places where the
  client asserted something it did not know. Network errors were detected by *text*:
  `error.message.includes('fetch')` only matches Chrome's "Failed to fetch", so on Safari every
  offline request fell through to the generic re-throw – around 85 read sites silently changed
  contract depending on the browser. There was also no timeout: a dead-but-open TCP connection never
  rejects on its own, and one hanging GET was enough to wedge the polling loop permanently, leaving
  the board simply standing still. Now 20 s, chosen generously – a command post on a saturated
  uplink is slow but worth waiting for. And "gedruckt" only ever meant the bytes were in the socket:
  a TM-T20III with no paper accepts a short slip into its buffer, the write closes cleanly, the
  agent reports `completed` and the toast turns green with no paper in existence. The most likely
  printer fault is the one that reports success. Until the agent queries real paper status it reads
  "An Drucker gesendet". Thermal path only – kp-front's CUPS side knows real job status and keeps
  its wording.
- **The token displays showed hours-old situations as current.** `/display/status` and
  `/display/map` swallowed every fetch error with a bare `catch {}` and then re-rendered the last
  answer indefinitely. A backend that starts throwing 500s at 02:10 produces a display at 04:00 that
  looks entirely normal. On a screen nobody is standing in front of, that is the most dangerous
  thing this application can do – more dangerous than a crash, which is at least visible. Worse, the
  connection indicator polled an authenticated endpoint, so a token display never had a session, the
  call failed every time, and the icon sat permanently on red: the only warning these screens had
  was crying wolf. Escalation is now staged – quiet under 30 s, a restrained bar after that,
  unmissable from two minutes – and the content stays visible at every stage, because during an
  outage the frozen picture is still the best information in the room.
- **The audit log, photo uploads and the print queue were all unbounded.** The middleware logged
  every successful `/api/` call including GETs, and the board polls roughly every 5 s per client:
  two idle wall displays alone came to something like a gigabyte a year, a storm at ~90 req/s to
  several gigabytes a day, against a retention setting that reads "forever" – and on a station box
  the database shares that disk. Only mutations are logged now; the proof the log exists for is
  intact, what is given up is "who *looked* at what". Photos were read fully into memory *before*
  the size check, and `_validate_file_type` called a complete decode before anyone looked at the
  dimensions, so a legal 1.2 MB PNG declaring 20000×20000 pixels expanded to ~1.6 GB against a 1 GB
  limit. Dimensions are now checked after the header parse and before decoding. And print jobs never
  expired, so after a two-hour printer outage the agent emptied the entire queue at once – slips for
  long-closed incidents competing for paper with the incident still running. Board snapshots expire
  after 15 min, incident slips after 60; test prints never, because somebody is standing at the
  printer and a late arrival is itself the diagnosis. Expired jobs are marked `expired`, not
  deleted: "this was never printed" belongs in the record.
- **100 incidents per Lage was an invisible ceiling.** `GET /api/incidents` capped at 100 and no
  production caller passes a limit – not the board, the detail view, the context or the viewer path.
  At 200 incidents, 100 were arbitrarily invisible with no banner, no number, no hint of any kind; a
  bare array looks identical whether it is complete or truncated. And that is precisely the storm
  scenario this software exists for. The default is now 500 (the *maximum* stays at 500, a tested
  safety bound – the bug was the default everyone gets, not the ceiling nobody touches), and
  `X-Total-Count` reports the total before skip/limit so the board can say "Es werden X von Y
  Einsätzen angezeigt". Making the limit visible matters more than making it higher.
- **The backup could be switched off, and `just clean` deleted everything.** Three gaps of the same
  shape. The backup sidecar hangs off the compose profile `backup`, which has to be passed on every
  invocation – but `just stop` runs a plain `down` and the documented update path is a plain
  `docker compose up -d`, so both leave the sidecar uncreated, and a container that does not exist
  cannot report itself `unhealthy`. The one signal that backups are running was missing exactly when
  they were not. `COMPOSE_PROFILES=backup` in the `.env` takes the remembering out of the loop.
  `just clean` dropped the database and photos without asking, in dev and production alike,
  advertised as "removes volumes" which reads like clearing caches; it now requires typing `delete`.
  And nothing told anyone about an outage: `/health` does a real `SELECT 1` and answers 503, and
  Caddy already published it – built, but never mentioned to anybody. `DEPLOYMENT.md` §7 now does.
- **`X-Total-Count` was invisible to JavaScript, and two warnings rendered on top of each other.**
  CORS hides any non-safelisted response header unless it is named in
  `Access-Control-Expose-Headers`, so the truncation banner above could never appear on a
  split-origin deployment – which is exactly what a developer runs locally. Separately the staleness
  banner on `/display/map` was absolutely positioned over the map's own "N Einsätze ohne gültige
  Koordinaten" chip: two warnings rendered into each other, less legible than either alone.
- **The export error appeared in English while the German message sat dead beside it.**
  `err instanceof Error ? err.message : t('page.reportExportFailed')` looks like a fallback but is
  not one – `apiClient` always throws an `Error`, so the second branch never ran, and the operator
  got raw backend text in an otherwise German interface. The German message is now the title and the
  technical cause the description. Same for the audit export.
- **The Einsatzzettel carried the print time rather than its own.** The agent has stamped
  `printed_at` into the footer since the resiliency batch, so a slip that sat behind a dead printer
  cannot claim to be current – but the value was only set for board, test and QR jobs. The
  most-printed document of all, and the one with the longest TTL, fell through to `datetime.now()`
  in the agent: back into the exact error the stamp exists to prevent. `AUSFALL_SOP.md` leans on that
  footer to judge how current the paper picture is.
- **`updated_at` on settings came from two clocks.** Postgres stamped it on INSERT
  (`server_default=func.now()`), the service set it from Python on UPDATE. If the database runs in a
  container or on a managed host, the application clock lags and a changed setting lands *before*
  its own creation. It surfaced as test flake – failing five times out of five in isolation, almost
  never in a full run, because there the gap is wide enough to cover the drift. `onupdate` now
  handles it, using `clock_timestamp()` rather than `now()`: the latter is the transaction start
  time, so a row created and changed in one transaction would have kept its old stamp.
- **The demo banner kept the demo awake, and the proxy added a redirect to every call.** Two
  findings from the Railway cost analysis. The banner polled `/api/demo/status` every 30 seconds
  even in a tab nobody had looked at for hours – on its own enough that the demo backend and its
  database never went to sleep: 739,000 requests in 30 days. It now polls only while the tab is
  visible, and fetches immediately on return so the countdown is never stale. And the proxy appended
  a trailing slash to every path, while only 76 of 346 backend routes are declared with one: for the
  other 270 that cost a guaranteed 307 plus a second request on every single call.
- **An expired simulation drive sometimes disappeared only internally.**
- **The image-size guard no longer reads Pillow's mutable global.** `Image.MAX_IMAGE_PIXELS` is set
  at import and was read back at the two check sites – but any other import can reassign it, `None`
  included, which disables the decompression-bomb guard outright. The checks now compare against an
  own constant; Pillow's copy is kept in step so its own warning fires at the same threshold.
- **The telemetry veto in `PRIVACY.md` did nothing.** The page tells an operator to put
  `KP_TELEMETRY_ENABLED=0` in their compose file and promises it "outranks the settings page, so
  no later click can turn it on". `Settings` has no `env_prefix`, so the field actually bound to
  `TELEMETRY_ENABLED` and the documented `KP_` spelling matched nothing at all. Consent still
  defaults to off in the database, so nothing was ever transmitted — but a station that had
  *enforced* the ban per the documentation had enforced nothing. Both spellings are now accepted
  and `test_telemetry_env_veto.py` pins them.
- **A logout did not survive a restart.** The JWT blocklist was a process-local dict, so every
  revoked token silently became valid again on the next `docker compose up -d`, and a second
  instance never saw the revocation at all. It now lives in the `revoked_tokens` table, ported
  from KP Front where the same defect was fixed first. Migration runs automatically.
- **The print agent read the wrong field for KP Front jobs.** `protocols/front.py` asked for
  `job_type`, which is KP *Rück's* column name; KP Front sends `kind`. Every job therefore
  arrived as a generic `document` and its real kind was lost. Harmless so far only because the
  CUPS output that serves KP Front ignores the field — fixed before that stopped being true.
- **Commands from the README failed on a normal Linux host.** `just dev` — the first command a
  newcomer runs — called `docker-compose` (the v1 binary), which a box installed per Docker's own
  instructions does not have. `just stop` aborted on the production compose file's guards before
  it got round to stopping the dev stack. The offline-tile scripts hardcoded the *development*
  container name, so `just tiles-download` greeted production operators with "run `just dev`
  first" and `just tiles-status` reported a healthy stack as not running. Dependabot watched
  `/print-agent`, a path that has not existed since the agent moved to `tools/`, leaving the one
  component a station actually runs unmonitored.
- **The print agent could not be started from this repository.** `tools/print-agent`
  declared `requires-python = ">=3.9"` — which is real, and load-bearing: the bare-Raspberry-Pi
  CUPS install runs on Bullseye's system Python — while also pinning `pillow>=12.2.0`, which
  dropped 3.9. The two contradict each other, so every resolve failed and `just printer` died
  before it started. The ESC/POS extra now carries a `python_version >= '3.10'` marker: the
  security floor stays, and 3.9 keeps the path that needs no extra at all. `just printer` also
  set no `BACKEND_URL` (the agent refuses to guess one) and no token, so on a good day it
  would have stopped at the fail-closed 403 — both are now wired to the dev defaults, and it
  runs with `--extra escpos`, without which it would have authenticated, claimed a job and
  only *then* failed on the lazy import.
- **The QR slip printed a quarter-width code and a transliterated umlaut.** Found on paper at
  the station, not in a test. The code was fixed at 4 dots per module, justified in a comment
  as keeping a long JWT-bearing URL "within the paper width" — measured on the real printer,
  such a link comes to 49 modules, or 204 of 576 available dots. It was never near the limit,
  just small. The size is now fitted to the content and clamped at both ends, so a bare URL
  cannot eat the roll and absurd content still prints something scannable. The target is a
  judgement made on paper, not the maximum that fits: filling all 576 dots was tried at the
  station and read as a poster rather than as a slip, so it aims at ~50 mm — the measured
  check-in link goes from 204 dots (~26 mm) to 408 (~51 mm). The sizing sits in the stdlib `core` rather
  than in `formatters`, which imports escpos — so CI's bare-Python job can test it. And the
  slip said "Scannen zum Oeffnen" although the codepage is CP437, which has `Ö`, and the same
  file already prints `ÖLWEHR` and `EINSÄTZE`.
- **The dev compose stack could not print either.** Its print-agent had no `AGENT_TOKEN` and
  the backend no `PRINT_AGENT_TOKEN`, which is a 403 by design; and it still passed
  `POLL_INTERVAL`, the dead variable no version of the agent has ever read.
- **A split-origin deployment on a custom domain lost real-time updates without saying so.**
  The browser worked out where to open its WebSocket from build-time variables and, failing
  those, from the page's own hostname: `X.up.railway.app` → `X-api.up.railway.app`, and
  same-origin for anything else. Same-origin is right behind Caddy and wrong on Railway, where
  the frontend and the backend are two hosts — so a Railway install on a custom domain connected
  to nothing, fell back to polling every five seconds, and reported no error at all. The server
  now hands the browser its runtime `API_URL` — the same variable the `/backend-api` proxy
  already uses — and that outranks every guess, so a domain name no longer decides whether the
  board is live. An `API_URL` the browser cannot reach (`http://backend:8000` on the compose
  stack, `*.railway.internal`) is withheld deliberately, leaving that path exactly as it was.
  `NEXT_PUBLIC_WS_URL` still works and is now an override nobody needs.
- **…and then the browser's own security policy refused the connection anyway.** Aiming the
  socket at the right host only helps if the page is allowed to open it. The
  Content-Security-Policy was assembled in `next.config.mjs`, which Next writes into the image
  during the build, so its `connect-src` could name only what was known on the build machine —
  the app's own origin, `localhost`, `*.railway.app`, and whatever `NEXT_PUBLIC_API_URL` said.
  The published images are built without that variable on purpose, so a station with its backend
  on a custom domain got a correctly aimed socket and a blocked one. The policy is now composed
  per request in `frontend/middleware.ts` from the runtime `API_URL`, and it names both that
  origin and its `wss://` counterpart. Nothing was widened to achieve it — no `connect-src *`,
  no blanket `wss:` — and an address the browser cannot reach is withheld by the same filter the
  WebSocket uses, so the compose stack's `http://backend:8000` never enters the header.
  `NEXT_PUBLIC_WS_URL` now reaches the policy too; it never did before, which is why setting it
  alone could not have fixed this either.

### Added
- **A failed print now reaches the person walking to the printer.** "Druckauftrag gesendet" only
  ever confirmed that a slip had been queued. If the paper was out, the agent marked the job
  `failed` with an `error_message` that lived under Einstellungen → Drucker and nowhere else – so
  the operator read "gesendet", walked over, and found nothing. The agent now reports the outcome
  back and the toast on the board changes to say what actually became of the job, with a printer
  that is simply unreachable reading differently from paper out.
- **The backup is now scheduled, verified and provably restorable.** Until today the only thing
  standing between a station and a lost operational record was somebody remembering to type
  `scripts/backup.sh` — no schedule, no retention beyond a flat 14 files, and no evidence that
  any of those files could be restored. Now: an opt-in compose sidecar
  (`docker compose --profile backup up -d`) takes the Postgres dump **and** the Reko photo volume
  nightly into a host directory, keeping **14 dailies and 8 weeklies** — two series because they
  answer two different questions (undo last night vs. somebody imported the wrong roster five
  weeks ago). Dumps are `-Fc` custom format, so `pg_restore` can list them and pull single tables
  out, and every one is read back with `pg_restore --list` before it counts as taken.
  `scripts/restore.sh` is the other half; it refuses to merge into a database that still has
  tables. A weekly `restore-drill` CI job runs the whole cycle — seed, dump, restore into a
  fresh empty database, diff the row counts and real values, migrate the result forward — so
  "has anyone ever restored one of these?" has a standing answer.
- **The failure modes are loud.** A backup that can silently do nothing is worse than none, so an
  unwritable directory, an unreachable database, a zero-byte or unreadable dump, or a missing
  photo volume each abort with a distinct exit code, a `BACKUP-FAILED` marker, a
  `"status": "failed"` in `last-backup.json`, and a failing container healthcheck —
  `docker compose ps backup` says `unhealthy` when last night did not work. Retention never runs
  after a failure and never deletes the last remaining copy.
- **A snapshot is taken before every migration.** `start.sh` ran `alembic upgrade head` on boot
  with nothing captured first; a failed migration ended the container, `restart: unless-stopped`
  replaced it, and the previous state was already gone. It now dumps first whenever a migration
  is actually pending (newest 5 kept, on a named volume so a container recreation cannot take
  them with it). Deliberately best-effort: if it cannot dump it warns unmistakably and boots
  anyway, because a board that is down is worse than a migration without a snapshot.

### Changed
- **Under the hood: the test suite was repaired, sped up, and the typing gate widened.** A run of
  end-to-end specs had drifted into asserting things that no longer existed – Tailwind class names
  instead of behaviour, a check-in widget that is not in the product, a local suite that could not
  even log in. They now test what the interface actually does. Backend tests moved off a single
  worker (1,881 of them were eight of twelve CI minutes), `app/services` went from 183 mypy errors
  to zero and moved into the blocking gate, and the nightly suite's own configuration was fixed:
  it had been failing on a missing `VIEWER_PASSWORD` and a missing `PRINT_AGENT_TOKEN`, reported
  under a spec name that had in fact already been repaired.
- **The backend image pins the PostgreSQL client to 17.** Debian bookworm's `postgresql-client`
  is version 15, and `pg_dump` 15 refuses outright to dump the 17.x server production runs
  ("aborting because of server version mismatch") — which would have made the new pre-migration
  snapshot fail exactly when it mattered. The client now comes from PGDG, pinned by
  `PG_CLIENT_MAJOR`, one major ahead of the compose database and level with production. The
  backup scripts additionally compare the two versions themselves and stop with the remedy
  spelled out, because the *server* is what a station can upgrade without touching this image.
  Note for self-hosters: `docker-compose.yml` still pins `postgres:16` — a 16 data volume cannot
  be read by a 17 server, so that move stays a deliberate, documented one.
- **The incident status identifiers are English, and the board no longer translates them.**
  The database and API said `eingegangen … abschluss` while the board said `incoming …
  complete`, so a translation table sat between them — and a status renamed in one place and
  not the other would have desynced the board silently, during an Einsatz. They are now one
  vocabulary: `incoming`, `reko`, `reko_done`, `enroute`, `active`, `returning`, `complete`.
  `reko` stays `reko` because a Reko is a running assignment, not a state of readiness.
  **Nothing on screen changes** — the German an operator reads has always come from the
  translation catalogue — with one deliberate exception: the vehicle overview now says
  «Rückfahrt» and «Abgeschlossen» like the board, where it used to say «Einsatz beendet» and
  «Abschluss». The migration translates existing incidents *and* their status history and
  runs automatically on boot; it is reversible. **If you read `/api/incidents` from your own
  script, the `status` values change** — that is the only thing outside this app that notices.
- **`NEXT_PUBLIC_API_URL` is an override again, and nothing more.** It had quietly become
  load-bearing for a second, unrelated job — it was the only way a backend address could enter
  the Content-Security-Policy — so a deployment that had set it could not follow this project's
  own advice to unset it. With the policy built at runtime, both jobs are done by `API_URL`.
  Stations that set the build-time variable keep working exactly as before.
- **A print job now reaches the printer in milliseconds instead of up to a minute.** The
  agent polled: 5 s while an operation was running, but 60 s when idle — and it only became
  brisk *after* it had printed something, so the slowest case was the first slip of an
  operation, the Einsatzzettel at alarm time. `/api/print/jobs/pending/` now accepts `wait`
  and holds the request open until a job is queued, the same long-poll KP Front's claim
  endpoint has always used. Two things improve with it: a job lost to a crashed agent is
  requeued within seconds rather than on the next idle poll, since the reaper runs on every
  pass through the wait; and the fallback pace drops from 60 s to 10 s.
  Nothing has to be updated in step — `wait` defaults to 0, so an old agent sees the old
  behaviour, and a new agent measures how fast an empty answer comes back and paces itself
  against a backend that does not know the parameter.

### Documentation
- **The documentation now says what the code does.** `backend/README.md` documented an
  `/api/operations` resource that does not exist and a module layout two refactors old;
  `ARCHITECTURE.md` had no section for the docker-compose stack that *is* production and told you
  to bake `NEXT_PUBLIC_API_URL` into the frontend image, which the release workflow deliberately
  does not do; `PHOTO_STORAGE.md` claimed Reko photos are public when the endpoint requires
  authentication and audits every view; `DATABASE_SCHEMA.md` listed six indexes as missing that
  all exist, and contained no schema. `RAILWAY.md` carries a legacy banner, `DATABASE_SCHEMA.md`
  and `VERIFICATION.md` are gone, and the required-secrets list finally includes the fifth one
  that compose refuses to start without.
- **The thermal printer is 80 mm, not 58 mm.** The code has always formatted for 80 mm paper
  (Font A at 48 characters); four documents said 58 mm, which would have sent somebody to buy the
  wrong printer.
- **Both READMEs described an interoperability that does not exist.** They claimed the two apps
  hand alarms to each other "through the same generic webhook, and nothing more". The payloads
  and auth differ, so KP Front needs a small adapter to feed KP Rück — and KP Rück has no
  outbound webhook to push the other way.
- **Screenshots are current again.** Every image in the repository predated the design-system
  refactor. `site/capture.mjs` now writes the README images from the same page states as the
  landing-page shots, so the two cannot drift apart the way they had (the README images were six
  months older).


## [0.3.0] – 2026-07-28

Two rounds of work. The first is Auftrag and viewer changes, all of it from one afternoon of
testing on the demo by an officer who does not build the thing. The second is a pass over the
interface itself: five audits went through every button, field, colour and border in the
frontend, which turned up a handful of real defects — a helper class that had been erasing the
border of every draggable card, a settings label wired to a field that did not exist, icon
buttons a screen reader could not name — and left the same thing looking the same wherever it
appears. Everything below is running in production at Feuerwehr Oberwil.

### Added
- **An Auftrag is handed out once, not once per stop.** A route with four stops produced four
  radio announcements, each reading out the same crew — so the Einsatzleiter read the same
  Mannschaft aloud four times. The first stop to reach «Disponiert» *is* the Auftragsvergabe and
  now gets the full announcement (crew and vehicles first, then the numbered list of stops, with
  Reko dangers and Nachbarhilfe collected at the end and named with their address). Every later
  stop gets the short continuation: «Auftrag ‹Sturmholz Oberwil› weiter mit Stop 3:
  Mühlemattstrasse 12.»

  If the route picks up crew, a vehicle or material in the meantime, the full announcement is due
  again — whoever just joined has never heard the Auftrag. Completed stops drop out of the list
  but **keep their number**, so «Stop 3» means the same address for the whole life of the
  Auftrag; a list that renumbers itself is a trap over the radio.

  There is deliberately **no new button**: the Disponiert dialog stays the trigger and only the
  text differs, because the app can tell which case it is and the operator should not have to.
  What was last announced is stored **on the Auftrag, server-side** (timestamp plus a digest of
  the crew/vehicles/material) rather than in the browser — two devices, a wall screen and a
  reload mid-Einsatz all have to agree on what has already been said.

  > **No action required.** The migration adding the four `incident_groups` columns runs on boot.
  > Until it has, an announcement simply cannot be recorded, and every stop falls back to the
  > full text — the harmless direction.
- **«Durchsage wiederholen» per Auftrag.** Radio traffic gets lost and asking for a repeat is
  normal. Each Auftrag in the slide-up now repeats its last announcement word for word (card,
  ⋮ menu, right-click) — no reopening a stop dialog for the wording, and the repeat is not
  counted as a new announcement.
- **The Reko photos are visible where the Reko result is read.** Photos uploaded through the Reko
  form only ever existed *inside* the Reko form — the one surface the command post never opens.
  The incident detail (including the `/display` views) shows them under «Reko-Ergebnis», together
  with the Lagetext, which was missing for the same reason. A picture of the damage is the most
  useful part of a Reko report. The images stay behind the login; a share-link view receives no
  filenames at all.
- **Every section of the display views folds away.** Board columns (including the share-link
  board), the incident status groups, the Funktionen under Personal and the categories under
  Material. A larger Feuerwehr otherwise only scrolls.

  Open is the default — nothing hides from someone who has just walked up to the screen — with
  ABGESCHLOSSEN as the one exception, as before. A **folded header keeps its count and its
  state**: a red dot as soon as an incident in that section is past the board's own warning
  threshold, and for Personal and Material how many are still free. Folding is hiding, and at 3am
  nothing important may hide itself. The fold is remembered per device, like the other display
  settings.
- **A closed incident can still be made a stop, but never silently.** Attaching an already
  completed incident to an Auftrag went through without a word, so a route showed a stop nobody
  was going to drive to. There is now a confirmation naming *which* of the selected incidents are
  closed — it warns, it does not forbid, because a Wiederaufnahme or a second visit to the same
  address is a real case and a ban would just produce a duplicate incident. It sits on the action
  rather than the screen, so it covers all three routes in: the stop picker, «An Auftrag
  verteilen» and dragging a card onto a route.
- **«Alle Einsätze einpassen» is a button now.** The map fitted itself to every incident exactly
  once, when it opened, and never again – so an incident arriving outside the viewport, or
  somebody having panned away, left «show me everything» to be rebuilt by hand out of zooming and
  searching. The fitting itself had existed all along; it hung off the panel resize and simply had
  no control. It sits top left under the zoom keys, with generous padding so a marker's label
  doesn't end up against the edge.
- **An Einsatzart's colour follows the hazard instead of a hash.** The colour was derived from the
  key's *name*, which made every colour an accident: «Ölwehr» came out green and collided on the
  same map with the green of a route. There is a table now – Brandbekämpfung red, BMA and Unechte
  Alarme dark red, Elementarereignis blue, Ölwehr orange – so the map reads the way the danger
  does.
- **The app wears the same mark as kp-rueck.ch.** Favicon and home-screen icon were a red square
  with «KP» set in Arial, a placeholder that matched neither the website nor KP Front. They now
  carry the landing page's mark – the magnet board the app is a version of, three columns of
  cards with one of them red because something is running – built from the same coordinates as
  the site rather than drawn a second time, so tab, home screen and landing page cannot drift
  apart. The 16px favicon gets its own reduced cut, because the full mark turns to mud at that
  size.
- **The sidebar shows availability the same way for people and material, and can hide what is
  busy.** The two lists had drifted apart: a person's status icon was amber when in use and green
  when free, while material drew the same icons in flat grey — so material read as if it had no
  state at all. Both now use one shared colour source. Cards no longer signal state by fading or
  tinting themselves either; that took the border with it, which is why some entries looked like
  they had no border while their neighbours did.

  Next to each search field there is now a single icon button that hides everything currently tied
  up. It reads availability exactly as the cards draw it — a Fahrer, a Reko or a Magaziner counts
  as busy even though the system still calls them "available", and consumables stay visible because
  handing some out does not empty the depot. The counter at the bottom keeps counting the full
  roster: it is the overall picture, not the filtered view.

### Fixed
- **An Auftrag wears its own colour everywhere on the map.** Two places disagreed. The route drew
  its line and its numbered stop pins with a private indigo fallback whenever the Auftrag had no
  colour set, while the board chip, the marker colouring and the legend had long resolved that
  same case through `colorAccent` — so two colourless Aufträge were one colour on the line and
  two different ones everywhere else. And while routes are drawn, a stop now also carries its
  route's colour as a *marker*: the numbered pin on top already did, the marker underneath stayed
  the priority fill, which on `/display/map` — routes on by default, colouring on «Priorität» —
  made every stop of every route read as the same static red. It is only a fallback; a
  deliberately chosen «Färben nach» dimension still wins, and the legend now lists the routes by
  name instead of continuing to claim «Priorität».
- **Neighbouring map labels no longer print over each other.** Two incidents a few metres apart
  wrote their addresses on top of one another — worst with the Aufträge layer on, where the
  numbered route pin lands on the same spot. A colliding label now steps down until it is clear;
  nothing is dropped, because at 3am the address you cannot see is the one you were looking for.
  Collisions are computed in screen pixels at the current zoom, so the same two incidents collide
  zoomed out and not zoomed in, and the order is stable so a map always resolves the same way.
  The marker and label under the pointer also come to the front, which the shared tooltip layer
  previously left to DOM order.
- **The stop-picker map keeps its labels inside the frame, and explains its colours.** Labels now
  open towards the middle of the map instead of over the border (which clips), the map fits with
  more padding so no marker sits against the edge, and a legend says what red, a route colour and
  grey mean. Toggling Liste ⇄ Karte still does not resize the dialog.
- **The setup and deployment guides no longer name a version.** They walked a new station through
  `git checkout` of one specific tag and pinned `KP_RUECK_TAG` to one specific number – both go
  stale the moment the next release lands, and a doc naming a tag that is not published yet stops
  the installation dead at the first command. The clone step now resolves the newest tag itself
  (`git tag -l 'v*' --sort=-v:refname | head -n1`), the pinning table talks in `X.Y.Z` / `X.Y` and
  links to the releases page, and the print-agent warning is an instruction that holds on every
  version – **set `PRINT_AGENT_TOKEN`** – instead of a warning against one release number.
- **Verbrauchsmaterial is never double-booked.** Unlimited stock has no count, so the fact that
  the Absperrband is already lying on another incident says nothing about this one – yet the
  assignment dialog flagged it amber and asked «Doppelbelegung?» before it would tick. Both are
  gone for anything marked unlimited: it selects straight away and counts along with the group
  tick, exactly like a free item. Limited material is unchanged – one Tauchpumpe assigned is
  still one Tauchpumpe away, and taking it off another incident still asks first.
- **The status display names every incident a material is on, not the last one.** The lookup kept
  one incident per material, so a consumable running on three showed «→» and one address – a
  precise-looking claim that happened to be wrong. It now collects all of them: one incident still
  reads as its address and jumps there on click, several read as «3 Einsätze» and are deliberately
  not clickable, because there is no single incident to open. Consumables also wear their ∞ in the
  status column now, so a green dot next to «3 Einsätze» reads as the rule it is instead of a bug.
- **Unlimited material is marked as such in the viewer's incident detail.** It was listed
  correctly – it just looked like every other item, in the incident's own materials and in the
  Auftrag roll-up. Both now carry the same ∞ the board and the Materialverwaltung use, on all
  three read-only displays (status, board, map).
- **The demo's contact numbers cannot reach anyone.** The detail dialog turns a contact number
  into a `tel:` link, and one of the four numbers in the demo seed was the real Polizei
  Basel-Landschaft line – one tap away on a public demo. All four are now visible dummy runs
  (`061 111 11 11` and friends). Switzerland reserves no drama range the way the US reserves 555,
  so the number has to show on its face that it is invented.
- **«Durchsage wiederholen» never refuses.** Before the first stop went «Disponiert» the dialog
  said there was nothing yet and showed no text – but the wording already exists, and somebody
  who wants to read it out over the radio has every reason to. It now always shows one: the
  recorded wording once there is one, and otherwise the announcement as it would read right now,
  which for an Auftrag that has never been given out is the full Auftragsdurchsage. It still only
  reads – nothing is recorded either way, so the first real Disponiert is still the Auftragsvergabe.
  The wording says which of the two you are looking at.
- **Closing a toast no longer closes what is underneath it.** Sonner renders its stack outside
  every panel, so dismissing a toast – or using «Alle ausblenden» – counted as a click *outside*
  the open dialog, slide-up, popover or menu, and took it down with it. Losing a half-filled form
  to a stray ✕ is not something anybody forgives at 3am. The guard now sits once in the shared
  primitives instead of being retyped per surface, and it covers the toast's ✕ and action icons,
  which are `<svg>` nodes and slipped through an earlier `HTMLElement` check.
- **A Reko is an order, and the crew doing it is not available.** The header read «7 verfügbar ·
  10 im Einsatz» on 17 people, and five of those seven were out on Reko – green, with the
  binocular glyph right beside them. A Reko is not an assignment and therefore never sets
  `status="assigned"`, but the tile colour and both counters read exactly that field, so every
  Reko-Trupp fell into the leftover bucket. Availability is decided in one place now
  (`personResourceState`) instead of three: tile, live statistics and the display header can no
  longer disagree about who is standing where.
- **A completed incident's clock stops.** The duration in the incident detail always counted up to
  *now*, so an incident that ran 58 minutes read «1h 12'» in the afternoon and «19h 40'» the next
  morning – the one number a Rückblick wants was never legible. It ends at `completed_at`, which
  the backend already stamped but which never reached the frontend, and is now carried through the
  live context, the WebSocket catch-up and the viewer. On the board the number stays what it
  always was, *how long this has stood in THIS status*, and it stops on a completed incident: a
  nag pointing at something left lying has nothing to say about a finished job.
- **The legend only lists what this map can actually contain.** «Fahrzeuge (GPS)» and
  «Zuweisungen» stood there always, including at a Feuerwehr without any GPS – so the legend
  explained blue lorry squares and dashed lines that never appear, and anybody looking for them is
  hunting a defect that does not exist. Both sections now depend on whether a vehicle reports a
  position at all, and the assignment lines additionally on whether they are switched on.
- **`/display/*` without a login and without an access code goes back to the start page.** The
  display surfaces exist for a wall screen behind a login or for a share link behind a code.
  Without either they used to show a single line of text on an otherwise empty surface – and on
  the demo the welcome dialog sat on top of it promising things a pure display cannot do
  («Einsätze erfassen, priorisieren, durch die Einsatzphasen bewegen»). The redirect waits for the
  session check first, so a slow check no longer bounces a legitimate wall screen.
- **A GPS-simulated drive in an exercise is no longer blocked by a real incident.** The safety line
  in the start endpoint refused every simulated drive as soon as *any* non-archived real event had
  an incident that wasn't closed – globally, regardless of vehicle or destination. In practice an
  exercise became undrivable because some old real situation lay around open somewhere. Drives to
  exercise incidents are unconditional now; the destination check («only incidents from exercises
  can be driven to») and the demo-mode lock both stay.
- **The Melder number is dialable in the viewer.** It stood in the incident detail as plain
  typewriter text – not tappable, not selectable, and a visual foreign body next to the rest of
  the block. It is a `tel:` link in the same typeface as everything around it. That turned up
  three separate `tel:` implementations with three different cleanups, two of which only stripped
  spaces – so a note like «(Nachbar)» went straight into the `href` and the link did nothing. One
  cleanup now serves all three. A stop inside an Auftrag also stops listing its resources twice.
- **The Rückmeldung form shows what it claims to show.** The channel rests on the idea that the
  operator reads the payload and *then* presses Senden – that press is the consent. Only there was
  nothing to read: before sending, the form showed a sentence *about* the payload, and the payload
  itself appeared only afterwards in the echo. The block now stands open above the buttons,
  verbatim, the way KP Front does it. The environment is captured once on mount and feeds both
  preview and payload, so the two cannot drift.
- **The Auftrag's stops are a list, one per line.** Joined with commas they ran together into
  something unreadable – «Bahnhofstrasse 31, 3. Lettenweg» is one address with a house number
  until you look twice, and a route is the last place that may be ambiguous. Each open stop now
  has its own line and carries where it stands (Offen / Disponiert / Einsatz), in the colours the
  stop list already uses. That status is for the eye only: it is not spoken and not copied,
  because nobody reads a status code over the radio. «Text kopieren» pastes the same list. The
  quotation marks are gone too – a straight `"` around a block several lines long left a stray
  mark in the middle of it, so the block carries a left rule instead.
- **A stop that was just added to an Auftrag is treated as part of it.** Adding a stop writes the
  *route*; the incident's own group id only arrives with the next refresh. In that window the stop
  looked ungrouped and three things went wrong at once: it was announced as a lone «neuer Einsatz»
  instead of the Auftragsdurchsage, «es fehlt noch etwas» offered to assign to the incident rather
  than to the Auftrag, and the Auftrag's own crew and vehicles were not counted when deciding what
  was missing – so the checklist opened for a route that was fully staffed. Membership is now read
  from the route's own stop list, which is authoritative and never lags.
- **«bleibt vor Ort» / «kehrt zurück» can be set where the vehicle is assigned.** The flag exists
  from the moment a vehicle is assigned, defaults to «zurück», and is read out on the radio,
  printed on the slip and shown on the board – but it could only be set from the incident card. A
  dispatch done through the assignment dialog therefore announced «kehrt zurück» for everything,
  true or not. Each assigned vehicle now carries the toggle there too, on the board and on the map.
  Not for an Auftrag yet: that flag has no endpoint to write through.
- **Draggable cards had no border.** A drag-and-drop helper class quietly overrode the border of
  every draggable card, so in the personnel sidebar an assigned person had a visible frame and a
  free one did not. The border belongs to the card, not to the drag affordance.
- **Priority colours had drifted back apart.** The map legend, the printed map legend and the
  wall-display detail modal each hard-coded their own red/yellow/green instead of the shared
  definition, so "low priority" was green in one view and emerald in another. All three read from
  the one source again.
- **Nine icon-only buttons were unusable with a screen reader** — including the user menu and the
  page navigation, which announced only "button". They have names now.
- **Removing a resource chip was a 10-pixel target.** The X on a crew or material chip had no
  clickable area beyond the glyph itself. It now has a real one, and a name.
- **A settings label did nothing when clicked.** It pointed at a field id that was never rendered.
- **Long names in the sidebar are readable again.** Truncated personnel and material names expand
  on hover, as do long Auftrag names in the Aufträge list.

### Changed
- **The frontend dev container may use 4 GB instead of 1.** Next's dev server compiles some 3000
  modules and sat at 99.9% of a 1 GB cap from the moment it started. It never got OOM-killed
  either – node just GC-thrashed at 100% CPU and stopped answering, so the page would not reload
  while `docker ps` still said the container was up. Development only; nothing shipped changes.
- **One visual language across the app.** Five audits went through every button, form field,
  colour, border and spacing value in the frontend. Cards share one corner radius and one clearly
  visible edge instead of three competing ones; dialogs use two heights instead of eight ad-hoc
  ones; a delete action is a red icon everywhere rather than sometimes grey and sometimes
  unmarked; small buttons are one size instead of four hand-written ones. Colour now means one
  thing at a time — amber and green describe the incident and its resources, a separate warning
  colour is the app reporting on itself (connection, sync, stale data).

  Nothing here changes how the board is operated. What it changes is that the same thing looks the
  same wherever it appears, so a status learned on the board still reads correctly on the wall
  display, the map and the phone.

### Removed
- **The training controls no longer alarm through the alarm intake.** The "Alarmeingang" button
  under *Einzelne Einsätze generieren* and the "Alarmweg" selector in the automatic generator are
  gone. Both worked – the simulated alarm landed in the pool with a ÜBUNG badge and could be
  attached to the exercise – but it was never decided **who gets alarmed during an exercise**.
  While that is open, the automatic generator is one step away from texting the whole brigade for
  an exercise three people are running. The training controls still generate straight onto the
  board and through the phone alarm; running exercises are otherwise unchanged. The path comes
  back once "who is taking part" can be set explicitly.

## [0.2.0] – 2026-07-26

### Security
- **Live updates now require a login.** The Socket.IO connection accepted anyone: only the
  admin room was role-gated, so anything able to reach `/socket.io` could join the operations
  room and receive live incident broadcasts — addresses, crew assignments — without
  authenticating. The strict-mode flag existed but shipped off ("Phase 1"). It is now on.

  The CORS origin whitelist was never the control here, which is the part worth internalising:
  CORS is enforced by browsers, and a script that omits `Origin` is not a browser.

  > **No action for a normal deployment.** Nothing legitimate connects anonymously — the app
  > sends its session cookie, the `/display/*` screens require a login, and the public
  > share-link board polls over HTTP rather than using the socket. If some client of yours
  > genuinely cannot log in, set `WS_REQUIRE_AUTH=false`; the board falls back to ~5s polling
  > rather than going blank.
- **Four security-relevant settings are documented for the first time.** A control nobody can
  find is not a control. `SSO_EDITOR_ALLOWLIST` (without it, *every* Entra ID sign-in is a
  viewer — any tenant member can reach the login, so editor is an explicit grant),
  `WS_REQUIRE_AUTH`, `MASTER_TOKEN` (bypasses login entirely for scripted configuration; empty
  by default, and not attributed to a user in the audit trail if you enable it), and the
  `LOGIN_*` throttle knobs the previous release already advertised as tunable. All now in
  [`.env.example`](.env.example), [`SECURITY.md`](SECURITY.md) and
  [`docs/SETUP.md`](docs/SETUP.md).
- **The security scanner was skipping a file.** Bandit is a blocking CI gate, but it ran on
  Python 3.11 against a 3.12 codebase, could not parse `app/crud/base.py`, and silently
  excluded it — noted in output that is easy to scroll past. Pinned to the project's Python; it
  now reports `Files skipped (0)`.
- **The print-agent endpoints are fail-closed.** They used to accept *any* request when
  `PRINT_AGENT_TOKEN` was unset – on the assumption that the agent only ever reaches the backend
  across a trusted LAN. The same image also runs on a public host, where "unset" quietly meant
  anyone could read the printer config, list pending jobs, claim them, and mark them done. The
  four agent endpoints now answer `403` with no token configured, matching how alarm intake has
  always behaved. `.env.example` already described this behaviour; the code now matches it.

  > **Operator action** if you print: set `PRINT_AGENT_TOKEN` on the backend *and* `AGENT_TOKEN`
  > on the agent, then restart both. Printing stops until you do – including on a LAN-only
  > install, where the token was previously optional. Deployments that don't print need nothing.

### Added
- **Offline map tiles work for your region, not just ours.** The tile pipeline was wired to one
  Swiss canton: the download URL, the bounding box and the region label were all literals in
  `scripts/download-tiles.sh`, so a station anywhere else could not follow the documented
  `just tiles-download` at all — it had to fork the script. Four environment variables now drive
  it, and `docs/OFFLINE_MAPS.md` explains how to find your own values:

  ```bash
  TILES_REGION="Oberbayern" \
  TILES_BOUNDS=11.0,47.7,12.3,48.4 \
  TILES_AREA=oberbayern \
  TILES_PBF_URL=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf \
    just tiles-download
  ```

  > **No action required.** The defaults are the previous values, so an existing deployment
  > behaves exactly as before. `TILES_NAME` (the file on the tileserver volume) is deliberately
  > separate and should be left alone on a deployment that already has tiles — renaming it makes
  > the init script write an empty bootstrap file instead of finding them, which looks like a
  > working map with nothing in it.
- **`docs/openapi.json` is committed** — the full API contract (158 routes, request and response
  shapes) readable without booting the stack. Anyone writing an adapter for a dispatch system
  against `POST /api/alarms`, or a print agent against the job queue, previously had to stand up
  Postgres and the backend just to see a payload. `just openapi` regenerates it, and a test fails
  if it drifts from the code.
- **More of the gate that stands behind a published image.** Secret scanning (gitleaks) and
  CodeQL static analysis now run here as they already did for KP Front, and CI runs a small
  Playwright subset on every pull request — logging in, creating an event and an incident, and
  alarm intake — where before it ran no click-through at all. The full suite runs nightly. None
  of this changes the software; it changes how much a release has been checked before it reaches
  you.
- **arm64 images.** All four images build for `linux/arm64` as well as `linux/amd64`, so an ARM
  host (Hetzner CAX, Oracle Ampere, a Raspberry Pi) can run the whole stack – previously only the
  print agent could.
- **Opt-in error reporting, off by default.** When something breaks, a deployment *may* forward a
  sanitised crash report – but only after switching it on in the admin area. Off means a NULL
  setting, which is exactly what every existing installation updates into, and consent is a
  deployment decision rather than a device preference: the fire service is the controller, not
  whoever is holding the tablet.

  What can leave the building is built field by field in `app/telemetry/scrub.py` – nothing is
  passed through or spread, so a field nobody wrote a line for cannot leak. Free text is scrubbed
  as well, because the value is usually *in* the message: paths, e-mails, phone numbers, IPs,
  coordinates, UUIDs, tokens, street names with house numbers, and the full user agent reduced to
  a coarse label so it can't fingerprint. Every payload is logged on your own server before it is
  sent and kept verbatim in `telemetry_outbox`, so you can audit it with a `SELECT` instead of
  taking our word for it. `KP_TELEMETRY_ENABLED=0` overrides every switch in the UI.
  See [`PRIVACY.md`](PRIVACY.md).

  > The scrubber and envelope are byte-identical copies of KP Front's, held in step by a checksum
  > test in both repositories – a rule tightened in one app and not the other would mean one of
  > them quietly forwards what the other removes.
- **[`docs/RUNNING-BOTH.md`](docs/RUNNING-BOTH.md)** for stations running KP Front *and* KP Rück
  on one host: the three places two otherwise-independent stacks collide, the traps around each,
  and a mapping table for the variables the two projects name differently. `.env.example` links
  to it, and the file is kept identical in both repositories.
- **One print agent for both systems.** A station running both used to need two agents on the
  same box — two services, two secrets, two install methods, two log streams — to reach the same
  printer room. The agent now lives at [`tools/print-agent/`](tools/print-agent/) and speaks
  **both** protocols: KP Rück's (structured JSON → ESC/POS thermal) and KP Front's (opaque PDF →
  CUPS/A4 laser). Give it a `backends` list and run one service.

  Neither backend changed and neither wire protocol changed. The core is stdlib-only, so the
  bare-Pi install with no venv keeps working; `python-escpos`/`pillow` are now an optional extra
  needed only for the thermal output.

  > **No action required.** The environment variables the previous agent used are read exactly
  > as before, so an existing `--profile printing` deployment keeps working untouched. The image
  > is published under the neutral name `ghcr.io/feuerwehr-oberwil/kp-print-agent`; the old
  > `kp-rueck-print-agent` name is **also** published this release, so nothing breaks on update.
  > Migrating from two agents to one: **stop the old ones first** — two agents polling one queue
  > both claim jobs, and each job then prints once, from whichever asked first.

### Changed
- **The audit log is no longer deleted after 90 days.** `AUDIT_RETENTION_DAYS` now defaults to
  `0`, meaning keep everything. It defaulted to 90 and a background job swept silently, which
  sat badly next to this project's own claim of "defensible records" and an "append-only audit
  log": a deployment older than three months had already lost the trail for its earliest
  operations, and nothing anywhere said so. With retention off the sweeper does not start at
  all. A public demo still caps at 7 days.

  > **Check this if you have been running 0.1.x.** Anything older than 90 days is already gone
  > — worth knowing *before* somebody asks you for it. And if you were relying on the sweep to
  > bound table growth, set `AUDIT_RETENTION_DAYS=90` back explicitly. `docs/SETUP.md` §6 has
  > the reasoning.
- **Node 24 instead of Node 20.** The frontend image was built on a runtime that reached
  end-of-life on 2026-04-30, so any Node vulnerability disclosed after that date was one nobody
  would ever patch for it. Node 24 is supported to 2028-04-30. Dependabot now watches base
  images too — that gap existed because npm, pip and GitHub Actions were watched and the one
  dependency a station actually *runs* was not.
- **A fresh production deployment now starts with an empty board.** It used to be seeded with a
  fictional station: five vehicles (Omega 1–5), 57 firefighters, a full material catalogue, and
  thirteen training locations on real streets in one specific Swiss municipality. Sample
  *incidents* were already withheld from production; the resources they referred to were not. So
  the first act of setting KP Rück up for your own station was deleting somebody else's data off
  the board — and a restored backup put it back. Accounts and settings are still seeded; the
  station's own resources come in through the Excel import (`docs/SETUP.md` §3).

  > **No action for an existing deployment** — seeding only runs on a database with no users, so
  > yours has long since skipped it and your data is untouched. This changes what a *new* install
  > and a *restore into a fresh stack* look like. Note the restore drill in `docs/SETUP.md` §6
  > now starts from a genuinely empty board, which is the point.
  >
  > A `just dev` machine still comes up with the sample board. It is a development fixture, and
  > it is no longer something a real deployment inherits.
- **Address search biases towards your station, not towards Basel-Landschaft.** It matched the
  `home_city` setting against a hardcoded list of sixteen municipalities and fell back to a fixed
  Basel-region box for anything unrecognised — so every station outside that list had its address
  lookups quietly weighted towards a region it is nowhere near. The bias now comes from the
  `firestation_latitude` / `firestation_longitude` settings you already configure, and with no
  coordinates set the search stays unweighted rather than pointing somewhere wrong. Nominatim's
  country restriction is still Switzerland by default and can be overridden with a
  `geocoder_country_codes` setting, so a deployment across the border is a setting rather than a
  patch.

  > **Worth checking** if your address search has felt off: set the station's coordinates in the
  > settings surface.
- **`PUBLIC_URL` is now `CORS_ORIGINS`.** The variable was always passed to the backend as
  `CORS_ORIGINS`; the old name collided with KP Front's `PUBLIC_URL`, which means something else
  there (the base for absolute links in outbound webhooks). Copying one `.env` into the other
  therefore broke CORS with no error message anywhere. The new name is what the backend actually
  reads.

  > **No action required.** `PUBLIC_URL` is still accepted as a deprecated fallback; rename it
  > when you next touch the file.

### Fixed
- **`docs/SETUP.md` no longer teaches a configuration that does not exist.** The page a new
  station reads first still used `PUBLIC_URL` (renamed `CORS_ORIGINS` in this release), still
  said the alarm webhook secret could only be read out of the database, and still told you to
  check out and pin `v0.1.0` — the release whose print-agent endpoints accept any request when no
  token is set. It also promised a resource import without mentioning that the board now starts
  empty, so "empty" would have read as "broken".
- **The `training_locations` table no longer defaults new rows into one municipality.**
  `postal_code` defaulted to `4104` and `city` to `Oberwil` at the database level. Every writer
  already supplies both, so the defaults could only ever fire as a wrong answer. Existing rows
  are untouched.
- **Two stacks on one host no longer fight over port 443.** Caddy had it hard-coded, and KP
  Front's Caddy wants it too – so the second stack simply failed to start. The HTTPS host port is
  now `HTTPS_PORT`, matching the existing `HTTP_PORT`. Note it must be moved even when an outer
  reverse proxy never touches it, because this stack's Caddy publishes unconditionally: unlike KP
  Front's, it is deliberately *not* behind a compose profile, since nothing else here publishes a
  port at all. It is also not a way to run a second automatic-HTTPS setup – certificate issuance
  needs port 80 or 443 reachable from outside.
- **Assigning to a missing incident no longer 500s, and a missing resource no longer creates an
  orphan.** `POST /api/incidents/{id}/assign` with an incident id that no longer exists died on a
  foreign-key violation — a 500 for what is plainly a stale id. Worse, the *resource* was never
  checked at all: assigning a personnel id that does not exist returned 200 and stored the
  assignment anyway, leaving a row pointing at nothing and no error to explain it. Both are now
  404, matching the neighbouring endpoints.
- **The alarm webhook secret can be set from `.env`.** It could previously only be read back out
  of the database after first boot
  (`SELECT value FROM settings WHERE key = 'alarm_webhook_secret';`) – the one setup step that
  could not be scripted. `ALARM_WEBHOOK_SECRET` now wins over the stored value, so a deployment
  can be provisioned entirely from the file. Left blank, the previous behaviour is unchanged.
- **The generic alarm intake reserves the same `source` slugs as KP Front.** Both now reject the
  union of the two lists, so a station feeding one dispatch system into both apps can't pick a
  name that one accepts and the other rejects — a trap that only surfaced on the second
  integration.
- Dependency updates across the frontend, and the GitHub Actions used by CI.
- **The app can no longer get stuck in a state only a browser reset would clear.** A sweep for
  crashes and dead ends turned up several, all of which needed something no screen offered:
  - A corrupt value in browser storage crashed the app on **every** load. The read happened in a
    provider above every error boundary, so it produced an untranslated "Application error" with
    no way out – and because the bad value was saved, reloading (or restarting the browser)
    reproduced it. There is now a last-resort error screen with a **"Lokale Daten zurücksetzen"**
    action, and all storage reads validate what they find instead of trusting it.
  - On an installation served over plain **HTTP from a LAN address**, creating an Auftrag or
    assigning a resource to one silently did nothing: the browser only provides the id generator
    the code used over HTTPS or on localhost. The dialog's create button then stayed dead until
    the page was reloaded.
  - Visiting **Check-in** or the **Reko-Dashboard** and navigating back killed live updates for
    the rest of the session. Those pages closed a connection the whole app shares. Data kept
    flowing via background polling, so nothing looked wrong.
  - When the live connection gave up for good, the "Verbindung verloren" banner only reported it.
    It now has a **"Neu verbinden"** button; previously the sole cure was a page reload.
- **Wall displays recover on their own.** An error on an unattended `/display/*` screen used to
  leave a dead page with a button nobody was there to press. Displays now reload themselves after
  15s, then 30s, then 60s – backing off so a broken deploy can't turn every screen in the station
  into a retry loop against the backend. Applies to crashes in the page and in the app shell.
- **A shared command-post IP no longer locks out the crew.** Login was capped at 3 attempts per
  minute per IP and counted *successful* logins, so a few operators signing in together from
  behind the same NAT locked everyone out with nothing to do but wait. Brute-force protection is
  now per-username and counts only *failures* (5 → 5 minute lockout, cleared by a correct
  password), which is stricter against an attacker while honest operators can't exhaust each
  other's budget. Tunable via `LOGIN_RATE_LIMIT_PER_IP`, `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_FAILED_LOCKOUT_SECONDS` and `LOGIN_FAILED_WINDOW_SECONDS`.
- Development stack: the host and the backend container no longer share one `.venv`. Running
  `uv run` (or `just db migrate`) on the host used to recreate the virtualenv under the
  container's feet, flooding the reloader until the backend stopped responding and had to be
  restarted by hand.

## [0.1.0] – 2026-07-25

The first tagged release, and the first with **published container images**: self-hosting is a
`docker compose up -d` against `ghcr.io/feuerwehr-oberwil/kp-rueck-*` – no build toolchain on the
server. Everything below has been running in production; this is the point where it becomes
something another station can pin.

### Added
- **Published images on GHCR**, one per service and all released under the same version:
  `kp-rueck-backend`, `kp-rueck-frontend`, `kp-rueck-tileserver` and `kp-rueck-print-agent`
  (the print agent also for arm64, so it runs on a Raspberry Pi at the command post). CI builds,
  boots and smoke-tests the whole stack before a tag publishes. `docker-compose.yml` is now a
  **production** stack that pulls those images and puts the frontend and backend behind one
  origin; the hot-reload development stack stays in `docker-compose.dev.yml`. See
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- Aufträge (multi-stop group routing): batch several incidents into an ordered **route** for one
  squad to work through during a Flächenlage (storm/mass-incident wave). An Auftrag is a lightweight
  container over real incidents (`incident_groups` table + `incidents.group_id`/`group_position`),
  so each stop keeps its own status/reko/print/GPS. Build routes in the **Aufträge** footer sheet
  (inline create, drag cards in, derived `offen/läuft/erledigt` checklist, `+ Stop`) or the
  **Routen-Editor** modal / `/map` **Routenplanung** mode (click-to-add, drag-reorder, client-side
  nearest-neighbor optimize). Assign a squad once and **"auf alle Stops übernehmen"** – with a
  **`Squad` vs `Nur Fahrzeug` (Pendeldienst)** mode so a shuttle shares only the vehicle while crew
  stays per-incident. Routes draw as colored numbered polylines on the map, and GPS arrival
  auto-advance gains a nearest-single-match guard so clustered stops don't double-fire.
- Provider-neutral alarm intake: a generic `POST /api/alarms` webhook accepts alarms from **any**
  dispatch or alarm system – shared-secret auth, `(source, source_id)` idempotency, auto-attach
  to the active event, and fail-closed when no secret is configured. The native Divera adapter
  (`POST /api/divera/webhook`) and the token-gated phone/walk-in intake form feed the same pool.
  See [`docs/ALARM-INTEGRATIONS.md`](docs/ALARM-INTEGRATIONS.md).
- Integration capability registry: `GET /api/integrations` reports which provider is configured
  per area (alarm in, Ausalarmierung, personnel sync, vehicle GPS). The frontend renders provider
  names from this response instead of hard-coding them, and the generic webhook and intake form
  are always available.
- Provider-neutral outbound alerting (Ausalarmierung): a pluggable `send_alarm(...)` seam
  (`backend/app/services/alerting/`) with a `personnel_external_identities` table keying each
  person's identity per provider – a new provider is a module plus a registry entry.
- German i18n layer: `next-intl` infrastructure (cookie locale, `frontend/messages/de.json`
  catalog, outside-React helper) with UI, toast, and API-error strings extracted from hardcoded
  German – the groundwork for additional locales.
- GPS-driven status automation: silent-arrival (Rule A) and confirm-release (Rule B) rules move
  incidents by vehicle position (`backend/app/services/gps_automation.py`), running in training
  events too. Dwell is decoupled from fix freshness so parked trackers can still trigger.
- After-action PDF report and unified export: Einsatztagebuch, Reaktionszeiten, and Lageblatt
  chapters via `services/pdf_report_service.py`, exposed on the events page and user menu.
- Undo incident deletion: `POST /api/incidents/{id}/restore` with a "Rückgängig" toast.
- Persisted Kanban card order: `Incident.position` + `/incidents/reorder`, eliminating the
  drag snap-back flicker and making within-column reordering real.
- Ausfallsicherheit (paper fallback): a printable Lageblatt PDF, automatic thermal board
  snapshots, an outage SOP ([`docs/AUSFALL_SOP.md`](docs/AUSFALL_SOP.md)), and a startup
  checklist task.
- Reliability hardening for the public demo: audit-log retention sweep
  (`background/audit_cleanup.py`), a global exception handler with request IDs
  (`middleware/request_id.py`), endpoint hardening (admin-gated demo reset, `PRINT_AGENT_TOKEN`,
  WebSocket room auth), and per-session demo sandbox events (`POST /api/demo/sandbox`).
- Training mode depth: auto-generated incidents wired live, Divera intake drills, escalation
  injects, adjustable sim tempo, one-tap Rückfahrt, and simulated GPS drives from the
  Übungssteuerung – all isolated by the `training_flag`.
- QR walk-in print jobs and a generic `qr_code` job type for the thermal print agent.

### Changed
- The board sync path was reworked for robustness: serialized reorders, drag-aware reloads, WS
  recovery, single-commit status operations, and stale-reload discarding – debounced edits are no
  longer lost on tab close, and newer local changes are never clobbered by a late reload.
- Alembic is the single source of schema truth: `create_all` was dropped from boot, so the schema
  only ever changes through a migration.
- Onboarding resolved without a welcome card: shortcut discoverability is the ⌘K command palette
  (also `?`); the 409 conflict copy was softened to "Von anderer Person geändert".
- Blocking photo and Excel work moved off the event loop; driver reassignment and vehicle moves
  are now atomic.

### Fixed
- **Self-hosting outside Railway now actually works.** KP Rück had only ever been deployed to
  Railway, and that was baked into paths that looked platform-neutral. Found by building the
  images and booting the stack end to end:
  - The API proxy forced every redirect target to `https://` (a Railway-edge workaround), so
    against a plain-HTTP backend it attempted TLS on a cleartext port – and since the proxy
    appends a trailing slash, FastAPI's redirect made that the common path: `/backend-api/*`
    returned 502 for everything.
  - The live board never connected: the WebSocket URL applied Railway's
    `X.up.railway.app → X-api.up.railway.app` convention to *any* hostname with three or more
    labels, pointing at a host that doesn't exist. It now uses the deployment's own origin
    (and keeps `ws://` on a plain-HTTP LAN instead of forcing `wss://`).
  - Login was impossible on a trusted-LAN install: `Secure` cookies were forced on in
    production, and browsers drop those over plain HTTP, so signing in failed with no visible
    error. `AUTH_COOKIE_SECURE=false` is now a deliberate opt-out; unset still means secure.
  - Offline map tiles were requested from a hard-coded `localhost:8080`, which no browser on a
    deployment can reach; they now come from `/tiles` on the same origin.
  - The photo volume is mounted where the image actually prepares it, and the frontend health
    probe uses `127.0.0.1` instead of `localhost`, which resolves to IPv6 first while Next
    binds IPv4 only.
- The Divera webhook auto-attach never fails the ACK, and the member sync now counts created
  personnel correctly.
- `/incidents/sync-version` is no longer shadowed by the `/{incident_id}` route.
- A submitted Reko report can no longer silently revert to draft; users are informed whenever an
  action fails instead of a silent revert.
- Lost print jobs are requeued instead of being dropped forever.
- The shared editor account is no longer seeded in production.

_For the full running history before the first release, see the git log._

[Unreleased]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/feuerwehr-oberwil/kp-rueck/releases/tag/v0.1.0
