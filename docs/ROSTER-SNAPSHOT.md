# ROSTER-SNAPSHOT – reading the roster from a file the station publishes

Some stations keep their personnel list somewhere else entirely – a municipal HR system, a
cantonal register, a sibling application (fwo-admin), a spreadsheet. For them KP Rück can read
the roster from a **published file** instead of (or beside) Divera: that system writes a JSON
file to the `roster-snapshot/1` contract, and this deployment polls it.

It is optional, read-only towards the source, and off by default. **Divera's roster sync is
untouched and stays the default.** A station that sets nothing sees no change at all.

**KP Front reads the same file the same way.** The contract (`docs/roster-snapshot.schema.json`,
`docs/roster-snapshot-outcome.schema.json`) and the code that reads it
(`backend/app/roster_snapshot.py`, `backend/app/roster_snapshot_ingest.py`) are byte-identical
in both repositories, listed in `shared/MANIFEST.json` and compared by CI's «Shared files» job
in both repositories. A station
running both apps publishes **one** file and feeds both – neither app calls the other
([`RUNNING-BOTH.md`](RUNNING-BOTH.md)).

## 1. Turning it on

All server configuration (`.env`), like every other integration here:

| Variable | Meaning | Default |
|---|---|---|
| `ROSTER_SNAPSHOT_SOURCE` | an `https://` address, or an absolute path **inside the backend container** (`/data/roster.json`, `file:///…`) | empty = **off** |
| `ROSTER_SNAPSHOT_TOKEN` | bearer token, sent as `Authorization: Bearer …` and **only over https** | none |
| `ROSTER_SNAPSHOT_INTERVAL_MINUTES` | how often to poll (5–1440) | `60` |
| `ROSTER_SNAPSHOT_MAX_DEACTIVATE_PCT` | the deactivation cap, see §3 | `20` |

Restart the backend after changing them. The file is read about a minute after boot, then every
interval; an unchanged file (same sha256) is skipped. Put anything secret in the token, not in a
query string: error lines are worded without the address, but the token is the one setting built
to carry a secret.

For a file on the host, mount it into the backend service (compose override) and point the
source at the path inside the container.

## 1a. Through the station index (recommended)

Owner decision X6/X7: a station keeps all its shared data in **one place** and feeds both apps
the same way. That place is a folder with an **`index.json`** that lists the data files in it by
kind, each with its contract version and sha256 ([`station-index.schema.json`](station-index.schema.json),
example [`station-index.example.json`](station-index.example.json)):

```json
{ "schema": "station-index/1", "schema_version": 1, "generated_at": "2026-10-09T04:00:00+00:00",
  "provider": "musterdorf",
  "files": [ { "kind": "roster", "path": "roster.json", "schema": "roster-snapshot/1",
               "sha256": "<64 hex>", "bytes": 1234 } ] }
```

| Variable | Meaning |
|---|---|
| `STATION_INDEX_SOURCE` | the `https://` address or absolute path of the `index.json`; blank = off |
| `STATION_INDEX_TOKEN` | bearer token for the index **and** its siblings (always the same host), https only |

- When the index lists a `roster`, that file is read and everything below applies unchanged.
  When it lists none, `ROSTER_SNAPSHOT_SOURCE` is read as before – **that setting stays as the
  fallback**, so a station that set it changes nothing. An index that is set but cannot be read
  is an error in the status, never a silent fallback.
- A listed file is read only when it hashes to the index's sha256 (and has its `bytes`): a file
  swapped after the index was written is refused for that run. Paths are relative, never `..`,
  absolute or another host. A known kind is read only at the version this build implements.
- Write the index with `python3 scripts/station_index_build.py <folder> --provider <key>` (stdlib):
  it lists every `*.json` whose top-level `schema` is `<kind>-snapshot/<n>` and writes `index.json`
  atomically – run it last, after the data files are in place.
- `vehicles`, `groups` and `keywords` are **reserved kinds**: an index may list them, the status
  names them as «noch nicht gelesen», and nothing reads them yet – each would write data operators
  edit by hand today (the vehicles table here; fleet, alarm groups and keywords in KP Front), which
  is a change of ownership, not a mapping. Their intended shapes (same envelope as the roster:
  `schema`, `generated_at`, `provider`, `complete`, `count`, items with a stable `external_id` +
  `identities`) are in KP Front's `docs/CONFIGURATION.md` §4d.

The reader (`backend/app/station_index.py`), the builder and both JSON files are byte-identical
with KP Front's and pinned like the roster files.

## 2. What a run does

1. **Fetch** (≤ 5 MB, 30 s timeout). A failure – unreachable, HTTP error, missing file – changes
   nothing.
2. **Validate** against the contract, including the medical-key guard (§5). An invalid document,
   one **older than the one already applied** or stamped more than 5 minutes **in the future**,
   or a run that crashes while writing, changes nothing. The roster stays exactly as
   the last good snapshot left it, and the status says why.
3. **Match** every person in the file to a local person, in this order:
   - the snapshot's own key (`provider` + `external_id`) in `personnel_external_identities`;
   - any identity the entry lists – `{"provider": "divera", "external_id": "4711"}` finds the
     person the Divera sync created, so **nobody is duplicated and the Divera link stays**;
   - a name exactly one local person carries.

   Two candidates for a name is `ambiguous_name`; identities pointing at two different people –
   or at a person who already holds a *different* id at that provider – is
   `conflicting_identity` – also when that person was only found by name, so a namesake is never
   created a second time. Both are skipped and reported. **An existing identity link is never
   rewritten**, and an entry may not list an identity under the file's own `provider`.
4. **Write**: create new people (`status = available`), rename, map the rank key to a role word
   (`kdt`/`maj`/`hptm`/`oblt`/`lt` → Offizier, `fw`/`wm` → Wachtmeister, `kpl` → Korporal,
   `gfr`/`fwm`/`sdt` → Mannschaft; any other key is reported and `role` left alone), attach
   missing identity links.
5. **Deactivate** the people the file lists as inactive and – only for `complete: true` – the
   people carrying this provider's key whom the file no longer lists. Hand-entered people and
   people only Divera knows are never touched by absence. **Nobody is deleted.**
6. **Never mid-operation.** A person checked in to, or assigned on, an Ereignis that is not
   archived keeps their place; the deactivation is postponed (shown as «Wartet, bis sie nicht
   mehr im Einsatz sind») and a later run applies it, even if the file has not changed.
7. **Names Divera knows stay.** People with a Divera identity are never renamed: the Divera
   sync matches by name, and with «remove stale» it would delete whoever it no longer finds.
   Publish names in the same «Nachname Vorname» form Divera uses if you want them to agree.

Every applied run sends one `personnel_update` so open boards reload.

**«Deactivated» in KP Rück** is `status = unavailable` plus a mark on the person's snapshot
identity row. `status` is the board's availability and belongs to the operators – somebody on
holiday is unavailable and still on the roster – so only a person carrying the mark counts as
«left» to the snapshot, and only they are made available again when the file lists them as
active again (with the status they had). An operator's own «unavailable» is never undone by a
feed. The rank key last applied is kept on the same identity row, so an operator's later edit of
`role` survives until the file changes that person's rank.

## 3. The deactivation cap

A run that would deactivate more than `ROSTER_SNAPSHOT_MAX_DEACTIVATE_PCT` of the available
people (at least one is always allowed; `0` = never unattended, `100` = no cap) is **held**:
**nothing at all is written**, and Einstellungen › Integrationen shows «angehalten» with the
numbers and the people it would have deactivated. A truncated export or a filter left on in the
HR system looks exactly like «a third of the brigade resigned», and a human has to tell the two
apart. If the file is right, release it:

```bash
docker compose exec backend uv run python -m app.services.roster_snapshot_sync run --force
# or: POST /api/integrations/roster-snapshot/sync  {"force": true}   (admin)
```

A run that would leave **no** available person is refused even with `--force`. `--force` also
overrides the «older than applied» guard – the way out when a publisher's wrong clock left a
last good file dated in the future.

## 4. Seeing what happened

- **Einstellungen › Integrationen** – the «Personal-Abgleich» row names the source, and the
  block under the table reads the last run: counts, who could not be placed, unknown ranks, the
  date of the file the roster reflects, and a warning when that file has not moved for 7 days.
- `GET /api/integrations/roster-snapshot` – the same as JSON: the outcome report
  (`roster-snapshot-outcome/1`) plus `held`, `stale`, `lastGood`, `lastSuccess`, `lastError`.
- `uv run python -m app.services.roster_snapshot_sync status` on the server.
- Every applied run writes one `sync` / `personnel` entry to the audit log.

## 5. Producing the file

The contract is [`roster-snapshot.schema.json`](roster-snapshot.schema.json); a worked example
prints with `cd backend && uv run python -m app.roster_snapshot example`, and
`… validate my-roster.json` checks a file without a database or network.

**From a spreadsheet** – [`scripts/roster_snapshot_from_csv.py`](../scripts/roster_snapshot_from_csv.py),
standard library only, no app needed:

```bash
python3 scripts/roster_snapshot_from_csv.py export.csv --provider meine-wehr --out /srv/kp/roster.json
```

Columns: `external_id` (your stable key – never reuse or renumber one), `display_name`, optional
`first_name`, `last_name`, `rank` (a rank *key*), `active` (1/0, ja/nein) and any number of
`id:<provider>` columns (`id:divera`). Example input:
[`roster-snapshot.example.csv`](roster-snapshot.example.csv). `--out` writes atomically, so a
poll never reads half a file; run it from cron next to the stack.

🔴 **No medical fields, ever.** The generator **drops every column that is not part of the
contract** and names it on stderr – the example deliberately carries a «Tauglichkeit bis»
column to show where it stops. Both apps additionally refuse any document with a
medically-named key, whole, before a single person is read, and a test runs the same guard over
what they store afterwards. The check reads names, not content: never write medical information
into `display_name`.

`complete: true` says the file lists everyone, which is what lets an absence mean «left»; a file
that covers only some people sets `complete: false` (`--partial`), and then nobody is
deactivated for being absent.
