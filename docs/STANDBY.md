# Standby box for a hosted board

A board hosted on Railway is gone the moment the station loses its internet connection
([`AUSFALL_SOP.md`](AUSFALL_SOP.md), table B). A compose stack in the Magazin keeps running on
the LAN, but only if it already holds the board. The standby box does: it **mirrors the hosted
database live** (Postgres logical replication, one way), so it holds every Ereignis, every
Einsatz, the roster and the photos, seconds behind the hosted board.

The mirror's board is **look-only**. When it is needed, somebody opens the Ereignis on the box
and takes it **offline**: from then on that Ereignis is worked on here, and nothing the hosted
board does to it arrives any more – not even once the internet is back. Every other Ereignis,
every new one and the roster keep mirroring.

## How it looks

A band over every page, on every device, that cannot be dismissed:

- **Mirror:** «Spiegel von KP Rück Online · Stand 19:30:12 · nur ansehen» (or «keine Verbindung
  zu KP Rück Online» once the hosted board has not been heard from for 90 s). On the desktop,
  editors and admins with an Ereignis open get one button: **«Dieses Ereignis offline
  übernehmen …»**. One confirmation, which says so when the hosted board is still reachable.
- **Taken offline:** amber, «Offline geführt seit 19:42 · «Name» wird nicht mehr
  synchronisiert». That Ereignis can be edited as usual.

Behind the band the board is the ordinary one with editing switched off, as for a viewer. The
API agrees: until an Ereignis is taken offline, every write is answered 403 (`standby_read_only`).

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
password of its own.

### 2. The box

1. Install it as a normal compose stack ([`SETUP.md`](SETUP.md)) – a box **without Ereignisse**:
   the first setup replaces everything on it with the hosted data, and refuses if it holds any.
2. In its `.env`:

   ```bash
   COMPOSE_PROFILES=backup,standby
   DEPLOYMENT_ROLE=standby
   STANDBY_SOURCE_URL=postgresql://kp_standby:<generated>@<host>:<port>/railway  # host/port of DATABASE_PUBLIC_URL
   STANDBY_SOURCE_API=https://kp.example.ch/backend-api
   STANDBY_PHOTO_USER=<viewer>
   STANDBY_PHOTO_PASSWORD=<its password>
   STANDBY_FOLLOW_URL=https://kp.example.ch
   ```

   Remove `ADMIN_SEED_PASSWORD` and `VIEWER_PASSWORD`: the accounts now come from the hosted
   board, and a password re-applied from `.env` on every boot would fight the mirrored one.
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
after a backup, and **never while an Ereignis is taken offline on the box** (an update restarts
the board). Run it every five minutes, e.g. from cron on the box:

```
*/5 * * * *  cd /path/to/kp-rueck && scripts/standby-follow.sh >> /var/log/kp-standby-follow.log 2>&1
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

## On the day

1. Devices open the **box's LAN address**. The band says how current it is.
2. Open the running Ereignis, **«Dieses Ereignis offline übernehmen …»**, confirm. Work on it
   as usual. Everything else stays a mirror and catches up when the internet returns.
3. The thermal print agent and alarm intake still point at the hosted board. Without the
   internet, alarms do not arrive anyway; the print agent can be pointed at the box
   ([`PRINT_AGENT.md`](PRINT_AGENT.md)).

## After the outage

1. Carry the box's work on that Ereignis back to the hosted board by hand: one person, in
   chronological order, as in the SOP's «Wiederanlauf». The box's PDF export is the record.
2. The Ereignis stays offline on the box, and the box does not follow new versions while it
   does. Once its work is on the hosted board, make the box a pure mirror again – this replaces
   everything on it with the hosted data, so back up first:

   ```bash
   just backup
   docker compose exec standby-mirror uv run python -m app.standby --reset
   ```
