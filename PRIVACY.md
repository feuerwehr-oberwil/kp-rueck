# Privacy

KP Rück stores incidents, roster, vehicles, materials and audit records on **your** server.
Online map and address services and integrations can receive data when those features are
used, as described below. There is no licence check or usage beacon.

The error-reporting sections describe the channels through which a station can *choose* to
send a report to the maintainer. Since **the maintainer's ingest server was retired, the app
has no upstream destination at all** — the DSN that used to point at it is now empty, and a
fresh install has nowhere to send anything even if every switch were on. The only way
something reaches the maintainer today is that a person exports it and attaches it to an
e-mail. You can verify that with `tcpdump`, and several of the tests in this repository exist
to prove it stays true. Disabling telemetry does not disable the separate online services
below.

Separately, and unrelated to any installation, the project's public website has a contact form.
That is a website, not the app — see [The project website](#the-project-website) at the end.

## Online services and integrations

- **Address lookup:** the browser sends search text or selected coordinates to your backend.
  By default (`GEOCODING_PROVIDER=swisstopo`), the backend queries `api3.geo.admin.ch` for Swiss
  locations. With `nominatim`, it queries the self-hosted or permitted service you configure in
  `GEOCODING_NOMINATIM_URL`. That service receives the query or coordinates, the backend's public
  IP address and normal HTTP metadata. The backend does not forward browser cookies, login
  tokens or the device's IP address. Queries can reveal an incident location; do not include
  names, notes or other confidential text in address searches.
  Set `GEOCODING_PROVIDER=disabled` to turn off these online suggestions and reverse lookups.
  Manual address text, coordinates and map placement remain available. This setting does not
  disable online map tiles or other integrations.
- **Address lookup retention:** successful responses and their query keys use a bounded
  five-minute memory cache per backend process. The lookup service does not store queries in
  the database; its shared request budget stores only the next permitted request time.
  The configured provider and your hosting or proxy logs have their own retention policies.
- **Training samples:** seeding uses bundled sample locations without contacting an address
  provider. Production startup does not add these sample locations to a station's database.
- **Online maps:** the selected tile provider receives tile coordinates and request metadata.
  Tile coordinates identify the area being viewed. Locally hosted offline tiles avoid these
  external map requests when used without an online layer.
- **Configured integrations:** Microsoft sign-in, dispatch, tracking, synchronization and
  printing exchange the information needed for their functions with the configured systems.
  Their recipients and retention depend on the station's configuration.

The telemetry exclusions below apply to error reports sent to the maintainer. They are not
a claim that operational features never communicate with third parties.

## The short version

| | Problem melden | Automatische Fehlerberichte |
| --- | --- | --- |
| Who starts it | Anyone logged in, in **Einstellungen → Fehlerberichte** | The app, after a crash |
| Default | Always available | **Off** |
| Consent | Picking a route and sending it yourself | An admin switches it on |
| Can be disabled entirely | It never leaves on its own | Yes, `KP_TELEMETRY_ENABLED=0` |
| Content | The technical block, plus this server's sanitised crash traces since its last restart (the **Diagnose-Datei**, `GET /api/diag/export`) | A sanitised crash |
| Where it goes | Wherever the operator sends it — an e-mail, a GitHub issue — and nowhere else | **Nowhere**, unless a deployer set `KP_TELEMETRY_DSN` to an ingest of their own |

Both live in **Einstellungen → Fehlerberichte**.

The app used to have a **Senden** button that posted a report to the maintainer's ingest. It
went when the ingest did: a report queued for a destination that does not exist would sit in
your outbox forever while the card said «gesendet». The card now opens your mail client or a
GitHub issue form instead, and saves the Diagnose-Datei for you to attach — a human is the
transport.

## What is sent

Both channels send the same **context block** and nothing else besides it:

| Field | Example | Why |
| --- | --- | --- |
| `install` | `9f1c…` (random UUID) | So two reports from the same station are recognisably the same station |
| `app` | `kp-rueck` | Which of the two apps |
| `release` | `0.1.0` | The single most useful field in any bug report |
| `device` | `iPad Safari` | A rendering bug is usually a browser bug |
| `viewport` | `1024×768` | A layout bug is a viewport bug |
| `locale` | `de-CH` | Which message catalogue was active |
| `online` | `true` | Whether the client had a connection |

A background error report adds the exception type, a scrubbed message, a stack reduced to
function names and module basenames, and the route shape. The Diagnose-Datei carries those same
crash entries, and whatever the operator types goes in the mail or the issue, in their own
words, where they can read it before sending.

## What error-report telemetry excludes

Not "we try not to send" — these are constructed out of the payload and asserted by tests
(`backend/tests/test_telemetry_scrub.py`):

- **Incident data of any kind**: addresses, coordinates, incident IDs, Reko reports, danger
  flags, notes, photos, Divera payloads, WhatsApp message templates.
- **People**: roster names, functions, ranks, phone numbers, e-mail addresses, check-in state,
  user accounts, passwords.
- **Your instance**: hostname, station name, settings, database contents, file paths, usernames,
  environment variables, tokens, secrets, the Railway sync connection string.
- **Network identity**: no IP address is placed in the payload, and no `user` object exists for
  one to appear in later. See "The IP question" below — with no upstream left to contact, it is
  now a much shorter section than it used to be.
- **Screenshots and photos.** There is no code path that captures a screen, and the app carries
  no picture at all. If a photo helps, you attach it to your own mail or issue, where you can
  see exactly what you are attaching.

The payload is built by an **allow-list**: every field is named in
`backend/app/telemetry/scrub.py` and the caller's object is never forwarded, merged or spread.
A field nobody wrote a line of code for cannot leak. Free text is additionally scrubbed, because
the value is often *inside* the message — `TypeError … at Hauptstrasse 12` is a real shape.

`scrub.py` and the four modules around it are kept byte-identical to the copies in
[KP Front](https://github.com/feuerwehr-oberwil/kp-front), enforced by
`backend/tests/test_telemetry_vendored.py`. A rule tightened in one app and not the other would
mean one of them quietly leaks what the other strips.

## How to check, rather than trust

You do not have to take any of the above on faith:

1. **Your own log.** Every payload is written to your server's log in full, at `INFO`, *before*
   it is sent. Look for `telemetry: queuing … exact content follows`.
2. **Your own database.** The same payload stays verbatim in the `telemetry_outbox` table.
   `SELECT payload_json FROM telemetry_outbox;` is the whole story, before and after delivery.
3. **The settings page.** *Einstellungen → Fehlerberichte* shows the same rows, newest first, as
   formatted JSON.
4. **The Diagnose-Datei itself.** It is plain JSON, it is on your device, and it is the exact
   thing that would be attached — open it before you send it. The Fehlerberichte card also shows
   the technical block and the number of crash entries the file holds, before you decide.

## Where it goes

**Nowhere.** There is no maintainer-run ingest any more.

Until 2026 this app shipped with a public Sentry DSN pointing at `ingest.kp-front.ch`, a
GlitchTip instance run by the maintainer and shared with KP Front. That instance was retired —
it cost more to run than the handful of reports it received were worth, and every install that
had opted in belonged to the maintainer anyway. `KP_TELEMETRY_DSN` now defaults to the **empty
string**, which the forwarder reads as "off": an instance with a crash queued and consent
switched on still opens no connection, because it has no address to open one to.

What that leaves is a purely local arrangement. A crash is written to your log, held in a small
in-memory buffer on your server (`backend/app/telemetry/recent.py`, the last 50, cleared on
restart) and — if the background switch is on — kept verbatim in your `telemetry_outbox` table.
All three copies are yours. None of them moves on its own.

**If you want the machinery back, aim it at yourself.** Set `KP_TELEMETRY_DSN` to a GlitchTip or
Sentry you run and every part of this document applies again, with your server as the
destination. This is now the only supported configuration in which anything is transmitted
automatically at all.

**Retention:** the in-memory buffer holds the last 50 errors and is emptied by any restart.
Delivered rows in your own outbox are swept after 14 days (yours to change).

## Getting a bug report to the maintainer

Since nothing travels on its own, the route is deliberate and manual:

1. In the app, open **Einstellungen → Fehlerberichte** and describe what happened.
2. Read the technical block. It is shown in full, before you decide anything.
3. Pick a route — GitHub issue or e-mail — and click **Weiter**. The card saves the
   **Diagnose-Datei** (the sanitised crash traces from your server's buffer,
   `GET /api/diag/export`) and opens the route you picked. That file is the part that makes a
   report actionable; without it a bug report is a sentence.
4. Attach it to the [GitHub issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues/new?template=bug_report.yml)
   or to the e-mail (`bastian.eichenberger@feuerwehr-oberwil.ch`) that just opened.

You can open the file first — it is JSON, and it is the same content the app showed you.

## Your choices

- **Send no error reports.** Leave automatic reporting off and do not hand a report over.
  This does not disable online maps, address lookup or configured integrations.
- **Enforce it centrally.** Set `KP_TELEMETRY_ENABLED=0` in your compose file. This outranks the
  settings page, so no later click can turn it on.
- **Point it at yourself.** Set `KP_TELEMETRY_DSN` to your own GlitchTip and the same machinery
  reports to *your* server. This is the only setting under which anything is transmitted
  automatically at all; leaving it empty is the default and means nothing is.
- **Unlink your history.** *Einstellungen → Fehlerberichte → Neue Kennung* mints a fresh install
  UUID. Reports we already hold keep the old one and can no longer be connected to anything you
  send after.
- **Ask for deletion.** Mail the install UUID to bastian.eichenberger@feuerwehr-oberwil.ch and everything under
  it is deleted. You do not have to explain why.

## The IP question

It no longer arises for telemetry: with no ingest to contact, this app makes no request to the
maintainer from which an address could be read. If you point `KP_TELEMETRY_DSN` at a server of
your own, your instance's address is visible to *your* server, the same way it is to any host
you make a request of.

The manual routes are ordinary ones with the ordinary consequences: an e-mail carries your mail
provider's headers, and a GitHub issue is public and tied to your GitHub account. Both are
visible to you before you press send, which is the point of doing it this way.

## The project website

`kp-rueck.ch` is the project's landing page. It is **not** part of the software and has nothing
to do with your installation: it is a handful of static files on GitHub Pages, and nothing on it
talks to any station's server.

It carries one contact form (name, e-mail, message). Submitting it sends those three fields to
**staticforms.dev**, which forwards them to the maintainer by e-mail. Static hosting cannot
accept a form post, so a third party does that step. The service therefore processes what you
type, plus the usual request metadata a web server sees (including your IP address); its own
terms and retention apply, and we have no agreement with it beyond an ordinary account.

Three things follow, and they are the point of this section:

- **Using the form is entirely optional.** `bastian.eichenberger@feuerwehr-oberwil.ch` reaches the same person
  without a third party in between. The form exists because a `mailto:` link does nothing on a
  duty phone with no mail client configured — not because we prefer it.
- **It is a website visitor's data, never a station's.** No incident data, roster, audit trail or
  anything from a running instance is involved. A deployed KP Rück never contacts this service.
- **Self-hosters are unaffected.** The landing page is not shipped in any of the published images
  and is not served by the app. If you host this software, none of the above applies to your
  deployment.

## Legal

Your fire service is the data controller for everything in its instance. Switching on background
error reports makes the maintainer a recipient of the (sanitised, non-personal) data described
above. That decision belongs to the organisation, which is why the switch is admin-only and
deliberately kept out of the generic settings API that editors can reach — and why nothing is
enabled by an upgrade.

Questions, or a deletion request: **bastian.eichenberger@feuerwehr-oberwil.ch**.
