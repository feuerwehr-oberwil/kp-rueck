# Standby box for a hosted board

A board hosted on Railway is gone the moment the station loses its internet connection
([`AUSFALL_SOP.md`](AUSFALL_SOP.md), table B). A compose stack in the Magazin keeps running on
the LAN, but only if it already holds the board. The standby box does: it **mirrors the hosted
database live** (Postgres logical replication), so it holds every Ereignis, every Einsatz, the
roster and the photos, seconds behind the hosted board.

The mirror's board is **look-only**. When it is needed, somebody opens the Ereignis on the box
and takes it **offline**: from then on the box **leads** that Ereignis. Its work goes to the
hosted board by itself whenever that answers – also after an outage, the moment the internet is
back – and the hosted board shows it live. Every other Ereignis, every new one and the roster
keep mirroring.

**One system leads an Ereignis at a time, and the lead is taken, never handed over:** the side
that carries on presses the button – «Dieses Ereignis offline übernehmen» on the box, «Hier
übernehmen» on the hosted board – as often as needed. Whoever leads wins when both changed the
same thing; the other version is kept in a conflict list (below).

## How it looks

A band over every page, on every device, that cannot be dismissed (the takeover buttons on the
desktop only):

- **Box, mirror:** «Spiegel von KP Rück Online · Stand 19:30:12 · nur ansehen» (or «keine
  Verbindung zu KP Rück Online» once the hosted board has not been heard from for 90 s), and for
  editors and admins **«Dieses Ereignis offline übernehmen …»**. One confirmation, which says so
  when the hosted board is still reachable.
- **Box, leading:** amber, «Offline geführt · seit 19:42 · alles an KP Rück Online übertragen ·
  Stand 19:58:10» – or, without the internet, «keine Verbindung zu KP Rück Online seit 19:44 ·
  37 Änderungen warten und gehen von selbst raus». That Ereignis can be edited as usual.
- **Hosted board, while the box leads:** grey, «Geführt auf KP Rück Offline · seit 19:42 · Stand
  19:58:10 · Neues erfassen geht, Bestehendes ändern nicht» (or how long the box has not been
  heard from), and **«Hier übernehmen …»**. Its confirmation says when the box was last heard
  from and how much it had not sent then, with a warning when somebody is working there.

Behind the band the board is the ordinary one with editing switched off, as for a viewer – on
the hosted board except for new things: an Einsatz, a Tagebuch line, and everything the field
sends (Feld reports, photos, alarms), which reach the box with the next round. The box's API
agrees: while it leads no Ereignis, every write is answered 403 (`standby_read_only`).

## When both changed the same thing

During an outage the hosted board keeps running – phones on mobile data, the Feld flow and
alarms keep writing to it. When the two meet again, per row and field:

- a change only one side made is taken, from either side (the box changed the Meldung, a phone
  the status of the same Einsatz: both stand);
- new rows from either side are added; an Einsatz number both gave out is renumbered, with a
  Tagebuch line saying so;
- the same field changed on both: the leader's value stands, the other goes to the **conflict
  list** – «n Konflikte ›» in the band. On the leading system each conflict is decided with one
  choice: this version, the other one, or for text **«Beide zusammen»**, both one below the
  other in a field that can be rewritten. The other system shows the list to read;
- deleted on one side, changed on the other: the leader decides; the Einsatz stays when the
  leader changed it, and the deletion waits in the list («Löschen»), and vice versa
  («Wiederherstellen»);
- two takeovers in the gap: the later one leads.

The sync (`backend/app/standby_sync.py`) compares both sides with the last state they agreed on,
every 5 s while the box has taken an Ereignis over. Nothing is dropped without a word: what
cannot be written yet (a person the roster has not mirrored, say) stays counted in the band and
is logged by the sidecar until it goes through.

## What is mirrored

Everything in the hosted database, with these exceptions that belong to the box itself:

| Kept by the box | Why |
| --- | --- |
| Its schema revision (`alembic_version`) | the box migrates itself; see «Following the hosted board» |
| The alarm webhook secret, `map_mode`, telemetry id and consent, roster-read status, seed markers | each deployment has its own ([`RUNNING-BOTH.md`](RUNNING-BOTH.md) §3); the hosted board has no tile server, the box does |
| Print jobs, telemetry outbox, Microsoft login transactions, geocoding queue | a queue of the hosted board, not of this box |

**Photos** are not in the database. The sidecar fetches every photo the mirrored reports list
from the hosted board's API, with a read-only login (`STANDBY_PHOTO_USER`), within half a minute.

**Logins** are the hosted board's: the users table is mirrored. The admin you created when you
installed the box is replaced. Microsoft sign-in needs the internet, the one thing the box won't
have on the day – make sure at least one hosted **admin and the editors who run the board have
a password**. A box set up with `LOCAL_AUTOLOGIN_USER` needs that account on the hosted board.

The box runs **none of the jobs that write**: no Divera polling or retention sweep, no roster
poll, no audit cleanup, no training autogen, and no outbound alarms (`DEPLOYMENT_ROLE=standby`
blocks them like staging does). The hosted board runs them, and their results arrive here.

## Setting it up

### 1. On the hosted database (once)

Logical replication needs `wal_level = logical`, which takes **one restart of the hosted
Postgres** (about a minute in which the hosted board answers nothing). On Railway, as the
database's owner (`railway connect Postgres`):

```sql
ALTER SYSTEM SET wal_level = logical;
-- A box that is offline for days must not fill the hosted disk with retained WAL: past this,
-- its slot is dropped and the box sets itself up again from scratch.
ALTER SYSTEM SET max_slot_wal_keep_size = '2GB';
```

Restart the Postgres service, then check with `SHOW wal_level;`. Then the publication and the
box's login – generate the password and keep it in your password vault:

```sql
-- Everything, but no TRUNCATE: a truncate on the hosted side must never wipe a detached
-- Ereignis on the box.
CREATE PUBLICATION kp_standby FOR ALL TABLES WITH (publish = 'insert, update, delete');

CREATE ROLE kp_standby WITH REPLICATION LOGIN PASSWORD '<generated>';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO kp_standby;
-- Tables a later migration creates (as the role the backend connects with):
ALTER DEFAULT PRIVILEGES FOR ROLE <backend db user> IN SCHEMA public GRANT SELECT ON TABLES TO kp_standby;
```

For the photos, a **viewer** account on the hosted board (Einstellungen › Benutzer) with a
password – the seeded `viewer` will do.

For the way back, a key the box shows the hosted board: generate it (`openssl rand -hex 32`),
keep it in your password vault, and set it on the hosted **backend** as `STANDBY_SYNC_TOKEN`
(Railway › backend › Variables; one redeploy). Without it the hosted board refuses every write
from the box, and the box's work stays on the box.

**What the box can do with the hosted board.** It never holds the hosted database's own login.
It reads through `kp_standby` (replication and `SELECT`, no write privilege on any table), and
it writes only through `POST /api/standby/sync` with the key, which takes rows of one Ereignis
at a time: the Ereignis's own tables (Einsätze, Aufträge, Mannschaft, Tagebuch, Rapporte …),
each row checked against the version the box last saw. Users, roster and settings are out of
its reach. Which Ereignis is not: a takeover happens on the box, offline, and the hosted board
learns of it from the box – so whoever holds the key can declare any Ereignis taken over and
rewrite it. That is why it lives in the vault and in the two `.env`/Variables entries, nowhere
else, and why a lost box means a new key (below).

### 2. The box

1. Install it as a normal compose stack ([`SETUP.md`](SETUP.md)) from a **git checkout** (the
   follow script below moves it commit for commit) – a box **without Ereignisse**: the first
   setup replaces everything on it with the hosted data, and refuses if it holds any.
2. In its `.env`:

   ```bash
   COMPOSE_PROFILES=backup,standby
   DEPLOYMENT_ROLE=standby
   STANDBY_SOURCE_URL=postgresql://kp_standby:<generated>@<host>:<port>/railway?sslmode=require  # host/port of DATABASE_PUBLIC_URL
   STANDBY_SOURCE_API=https://kp.example.ch/backend-api   # or the backend's own address
   STANDBY_PHOTO_USER=<viewer>
   STANDBY_PHOTO_PASSWORD=<its password>
   STANDBY_SYNC_TOKEN=<the same key as on the hosted backend>
   STANDBY_FOLLOW_URL=https://kp.example.ch
   ```

   Keep `?sslmode=require` on `STANDBY_SOURCE_URL`: this link carries the whole database,
   and without it Postgres clients fall back to plain text when somebody on the path asks
   them to. The sidecar says so in its log when it is missing.

   Remove `ADMIN_SEED_PASSWORD` and `VIEWER_PASSWORD`: the accounts now come from the hosted
   board, and a password re-applied from `.env` on every boot would fight the mirrored one.
   `LOCAL_AUTOLOGIN_USER` must name an editor that exists on the hosted board; it needs no
   password there (the hosted board never accepts the passwordless login).
3. Follow the hosted board's version once (below), then `docker compose up -d`. The
   `standby-mirror` sidecar installs its guards, creates the subscription and copies the
   hosted data. `docker compose ps standby-mirror` reads `healthy` once the copy is current;
   `docker compose logs standby-mirror` says what it is doing.
4. Set the box's map to **auto** or **offline** and install the offline tiles
   ([`OFFLINE_MAPS.md`](OFFLINE_MAPS.md)).

### 3. Following the hosted board

Replication only works while both sides run the same schema: a column the hosted board has
added has nowhere to go on the box, and replication stops (and retries) until the box has it
too. The hosted board deploys from `main`, so the box follows **commit for commit**:
`main-images.yml` publishes the images of every `main` commit as `main-<short sha>`, and
`scripts/standby-follow.sh` moves the box onto the commit the hosted board runs – forward only,
after a backup, and **never while the box leads an Ereignis** (an update restarts the board). Run it every five minutes, e.g. from cron on the box:

```
*/5 * * * *  cd /path/to/kp-rueck && scripts/standby-follow.sh >> $HOME/kp-standby-follow.log 2>&1
```

## Is it working?

`docker compose ps standby-mirror` is `healthy` when the last round (every 30 s) found the mirror
current; `just doctor` says the same. The round's report is `last-status.json` in the
`standby` volume:

| `stage` | Meaning | What to do |
| --- | --- | --- |
| `config` | `STANDBY_SOURCE_URL` or `DATABASE_URL` missing | Set it in `.env`, `docker compose up -d` |
| `connect` | No mirror yet, and the hosted database cannot be reached | Internet, host, port or password |
| `version` | The hosted schema is newer than the box's | `scripts/standby-follow.sh` (or its log) |
| `in_use` | The first setup found Ereignisse on the box | Set up only a box without Ereignisse |
| `mirror` (stale) | Not heard from the hosted board for 90 s | Normal during an outage; otherwise the logs |
| `photos` | The photo login was refused | `STANDBY_PHOTO_USER` / `STANDBY_PHOTO_PASSWORD` |

The two-way sync reports per Ereignis in the band («n Änderungen warten») and in the sidecar's
log: `WAIT [sync]` names a row that cannot be written yet, `CONFLICT [sync]` a round that found
one, `ERROR [sync]` a round that failed (it is simply repeated). A box whose work never arrives
on the hosted board usually lacks `STANDBY_SYNC_TOKEN`, or has a different one.

## On the day

1. Devices open the **box's LAN address**. The band says how current it is.
2. Open the running Ereignis, **«Dieses Ereignis offline übernehmen …»**, confirm. Work on it
   as usual. Everything else stays a mirror and catches up when the internet returns.
   If the outage began before the hosted board had the Ereignis, Ereignisse › **«Neues Ereignis
   offline anlegen …»**: an Ereignis created on the box is led there from the start, and appears
   on the hosted board once it answers.
3. Crews outside keep using the hosted board on their phones (Feld reports, photos, Tagebuch):
   it reaches the box with the next round after the internet is back.
4. The thermal print agent and alarm intake still point at the hosted board. Without the
   internet, alarms do not arrive at the box; once it is back, an alarm the hosted board
   attached to the Ereignis arrives as a new Einsatz. The print agent can be pointed at the box
   ([`PRINT_AGENT.md`](PRINT_AGENT.md)).

## If the box is lost or stolen

The box holds a full copy of the hosted database – password hashes included – and three
credentials in its `.env`. Its disk should be encrypted (BitLocker, FileVault, LUKS) so that
a lost notebook is a lost notebook. Either way, the same day:

1. **Cut the replication login.** On the hosted database, as its owner:

   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'kp_standby';
   SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name LIKE 'kp_standby%';
   ALTER ROLE kp_standby NOLOGIN;   -- or a new password, for the replacement box
   ```

2. **New sync key.** Generate one, set `STANDBY_SYNC_TOKEN` on the hosted backend (one
   redeploy) and update the vault. The old key can rewrite Ereignisse until then.
3. **New password for the photo viewer** (Einstellungen › Benutzer) – the box had it in clear.
4. **If the disk was not encrypted:** everybody gets a new password (the hashes are bcrypt,
   but a short password does not survive an offline guess), and rotate the alarm webhook
   secret – the settings table was on the box too.
5. An Ereignis the box was leading: press **«Hier übernehmen …»** on the hosted board. What
   the box had not sent is gone.

## After the outage

Nothing to carry over by hand: once the box reaches the hosted board, its work goes up and the
band says «alles an KP Rück Online übertragen». Decide the conflicts, if any («n Konflikte ›»).
Then whoever carries on takes the lead – keep working on the box, or press **«Hier übernehmen
…»** on the hosted board; the box becomes a mirror of that Ereignis again and follows new
versions again once it leads nothing.

`python -m app.standby --reset` (after `just backup`) starts the box over from the hosted data.
It is the last resort – after the box was lost for days, say – and discards what the box had
not sent yet. An Ereignis the hosted board still says the box leads is taken up again once the
copy is complete, so work on it carries on from the hosted version.
