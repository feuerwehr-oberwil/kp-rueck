# Standby box for a hosted board

A board hosted on Railway is gone when the station loses its internet connection
([`AUSFALL_SOP.md`](AUSFALL_SOP.md), table B). A compose stack in the Magazin keeps running on
the LAN when that happens, but only if it already has the station's roster and settings.
Without them it is an empty board. The `standby-sync` sidecar keeps one ready: every night it
copies the station's **configuration** from the hosted database onto the box.

The copy goes one way and is read-only on the hosted side. Einsätze are not copied. On the day,
the last Lageblatt carries the running operation over, as the SOP describes.

## What is copied

| Copied every night | Stays as it is on the box |
| --- | --- |
| Users (the hosted logins, password hashes included) | Einsätze, Ereignisse, journal, reports |
| Settings | Photos (they live in a volume, not the database) |
| Vehicles, personnel and their external identities | The alarm webhook secret (each deployment has its own – [`RUNNING-BOTH.md`](RUNNING-BOTH.md) §3) |
| Material groups, materials | `map_mode` (the hosted board has no tile server; the box has one) |
| Special-function types, emergency and Auftrag templates, training locations | Telemetry id and consent, roster-read status, seed markers |

The list is `CONFIG_TABLES` in `backend/app/standby_sync.py`. It is the same list
`just dev-sync --config` uses, and a test keeps the two equal.

**After the first copy, everyone logs in to the box with their hosted account.** The admin you
created when you set up the box is replaced. Microsoft sign-in needs the internet, which is
the one thing the box won't have on the day. So make sure at least one hosted **admin has a
password**.

The box's own audit trail, notifications and print jobs are cleared along with the copy,
because they point at the rows being replaced. On a box that has never run an Ereignis, they
only record its setup.

## When it refuses

Each run either replaces the whole configuration or changes nothing. The outcome is in
`last-sync.json`, and the container goes `unhealthy` when the last run failed or is more than
26 hours old. `docker compose ps standby-sync` and `just doctor` both show this.

| Stage | Meaning | What to do |
| --- | --- | --- |
| `config` | `STANDBY_SOURCE_URL` is empty | Set it in `.env`, then `docker compose up -d` |
| `connect` | The hosted database cannot be reached | The internet is down, or the host, port or password is wrong |
| `version` | The hosted schema is newer than the box's | Update the box (below) |
| `in_use` | The box holds an Ereignis of its own | The box is the board now. See «After the outage» |
| `copy` | Postgres refused the copy, e.g. `permission denied` | After an update that adds a configuration table, add it to the `GRANT` (below) |

## Setting it up

1. **Install the box** as a normal compose stack ([`SETUP.md`](SETUP.md): the launcher, or
   `just init`). Choose a release **at least as new as the hosted board's schema**. The hosted
   board is built from `main` and the box from a release, so the release has to have caught up.
2. **Create a read-only login on the hosted database.** Run this once, with any Postgres client
   connected to the hosted database as its owner (`railway connect Postgres`). Generate the
   password, and store it in your password vault:

   ```sql
   CREATE ROLE kp_standby LOGIN PASSWORD '<generated>';
   ALTER ROLE kp_standby SET default_transaction_read_only = on;
   GRANT CONNECT ON DATABASE railway TO kp_standby;
   GRANT USAGE ON SCHEMA public TO kp_standby;
   GRANT SELECT ON alembic_version, users, settings, vehicles, personnel,
     personnel_external_identities, material_groups, materials, special_function_types,
     emergency_templates, training_locations, auftrag_templates, auftrag_template_resources
     TO kp_standby;
   ```

   The login can read only these tables and no Einsätze. The sidecar opens its own read-only
   transaction as well, so even a login that could write would not.
3. **Point the box at it.** In the box's `.env`, use the host and port of the public
   `DATABASE_PUBLIC_URL` (`railway variables --service Postgres --kv`) with the new login:

   ```bash
   COMPOSE_PROFILES=backup,standby
   STANDBY_SOURCE_URL=postgresql://kp_standby:<generated>@<host>:<port>/railway
   # STANDBY_SYNC_AT=04:15
   ```

4. `docker compose up -d`. The sidecar copies once straight away, so a wrong address fails
   while you are still looking. Within a minute, `docker compose ps standby-sync` should read
   `healthy`, and `docker compose logs standby-sync` should end in `✓ configuration copied`.
5. Set the box's map to **auto** or **offline** (Einstellungen), and install the offline tiles
   ([`OFFLINE_MAPS.md`](OFFLINE_MAPS.md)). Without tiles, the box shows an empty map during the
   outage.

## Keeping it current

- **Software:** when the copy reports `version`, update the box to the newest release
  ([`DEPLOYMENT.md` §4](DEPLOYMENT.md#4-updating)). The update pulls all images, which is also
  what lets the box start without the internet later.
- **A release adds a configuration table:** the release notes say so. Add it to the `GRANT`
  above, or the next copy fails with `permission denied`.
- **Tiles:** refresh them now and then ([`OFFLINE_MAPS.md`](OFFLINE_MAPS.md#updating-tiles)).
- **Practise the switch-over:** add it to the half-yearly failover drill in
  [`AUSFALL_SOP.md`](AUSFALL_SOP.md).

## On the day

1. Devices open the box's **LAN address**, not the hosted URL.
2. Log in with the usual (password) accounts and open an Ereignis. From that moment the box
   holds an Ereignis, so the nightly copy refuses with `in_use` and never replaces the roster
   under a running operation.
3. The thermal print agent and alarm intake still point at the hosted board. Without the
   internet, alarms don't arrive anyway. The print agent can be pointed at the box
   ([`PRINT_AGENT.md`](PRINT_AGENT.md)).

## After the outage

1. Carry the box's Einsätze back to the hosted board by hand: one person, in chronological
   order, as in the SOP's «Wiederanlauf». The box's PDF export is the record.
2. Delete the Ereignis on the box. The next nightly copy makes it a standby again.
