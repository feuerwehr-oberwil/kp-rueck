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
  with a server-side blocklist for revocation.
- **Brute-force protection:** login failures are counted **per username**, not per IP, so
  several operators behind one command-post NAT cannot exhaust each other's budget while an
  attacker still faces a lockout. Tunable via `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_FAILED_LOCKOUT_SECONDS`, `LOGIN_FAILED_WINDOW_SECONDS` and `LOGIN_RATE_LIMIT_PER_IP`.
- **Roles:** `admin`, `editor` (full CRUD) and `viewer` (read-only), enforced in the database by
  a check constraint.
- **Single-tenant:** one deployment = one station. Everything is served through one origin
  (Caddy in front of frontend, backend and tileserver); `PUBLIC_URL` is the single allowed CORS
  origin. The backend is also the only component that reaches external services (Divera,
  Traccar), so the browser never talks to a third party.
- **Fail-closed integrations:** the generic alarm webhook and the print-agent endpoints reject
  everything until their shared secret is set. The alarm webhook secret is generated into the
  database on first boot, not read from the environment.
- **Secrets in env only:** `SECRET_KEY`, `AUTH_SECRET_KEY`, `POSTGRES_PASSWORD` and integration
  credentials live in environment variables and **never** in the repo. The database stores
  integration *selection and behaviour*, never credentials. Self-hosters **must set strong,
  stable `SECRET_KEY` and `AUTH_SECRET_KEY` values** (≥32 chars, e.g. `openssl rand -hex 32`) –
  rotating either invalidates every session.

## Known gaps

Stated deliberately, because a security policy that only lists strengths is not useful:

- External identity is **Microsoft Entra only**; there is no generic OIDC path.
- Static analysis (`mypy`, `bandit`) runs in CI but is **advisory, not blocking** – see the note
  at the top of [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the current counts.

## Out of scope

- Vulnerabilities in third-party dependencies – please report those to their maintainers
  (though we do want to hear if we are pinned to something vulnerable).
- Issues that only affect the public demo instance or a development environment.
- Social engineering.

## Data protection

KP Rück holds operational incident data and a personnel roster. **Self-hosters are the data
controllers** for their deployment:

- Each station runs its own isolated instance and database – all of your station's data stays in
  your DB (a strong story for cantonal data-protection / DSG compliance).
- Keep the secrets and the database/photo volume secure and backed up (see
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §6).
- **Per-station data is not in this repo** – rosters, branding and credentials live outside it
  and must never be committed.
- If you process personal or operational data, follow your canton's data-protection (DSG)
  guidance.
