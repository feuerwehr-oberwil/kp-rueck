# Running KP Front and KP Rück on one host

Some stations run both: **KP Front** at the incident (the tactical picture on a tablet) and
**KP Rück** in the command post (the board behind it). This page is for the person who has to
put both on the same Docker host without them fighting each other.

**The two systems are independent.** Separate databases, separate images, separate releases, no
shared library and no runtime coupling – neither one calls the other, and either runs perfectly
well without the other. Nothing here is about making them talk. It is about the three places
where two otherwise-unrelated stacks collide on one machine: **host ports**, **environment
variable names that mean different things**, and **alarm intake secrets**.

If you run only one of the two, you can ignore this entire page.

**Sizing:** both stacks together fit in **4 GB of RAM** and are comfortable in 8 GB – KP Rück
is the larger of the two (see [`DEPLOYMENT.md`](DEPLOYMENT.md) §0), KP Front roughly half
that. Neither is CPU-bound. The machine is not what makes running both awkward; the three
collisions below are.

> **This is the canonical copy, and it is linked from the kp-front repository** (its README,
> its docs index, and its `.env.example`) rather than duplicated there – a second copy would
> drift, and half-right instructions about a silent port collision are worse than none. Edit it
> here; there is nothing to keep in step on the other side.

---

## 1. Ports: only one stack can own 443

Both stacks ship a Caddy that wants port 443, and the second one to start simply fails to bind.
The fix is to stop asking either of them to be the public entrance and put **one reverse proxy**
in front of both.

Recommended layout for two public domains on one host:

| What | Owns | Notes |
| --- | --- | --- |
| Your reverse proxy | `80`, `443` | Terminates TLS for both domains, forwards to the two plain-HTTP ports below. Caddy, nginx, Traefik – whatever you already run. |
| KP Front | `APP_PORT` (default `8000`) | Run it **without** `--profile tls`. Its Caddy is optional and only exists for the standalone case; the base stack publishes the app directly. |
| KP Rück | `HTTP_PORT` (default `8080`) | Leave `DOMAIN` empty so its Caddy serves plain HTTP on `:80` internally. Set `HTTPS_PORT` to a free port (see below). |

```bash
# KP Rück .env
DOMAIN=                            # empty: the outer proxy terminates TLS, Caddy stays plain HTTP
HTTP_PORT=8080                     # what your reverse proxy forwards to
HTTPS_PORT=8443                    # NOT 443 – see the warning below
CORS_ORIGINS=https://rueck.example.org   # the URL BROWSERS use, not http://127.0.0.1:8080
AUTH_COOKIE_SECURE=                # leave blank; CORS_ORIGINS above already answers this
```

```bash
# KP Front .env
APP_PORT=8000            # what your reverse proxy forwards to
DOMAIN=                  # unused without --profile tls
```

> **`CORS_ORIGINS` is the browser's address, not the proxy's target.** This is the line people
> fill in wrongly behind an outer proxy, because `http://127.0.0.1:8080` is the address they
> were just typing into the proxy config. It is not what the browser sees, and `CORS_ORIGINS`
> is load-bearing twice over: it is the allowed CORS origin *and* the value the backend reads
> to decide whether the login cookie carries the `Secure` flag. Put the plain-HTTP forwarding
> address in it and you get an `https://` board whose API calls are all refused, and a login
> cookie sent without `Secure` over a connection that has TLS. Write the name people type.

> **`HTTPS_PORT` must be changed even when unused.** KP Rück's Caddy publishes it
> unconditionally – it is the single origin the Caddyfile routes and is deliberately *not*
> behind a compose profile, because gating it would leave the stack with nothing published at
> all. So even behind an outer proxy that never touches it, leaving `HTTPS_PORT=443` keeps the
> binding and the collision. Point it somewhere free.

> **`HTTPS_PORT` is not a second automatic-HTTPS setup.** Caddy's certificate flow needs to be
> reachable from the public internet on `80` (HTTP-01) or `443` (TLS-ALPN). Moved to `8443`, it
> cannot get its own certificate. This knob is for *getting out of the way* of whatever owns
> 443, not for running two ACME clients side by side.

**Keeping it simpler:** if only one of the two is published and the other stays on the LAN, skip
the outer proxy. Let the public one keep `DOMAIN` and 80/443, and move the other onto plain
high ports.

Plain HTTP is where the login cookie becomes a question – a browser silently drops a `Secure`
cookie over `http://`, so signing in fails with no error anywhere. **The two systems answer it
differently now, and that is the point:**

```bash
# KP Rück on the LAN – nothing extra. Say where browsers reach it and you are done.
CORS_ORIGINS=http://192.168.1.50:8080
AUTH_COOKIE_SECURE=            # leave blank
```

```bash
# KP Front on the LAN – still needs the switch, explicitly.
COOKIE_SECURE=false
```

KP Rück's backend reads `CORS_ORIGINS`, sees a plain-`http://` origin, and drops the `Secure`
flag by itself, saying so in the boot log. `AUTH_COOKIE_SECURE` survives only as an explicit
override in either direction. KP Front has no such inference: `COOKIE_SECURE=false` is the real
switch there, and its own `scripts/setup.sh --lan` writes it for you.

> **This page used to tell you to set both**, as if `AUTH_COOKIE_SECURE=false` and
> `COOKIE_SECURE=false` were the same instruction spelled two ways. Since 0.2 that advice is
> actively harmful on the KP Rück side: a hand-written `false` keeps sending the login cookie
> in the clear on the day the station puts a domain in front, because the origin becomes
> `https://` and the inference that would have followed it is pinned. The two variables no
> longer do the same job, so they no longer take the same value. If you have
> `AUTH_COOKIE_SECURE=false` in a KP Rück `.env` from an earlier install, blank it.

---

## 2. `PUBLIC_URL` means two different things

This one breaks things silently, and it bites exactly the person who is being careful – copying
a working `.env` from one stack to the other as a starting point.

| Variable | In KP Rück | In KP Front |
| --- | --- | --- |
| `PUBLIC_URL` | The deployment's own URL, passed to the backend as the **allowed CORS origin**. | The public origin used as the base for **absolute links in outbound incident webhooks**. Nothing to do with CORS. |

Same name, unrelated jobs. Cross-copy the value and KP Rück's CORS origin becomes KP Front's
address – the browser starts refusing API calls, with no message in the app and nothing obvious
in the logs.

**As of 0.2 KP Rück's variable is called `CORS_ORIGINS`**, which is what the backend reads
anyway. `PUBLIC_URL` is still accepted as a fallback so existing installations keep working, but
rename it when you touch the file:

```bash
# KP Rück .env
CORS_ORIGINS=https://rueck.example.org     # was PUBLIC_URL
```

```bash
# KP Front .env
PUBLIC_URL=https://front.example.org       # unchanged meaning, different purpose
```

Set each to **its own** stack's public URL. They are never the same value.

---

## 3. Alarm intake: two secrets, two contracts

Both systems accept `POST /api/alarms` from a dispatch system. They are **not** the same
endpoint and must be configured separately.

**Separate secrets.** `ALARM_WEBHOOK_SECRET` is per deployment. Generate one for each; do not
share a value between the two stacks:

```bash
openssl rand -hex 24     # once per stack
```

In KP Rück the secret can now be set in `.env` and **wins over the database value**, so a
deployment can be provisioned entirely from the file. Left blank, the old behaviour stands: one
is auto-generated on first boot and has to be read back out with
`SELECT value FROM settings WHERE key = 'alarm_webhook_secret';`. KP Front has always taken it
from the environment.

**The payloads differ.** The two contracts overlap but are not interchangeable – a body one
accepts, the other may reject:

| | KP Rück | KP Front |
| --- | --- | --- |
| `source_id` | optional | **required** |
| `source` | ≤ 20 chars | ≤ 16 chars |
| Extra fields | `number` | `type`, `priority` (`HIGH`/`LOW`), `started_at` |

Configure your dispatch system with **one webhook per system**, each against its own URL, secret
and payload. Do not point one webhook at both and expect parity. Each system's intake is
documented in its own `docs/ALARM-INTEGRATIONS.md` (in each repository).

---

## 4. What does *not* collide

Worth stating, so you don't go looking for problems that aren't there:

- **Databases.** Each stack runs its own Postgres in its own compose project, on no published
  port. Different default `POSTGRES_USER`/`POSTGRES_DB`, and they never see each other.
- **Compose projects.** Two directories means two project names, so container names, networks
  and volumes are already namespaced. Nothing to rename.
- **Secrets other than the alarm one.** `SECRET_KEY`, `AUTH_SECRET_KEY`, database passwords,
  Divera and Traccar credentials – per stack, no coordination needed. (Both may legitimately use
  the *same* Divera access key; that is a Divera account detail, not a collision.)
- **Login.** KP Front authenticates with a station PIN, KP Rück with accounts (and optionally
  Entra SSO). Different models on purpose; there is no shared session.
- **The alarm keyword vocabulary.** Both ship the same list of German alarm words
  (`backend/app/data/alarm_keywords.json`) so an alert classifies the same way in both. It is
  **vendored, not shared**: a byte-identical copy in each repository, kept in step by a CI job
  that diffs them – no package, no import, still no runtime coupling. Nothing to install and
  nothing to point at the other stack. If your dispatch words are not these, override them per
  deployment (KP Front: `alarmKeywords` in the deployment config) rather than editing the file –
  editing it puts your build at odds with the copy in the other repository.
- **Printing.** There is **one** agent for both systems, so this is not duplicated work either.
  Give it a `backends` list with one entry per system and run a single service; it speaks each
  system's protocol and drives each kind of printer. See
  [kp-rueck `tools/print-agent/`](https://github.com/feuerwehr-oberwil/kp-rueck/tree/main/tools/print-agent).

  > ⚠️ If you are migrating from the two separate agents, **stop the old ones first**. Two
  > agents polling one queue both claim jobs, and each job then prints once, from whichever
  > asked first – prints that "sometimes don't arrive" while both logs look healthy.

---

## 5. The environment-variable mapping

The two projects grew separately and name some identical concepts differently. These are **not**
collisions – nothing breaks – but if you keep both `.env` files open you will reach for the
wrong name. Only `PUBLIC_URL` (§2) was actually dangerous, and that one is fixed; the rest is a
translation table – with one row that is *not* a translation, because the two variables stopped
meaning the same thing (the cookie row below, and §1).

| Concept | KP Front | KP Rück |
| --- | --- | --- |
| Signing secret | `SECRET_KEY` | `AUTH_SECRET_KEY` signs logins, `SECRET_KEY` is the app secret |
| Plain-HTTP login cookie | `COOKIE_SECURE=false` – the switch, and you have to set it | `AUTH_COOKIE_SECURE` – an override only; derived from `CORS_ORIGINS`, leave blank (§1) |
| Host HTTP port | `APP_PORT` (the app publishes it) | `HTTP_PORT` (Caddy publishes it) |
| Host HTTPS port | fixed `443`, only with `--profile tls` | `HTTPS_PORT` |
| Allowed CORS origin | *not configurable – same origin* | `CORS_ORIGINS` |
| Base for outbound webhook links | `PUBLIC_URL` | *not applicable* |
| Print-agent shared secret | `PRINT_AGENT_SECRET` | `PRINT_AGENT_TOKEN` |
| First login | `SEED_DATABASE` seeds a PIN user | `ADMIN_SEED_PASSWORD` + `VIEWER_PASSWORD` |
| Image tag pin | `KP_FRONT_TAG` | `KP_RUECK_TAG` |

**Identical in both, and safe to reuse the same value:** `POSTGRES_PASSWORD`, `POSTGRES_USER`,
`POSTGRES_DB` (per stack, but the same names), `DOMAIN`, `DIVERA_ACCESS_KEY`, `TRACCAR_URL`,
`TRACCAR_EMAIL`, `TRACCAR_PASSWORD`, `KP_TELEMETRY_ENABLED`, `KP_TELEMETRY_DSN`.

One Divera access key in both is fine and expected – they poll the same account. It does **not**
make the two systems share anything: each keeps its own roster copy, and there is no bridge
between them (they already agree on person identity because both derive it from the same Divera
`pull/all` keys).

`ALARM_WEBHOOK_SECRET` has the same name in both and must hold **different** values – see §3.

---

## 6. Checklist

Before you start the second stack:

- [ ] One reverse proxy owns `80`/`443`; neither stack does.
- [ ] KP Front runs **without** `--profile tls`; `APP_PORT` is free.
- [ ] KP Rück's `HTTP_PORT` **and** `HTTPS_PORT` are both free – `HTTPS_PORT` is not `443`.
- [ ] `CORS_ORIGINS` (KP Rück) and `PUBLIC_URL` (KP Front) each point at their **own** stack –
      and `CORS_ORIGINS` holds the URL *browsers* use, not the address an outer proxy forwards to.
- [ ] `AUTH_COOKIE_SECURE` is **blank** in the KP Rück `.env`; if KP Front is on plain HTTP, its
      `COOKIE_SECURE=false` is set.
- [ ] `ALARM_WEBHOOK_SECRET` is a **different** value in each `.env`.
- [ ] The dispatch system has a separate webhook per stack, each with its own payload shape.
- [ ] `docker compose up -d` on the second stack, then confirm the **first** one is still
      answering. A port collision shows up as a container that won't start; a CORS mistake only
      shows up in the browser.

---

*This file lives **once**, here in kp-rueck; the kp-front repository links to it rather than
keeping a second copy that would drift. A station hits these problems before it knows which
repository to look in, so both READMEs point at this page.*
