# Privacy

KP Rück stores incidents, roster, vehicles, materials and audit records on **your** server.
Online map and address services and integrations can receive data when those features are
used, as described below. There is no licence check or usage beacon.

The error-reporting sections describe two channels through which a station can *choose* to
send a report to the maintainer. Both are off or manual by default. Disabling telemetry does
not disable the separate online services below.

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
| Who starts it | Anyone logged in, by pressing **Senden** | The app, after a crash |
| Default | Always available | **Off** |
| Consent | Pressing the button | An admin switches it on |
| Where | Einstellungen → Fehlerberichte | Same page, admin-only half |
| Can be disabled entirely | Yes, `KP_TELEMETRY_ENABLED=0` | Yes, same variable |

Both live in **Einstellungen → Fehlerberichte**.

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

A manual report adds the text the operator typed. A background error report adds the exception
type, a scrubbed message, a stack reduced to function names and module basenames, and the route
shape.

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
  one to appear in later. See "The IP question" below for the part we cannot solve in code.
- **Screenshots.** There is no code path that captures one.

The payload is built by an **allow-list**: every field is named in
`backend/app/telemetry/scrub.py` and the caller's object is never forwarded, merged or spread.
A field nobody wrote a line of code for cannot leak. Free text is additionally scrubbed, because
the value is often *inside* the message — `TypeError … at Hauptstrasse 12` is a real shape.

`scrub.py` and the three modules around it are kept byte-identical to the copies in
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
4. **The manual report** tells you what it collects before you send, and shows you what the
   server says it actually queued afterwards.

## Where it goes

To `ingest.kp-front.ch`, a GlitchTip instance run by the maintainer — the same host KP Front
reports to, but a separate project, so one app's quota can never silence the other. GlitchTip
is an open-source, Sentry-compatible error tracker.

It runs in its own Railway project, with its own database, sharing nothing with the KP Rück or
KP Front deployments. The honest limit of that: same provider, same account, so this is
project-level isolation rather than host-level. Its configuration (rate limits, IP stripping,
retention) is checked in at
[`deploy/ingest/`](https://github.com/feuerwehr-oberwil/kp-front/tree/main/deploy/ingest) in the
KP Front repository.

The credential embedded in this repository (`backend/app/telemetry/dsn.py`) is a Sentry **public
key**. It is write-only by construction: it can submit an event and nothing else — it cannot
read stored events, cannot reach another project, and cannot log in. It is checked in in the
clear deliberately, so that anyone auditing this repository finds it and can satisfy themselves
in thirty seconds that it does not read their data.

**Retention:** reports are kept for 90 days and then deleted. Delivered rows in your own outbox
are swept after 14 days (yours to change).

## Your choices

- **Send no error reports.** Leave automatic reporting off and do not submit a manual report.
  This does not disable online maps, address lookup or configured integrations.
- **Enforce it centrally.** Set `KP_TELEMETRY_ENABLED=0` in your compose file. This outranks the
  settings page, so no later click can turn it on.
- **Point it at yourself.** Set `KP_TELEMETRY_DSN` to your own GlitchTip and the same machinery
  reports to *your* server. We never hear from you.
- **Unlink your history.** *Einstellungen → Fehlerberichte → Neue Kennung* mints a fresh install
  UUID. Reports we already hold keep the old one and can no longer be connected to anything you
  send after.
- **Ask for deletion.** Mail the install UUID to bastian@eichenbergers.ch and everything under
  it is deleted. You do not have to explain why.

## The IP question

Your server's IP address is visible to our ingest host, the same way it is visible to any server
you make a request to. We do not put it in the payload, the reverse proxy in front of the ingest
strips `X-Forwarded-For` and friends before the request reaches GlitchTip, and its access log is
configured to drop the remote address. That configuration is checked in — read
[`deploy/ingest/railway/Caddyfile`](https://github.com/feuerwehr-oberwil/kp-front/blob/main/deploy/ingest/railway/Caddyfile)
in the KP Front repository rather than believing this paragraph.

What you *cannot* verify from here is that the running instance matches the checked-in config,
or what the hosting platform logs at its own edge. That is exactly why
`KP_TELEMETRY_ENABLED=0` exists and why the default is off. If your threat model includes the
maintainer's own infrastructure, do not switch this on — that is a legitimate position and the
app is fully functional without it.

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

- **Using the form is entirely optional.** `bastian@eichenbergers.ch` reaches the same person
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

Questions, or a deletion request: **bastian@eichenbergers.ch**.
