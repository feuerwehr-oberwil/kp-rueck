# Competitor landscape research — 2026-07-03

Deep-research session: 5 search angles, 22 sources fetched, 105 claims extracted,
top 25 adversarially verified (22 confirmed 3-0 or 2-1, 3 refuted).
Kept untracked for internal reference.

## TL;DR

There is no direct competitor doing exactly what KP Rück does (lightweight,
self-hosted digital magnet board for a Swiss volunteer brigade's rear command
post). Swiss products (WinFAP, Lodur, FLAME) are administration suites, not
tactical boards. Feature benchmarks are German Einsatzführungssoftware
(Fireboard, fireplan.elw, CommandX) and US incident command apps (Tablet
Command, Adashi C&C, First Due, D4H).

## Landscape overview

| Product | Positioning | Deployment | Pricing (where known) |
|---|---|---|---|
| Fireboard (DE) | Closest DACH analog; modular Einsatzführung (Einsatzleitung, Lagekarte, Atemschutz) | Windows desktop + cloud portal, offline-capable | Free Grundsystem, unlimited workstations (verified); Lagekarte module €600/seat one-time + €90/yr (unverified). Einsatztagebuch/Berichtswesen in the *free* tier could NOT be confirmed (claims refuted 0-3) |
| fireplan.elw (DE) | Browser-based ELW/command support: Einsatztagebuch, Abschnitte, Kräfteübersicht, Lagekarte | Web, works fully offline in the browser | — |
| CommandX / Eurocommand (DE) | Professional Einsatzleitung & crisis staff; Meldewesen for "gerichtsfeste Dokumentation"; ArcGIS Lagedarstellung; Betroffenenmanagement, Sonderlage, Objektverwaltung | On-prem web app; CommandX.SYNC keeps instances collaborating through connectivity loss | Enterprise |
| DIVERA 24/7 (DE) | Alerting & availability platform (our alarm integration) | Cloud + on-prem variant | FREE ≤50 users; ALARM €0.49/user/mo (min 10); PRO €0.99/user/mo (min 100); setup fees €149.99/€349.99 (unverified) |
| WinFAP (CH) | "Gesamtes Feuerwehr-Management" — admin: personnel/ranks/qualifications, material maintenance, Sold, budget | — | — |
| Lodur (CH) | Web admin: Mannschaft/Material/Abrechnung; no Alarmierung or Einsatzführung advertised | Web | — |
| FLAME (CH) | Brigade admin + an Einsatz module (Einsatzplanung, Alarmierung, Einsätze) with pre-stored data | — | — |
| Tablet Command (US) | Tablet-first tactical board; multi-agency mutual-aid sharing; CAD integration; preplans; TC Mobile alerting | Cloud + iPad | ~$675/user/yr circulated but that composite claim was refuted — don't cite |
| Adashi C&C (US) | Electronic tactical worksheet / IAP, annotate on maps/photos; SCBA air status, PAR, EVAC; NIMS ICS org chart | — | — |
| First Due (US) | Command module: drag-drop worksheet, Command/PAR/task timers with alerts, LogView live log, incident-type checklists, AAR report builder | SaaS, no offline | — |
| D4H (int'l) | Incident management: audit-trail logging, auto situation/after-action reports, ICS forms + Form Builder, offline single-user mode with re-sync | Cloud + mobile | — |
| Sahana SAFIRE (OSS) | Open-source ICS/EOC platform, ICS-principles model, not a board | Self-hosted | Free |

Context: DHS SAVER report (Jan 2022) surveyed 38 commercial incident-management
products; map-based info sharing, vehicle tracking, collaboration, and **event
logging** are baseline market features.

## Gap list (as researched, before scope decisions)

1. **Einsatztagebuch + report export** — universal across competitors. → ADOPTED as todo (docs/TODO.md); audit_log/status_transitions already hold the data, needs display + PDF/thermal export.
2. Lagekarte with taktische Zeichen — → RULED OUT 2026-07-03 (not our use case). If ever revisited: MIT building blocks exist — github.com/jonas-koeritz/Taktische-Zeichen (SVG set) and github.com/phjardas/taktische-zeichen (DV-102 generator, React package, active as of Nov 2025).
3. Timers / Atemschutzüberwachung — → RULED OUT.
4. Whole-app offline resilience — → DECIDED: local Docker mirror + LAN switch, not offline-first PWA. PWA-only makes each device a diverging island (no server = no multi-user sync) and doesn't cover print agent/Divera; mirror keeps everything working. Remaining work is operational (pg_dump restore routine, fixed LAN address, SOP line).
5. Alarm receiving / availability — Divera offers bidirectional Leitstellen interfaces, availability capture, alarm monitors. Outbound already shipped; inbound auto-create from webhook is the open half if ever wanted.
6. Pre-planning (Objektverwaltung, hydrants, checklists, Abschnitte) — → RULED OUT.
7. After-action replay (Fireboard "Lagefilm") — → RULED OUT.
8. Multi-agency sharing, deep personnel admin — low priority / admin-suite territory.

## Durable facts worth remembering

- **Swiss market gap is real**: no Swiss product offers a live tactical KP board; the German ones that do are Windows-heavy (Fireboard) or enterprise (CommandX). Useful framing for the 118-magazine article and any "offer it to other brigades" question.
- **Divera API tiers** (unverified, from divera247.com/version-vergleichen.html): API rate-limited on FREE tier to ~1 trigger per 5 minutes, unlimited on ALARM/PRO; vehicle status transmitters 6/10/50 by tier; integrations incl. MQTT, webhooks, Fireboard, TETRAcontrol. If our alarm endpoint ever misbehaves under FREE, check the rate limit first.
- **Refuted claims** (do not repeat): Fireboard free tier includes full Einsatztagebuch; Fireboard free tier auto-generates reports; Tablet Command $675/user/yr composite claim.

## Primary sources

- https://fireboard.net/produkte/ · /module/grundsystem/ · /module/modul-lagekarte/ · /module/modul-atemschutzueberwachung/
- https://www.eurocommand.com/produkte/commandx
- https://www.fireplan.de/elw
- https://www.codx.ch/cms/WinFAP · https://www.lodur.ch/ · https://flame-swiss.ch/
- https://www.divera247.com/ · /funktionen/organisation/einsatzberichte · /version-vergleichen.html
- https://www.tabletcommand.com/incident-management-software
- https://www.versaterm.com/solution/adashi-cc/
- https://www.firstdue.com/products/command
- https://www.d4h.com/products/incident-management-software
- https://www.dhs.gov/sites/default/files/2022-01/SAVER%20IMS%20MSR_05Jan2022-508.pdf
- https://github.com/jonas-koeritz/Taktische-Zeichen · https://github.com/phjardas/taktische-zeichen
- https://sahanafoundation.org/safire/
