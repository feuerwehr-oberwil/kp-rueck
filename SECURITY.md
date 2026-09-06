# Security Policy

KP Rück is a tactical operations board for a fire-service command post. It holds operational
incident data and a personnel roster, so we take security seriously and welcome responsible
disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via one of:

- A **GitHub private security advisory** ([Security → Report a
  vulnerability](https://github.com/feuerwehr-oberwil/kp-rueck/security/advisories)).
- **Email:** bastian@eichenbergers.ch – the maintainer's stable address, also for reporters
  without a GitHub account.

Please include a description, reproduction steps, affected version/commit, and any impact
assessment. We aim to acknowledge reports promptly and will keep you informed as we investigate
and fix. This is a small project with one maintainer, so please don't read silence as
indifference – send a reminder.

Please don't share details publicly before a fix is available. We will credit you in the release
notes unless you prefer to stay anonymous.

## Supported versions

KP Rück is under active development; security fixes land on `main`. Self-hosters should track
the latest tagged release and update promptly – see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

| Version | Supported |
| --- | --- |
| latest release / `main` | ✅ |
| older tags | ❌ (please update) |

## Security model

- **Auth:** username + password. Passwords are hashed with **bcrypt** (cost 12) and are never
  stored or logged in plaintext. Optional **Microsoft Entra ID** sign-in for deployments that
  have it; without it, local accounts are the only path.
- **Sessions:** short-lived JWT access tokens + refresh tokens delivered as **httpOnly cookies**
  (Secure by default; `AUTH_COOKIE_SECURE=false` exists only for plain-HTTP LAN deployments),
  with a server-side blocklist for revocation. Access and socket credentials issued or renewed
  by this version share their refresh token's session family, so logout also revokes earlier
  access tokens from the same login. This security upgrade performs a one-time credential
  reset: earlier access, refresh and socket tokens are rejected, so users must sign in again.
  Later routine upgrades retain the credential version and do not repeat the reset.
  An admin password reset or account deactivation revokes that account's existing access,
  refresh and socket sessions. Rotating `VIEWER_PASSWORD` through a redeploy does the same
  for the viewer account; restarting with the same password preserves its sessions.
- **Brute-force protection:** login failures are counted **per username**, not per IP, so
  several operators behind one command-post NAT cannot exhaust each other's budget while an
  attacker still faces a lockout. Tunable via `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_FAILED_LOCKOUT_SECONDS`, `LOGIN_FAILED_WINDOW_SECONDS` and `LOGIN_RATE_LIMIT_PER_IP`.
- **Roles:** `admin`, `editor` (full CRUD) and `viewer` (read-only), enforced in the database by
  a check constraint. Under Entra ID sign-in, editor is an **explicit grant** via
  `SSO_EDITOR_ALLOWLIST` – any tenant member can reach the login, so membership alone provisions
  a viewer and nothing more.
- **Live updates require a login.** The Socket.IO connection is rejected without a valid session
  cookie or a session-bound handshake token (`WS_REQUIRE_AUTH`, default on since 0.2; it defaulted **off** before that, so anything
  able to reach `/socket.io` could subscribe to live incident broadcasts). The CORS origin
  whitelist is not the control here – CORS is enforced by browsers, and a script that omits
  `Origin` is not a browser. Delivery rechecks account status, current role, session expiry
  and revocation. Keep `WS_REQUIRE_AUTH=true`; disabling it permits anonymous live updates.
  If a socket cannot connect, the browser falls back to polling.
- **Microsoft login transactions** are bound to a short-lived browser cookie, consumed once,
  and protected with PKCE and an ID-token nonce. Username prefixes never link an external
  identity to an existing account. An exact email match links to the existing local account;
  unmatched accounts receive the role described above. Administrators control the local email
  address and the configured Entra tenant's account lifecycle.
- **Field credentials** have separate poster, five-minute single-use person-picker and
  person-bound device stages. Device logout revokes newly issued Reko child credentials too.
  The upgrade migration revokes existing device and person-picker claims once. Printed
  poster links still work: enter the Feld-Code again and select a person. All earlier Reko
  form links are rejected; create a new link from the board or the field surface. Reports,
  photos and their associations are preserved and remain accessible through the board.
  Keep Reko form links and photo URLs private: both contain the form's read/write credential.
  Share downloaded image files when only a photo should be shared.
- **A bypass token exists and is off.** `MASTER_TOKEN` allows API access without a login, for
  scripted configuration. Empty by default, which disables it. If you set it, treat it as a
  password equivalent: it is not scoped to a user and does not attribute actions to one in the
  audit trail.
- **Single-tenant:** one deployment = one station. Everything is served through one origin
  (Caddy in front of frontend, backend and tileserver); `CORS_ORIGINS` is the single allowed
  CORS origin. Online maps receive browser requests; address lookup goes through the backend
  to the configured provider. Integrations also exchange data. See [`PRIVACY.md`](PRIVACY.md)
  for those separate flows.
  Use HTTPS outside a trusted LAN, including internet-facing `NEXT_PUBLIC_API_URL` overrides
  in source builds. Plain HTTP exposes credentials and incident data to network observers.
- **Address lookup** requires a current board login or a live, person-bound field claim.
  The provider is configured by the operator; callers cannot choose an upstream URL.
  Requests share a database-backed dispatch budget across backend workers, have time and
  response-size limits, and do not follow redirects. The default is swisstopo; a self-hosted
  or permitted Nominatim service is optional. The public `nominatim.openstreetmap.org` endpoint
  is rejected as a configuration value. Set `GEOCODING_PROVIDER=disabled` to disable lookup.
- **Fail-closed integrations:** the generic alarm webhook and the print-agent endpoints reject
  everything until their shared secret is set. The alarm webhook secret can be set in the
  environment (which wins) or, left blank, is generated into the database on first boot.
- **The audit trail is kept, not expired.** `AUDIT_RETENTION_DAYS` defaults to `0` – keep
  everything. Before 0.2 it defaulted to 90 days and swept silently, so a deployment older than
  three months had already lost the trail for its earliest operations.
- **Deployment secrets:** `SECRET_KEY`, `AUTH_SECRET_KEY` and `POSTGRES_PASSWORD` belong in
  environment configuration, never in the repo. Some integration secrets can also be stored
  in the database, so database backups need the same protection. Self-hosters **must set strong,
  stable `SECRET_KEY` and `AUTH_SECRET_KEY` values** (≥32 chars, e.g. `openssl rand -hex 32`) –
  rotating either invalidates every session.
- **One credential *is* in the repo, deliberately:** the telemetry DSN in
  `backend/app/telemetry/dsn.py`. It is a Sentry **public key** – write-only by
  construction, able to submit an event and nothing else. It cannot read stored events,
  reach another project, or authenticate to anything. It is in the clear so that an auditor
  grepping this repository finds it and can rule it out in thirty seconds, rather than
  finding it hidden behind an env var and wondering. If you would rather it did not exist
  on your instance, set `KP_TELEMETRY_ENABLED=0` – see [`PRIVACY.md`](PRIVACY.md).

## Known gaps

Stated deliberately, because a security policy that only lists strengths is not useful:

- External identity is **Microsoft Entra only**; there is no generic OIDC path.
- CI blocks on Bandit, dependency advisories and the clean mypy package subset. The remaining
  mypy check is advisory – see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Out of scope

- Vulnerabilities in third-party dependencies – please report those to their maintainers
  (though we do want to hear if we are pinned to something vulnerable).
- Issues that only affect the public demo instance or a development environment.
- Social engineering.

## Data protection

KP Rück holds operational incident data and a personnel roster. **Self-hosters are the data
controllers** for their deployment:

- Each station runs its own instance and database. Review the external data flows in
  [`PRIVACY.md`](PRIVACY.md) when configuring online features and integrations.
- Keep the secrets and the database/photo volume secure and backed up (see
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §6).
- **Per-station data is not in this repo** – rosters, branding and credentials live outside it
  and must never be committed.
- **Online services and error reports are separate controls.** Address lookup uses swisstopo
  by default and online maps contact their selected tile provider. There is no licence check
  or usage beacon. The two channels for reporting problems to the maintainer are off or manual
  by default. [`PRIVACY.md`](PRIVACY.md) describes each data flow and how to disable it.
- If you process personal or operational data, follow your canton's data-protection (DSG)
  guidance.
