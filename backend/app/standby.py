"""A standby box: a live, one-way mirror of the hosted board, and the takeover of one Ereignis.

A station whose board runs hosted (Railway) keeps a compose stack in the Magazin that follows
the hosted database through native Postgres logical replication (`DEPLOYMENT_ROLE=standby`,
compose profile `standby`). Until somebody takes an Ereignis over, the box is a mirror and its
board is look-only. Taking an Ereignis offline detaches exactly that one for good: nothing the
hosted board does to it arrives any more, even once the internet is back, while every other
Ereignis, every new one and the roster keep mirroring. docs/STANDBY.md is the operator's side.

How the detaching works: every replicated table carries a trigger that fires ONLY for
replication (`ENABLE REPLICA TRIGGER`) and drops an incoming row that belongs to a detached
Ereignis. The box's own writes never fire it. The same mechanism keeps tables that describe the
box itself (its schema revision, telemetry, print queue …) and the box's own settings out of
the mirror.

    python -m app.standby           set up and report once
    python -m app.standby --loop    keep it set up, copy photos, report (the compose sidecar)
    python -m app.standby --check   exit 0 only if the last report is recent and the mirror runs
    python -m app.standby --reset   after an outage: drop the mirror, forget what was taken offline,
                                    and copy everything from the hosted board again (back up first)

Environment (the sidecar):

    STANDBY_SOURCE_URL     the hosted database, as the replication login (docs/STANDBY.md)
    DATABASE_URL           this box's database, as a superuser (subscriptions need one)
    STANDBY_SOURCE_API     the hosted board's API base, e.g. https://kp.example.ch/backend-api
    STANDBY_PHOTO_USER     a read-only login on the hosted board, to fetch photos
    STANDBY_PHOTO_PASSWORD   (photos are skipped while either is empty)
    PHOTOS_DIR             where this box keeps photos            (default /mnt/data/photos)
    STANDBY_STATUS_DIR     where last-status.json goes            (default /mnt/data/standby)
    STANDBY_INTERVAL_SECONDS  pace of the loop                    (default 30)
"""

import asyncio
import json
import os
import sys
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError

SUBSCRIPTION = "kp_standby"
# Created on the hosted database by the operator (docs/STANDBY.md): FOR ALL TABLES, without
# TRUNCATE – a truncate on the hosted side must never wipe a detached Ereignis here.
PUBLICATION = "kp_standby"

# Tables that describe THIS box, not the station. Nothing arrives in them. alembic_version
# above all: the box migrates itself, and a newer revision arriving from the hosted side would
# make its backend believe it runs a schema it does not have. geocoding_dispatch has a serial
# key whose sequence is not replicated, so mirrored rows would collide with the box's own.
SKIPPED_TABLES = frozenset(
    {"alembic_version", "telemetry_outbox", "microsoft_login_transactions", "print_jobs", "geocoding_dispatch"}
)

# Settings that describe this box, not the station: they keep the box's own value.
# - alarm_webhook_secret: each deployment has its own, or one alarm is accepted by both.
# - map_mode: the hosted board has no tile server; the box has one and needs auto/offline.
# - seed.completed_at, deployment_role: markers of how this database was created.
# - telemetry.*, roster_snapshot.*: one installation's id, consent and roster-read status.
LOCAL_SETTINGS = ("alarm_webhook_secret", "map_mode", "seed.completed_at", "deployment_role")
LOCAL_SETTING_PREFIXES = ("telemetry.", "roster_snapshot.")

# A mirror whose last message is older than this is reported as not current.
STALE_AFTER = timedelta(seconds=90)

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
STATUS_FILE_NAME = "last-status.json"


class StandbyError(Exception):
    """The standby could not be set up, and why – `stage` names the step for the status file."""

    def __init__(self, stage: str, message: str) -> None:
        super().__init__(message)
        self.stage = stage


@dataclass
class MirrorState:
    """What the band and the sidecar report: is the mirror running, how current, what is detached."""

    configured: bool
    enabled: bool = False
    last_received_at: datetime | None = None
    apply_errors: int = 0
    detached: dict[uuid.UUID, datetime] = field(default_factory=dict)

    @property
    def current(self) -> bool:
        """The hosted board has been heard from recently, so the mirror is up to date."""
        return (
            self.enabled
            and self.last_received_at is not None
            and datetime.now(UTC) - self.last_received_at < STALE_AFTER
        )


def is_local_setting(key: str) -> bool:
    """True for a setting that keeps the box's own value."""
    return key in LOCAL_SETTINGS or key.startswith(LOCAL_SETTING_PREFIXES)


def schema_covers(script: ScriptDirectory, local_revision: str, source_revision: str) -> bool:
    """True when the box's schema includes every migration the source has run.

    That is the case exactly when the source's revision is the box's own or one of its
    ancestors. A revision the box's migration tree does not know is newer than the box.
    """
    try:
        return any(rev.revision == source_revision for rev in script.iterate_revisions(local_revision, "base"))
    except CommandError:
        return False


def libpq_url(url: str) -> str:
    """The URL asyncpg and CREATE SUBSCRIPTION accept: SQLAlchemy writes its driver into the scheme."""
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


# --- the guards: which incoming rows belong to a detached Ereignis --------------------------


async def event_links(conn: asyncpg.Connection) -> dict[str, str]:
    """For every table whose rows belong to an Ereignis, the SQL that finds it from row `r`.

    Read from the live catalogue rather than from the models, so a table a later migration adds
    is guarded the moment it exists: an `event_id` column wins, then a key to `incidents`
    (`incident_id` before any other), then one to `incident_groups`. Tables with none of these
    (the roster, settings, users …) belong to no Ereignis and always mirror.
    """
    rows = await conn.fetch(
        """
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS ref
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
          AND c.connamespace = 'public'::regnamespace
          AND c.confrelid::regclass::text IN ('events', 'incidents', 'incident_groups')
          AND c.conrelid <> c.confrelid
        """
    )
    # `{row}` is filled with the trigger's row variable: the new row, or the old one on UPDATE.
    lookup = {
        "events": "{row}.{col}",
        "incidents": "(SELECT i.event_id FROM public.incidents i WHERE i.id = {row}.{col})",
        "incident_groups": "(SELECT g.event_id FROM public.incident_groups g WHERE g.id = {row}.{col})",
    }
    order = ["events", "incidents", "incident_groups"]

    def rank(row: asyncpg.Record) -> tuple[int, bool]:
        return (order.index(row["ref"]), row["col"] not in ("event_id", "incident_id"))

    links: dict[str, str] = {"events": "{row}.id"}
    by_table: dict[str, list[asyncpg.Record]] = {}
    for row in rows:
        by_table.setdefault(row["tbl"], []).append(row)
    for table, candidates in by_table.items():
        if table in SKIPPED_TABLES or table in links:
            continue
        best = min(candidates, key=rank)
        links[table] = lookup[best["ref"]].replace("{col}", best["col"])
    return links


def _guard_sql(table: str, link: str | None) -> str:
    """The replica-only trigger function for one table. `link` finds a row's Ereignis (`{row}`).

    Built as text on purpose (S608 below): table names come from this box's own catalogue and
    the setting keys from the constants above – nothing here is ever input.
    """
    if table in SKIPPED_TABLES:
        body = "RETURN NULL;"
    elif table == "settings":
        keys = ", ".join(f"'{k}'" for k in LOCAL_SETTINGS)
        prefixes = " OR ".join(f"r.key LIKE '{p}%'" for p in LOCAL_SETTING_PREFIXES)
        # A key the box created on its own boot (a default the hosted side had not written yet)
        # must not stop replication with a duplicate key: the hosted value replaces it.
        body = f"""
        IF r.key IN ({keys}) OR {prefixes} THEN RETURN NULL; END IF;
        IF TG_OP = 'INSERT' THEN DELETE FROM public.settings WHERE key = NEW.key; END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;"""  # noqa: S608
    elif link is None:
        return ""
    else:
        new_event, old_event = link.replace("{row}", "r"), link.replace("{row}", "o")
        body = f"""
        IF ({new_event}) IN (SELECT event_id FROM standby.detached_events) THEN RETURN NULL; END IF;
        IF TG_OP = 'UPDATE' THEN
          o := OLD;
          IF ({old_event}) IN (SELECT event_id FROM standby.detached_events) THEN RETURN NULL; END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;"""  # noqa: S608
    return f"""
    CREATE OR REPLACE FUNCTION standby.guard_{table}() RETURNS trigger LANGUAGE plpgsql AS $guard$
    DECLARE r public.{table}; o public.{table};
    BEGIN
      IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
      {body}
    END
    $guard$;
    DROP TRIGGER IF EXISTS standby_guard ON public.{table};
    CREATE TRIGGER standby_guard BEFORE INSERT OR UPDATE OR DELETE ON public.{table}
      FOR EACH ROW EXECUTE FUNCTION standby.guard_{table}();
    ALTER TABLE public.{table} ENABLE REPLICA TRIGGER standby_guard;
    """


async def install_guards(conn: asyncpg.Connection) -> int:
    """Create the standby schema and a guard on every table that needs one. Idempotent."""
    await conn.execute(
        """
        CREATE SCHEMA IF NOT EXISTS standby;
        CREATE TABLE IF NOT EXISTS standby.detached_events (
            event_id uuid PRIMARY KEY,
            detached_at timestamptz NOT NULL DEFAULT now(),
            detached_by text
        );
        """
    )
    links = await event_links(conn)
    tables = [r["tablename"] for r in await conn.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")]
    guarded = 0
    for table in tables:
        sql = _guard_sql(table, links.get(table))
        if sql:
            await conn.execute(sql)
            guarded += 1
    return guarded


# --- the subscription ------------------------------------------------------------------------


async def _revision(conn: asyncpg.Connection, side: str) -> str:
    try:
        revision = await conn.fetchval("SELECT version_num FROM alembic_version")
    except asyncpg.UndefinedTableError:
        revision = None
    if not revision:
        raise StandbyError("version", f"the {side} database has no schema revision (alembic_version is empty)")
    return str(revision)


async def check_versions(source: asyncpg.Connection, local: asyncpg.Connection) -> tuple[str, str]:
    """Refuse when the hosted schema is newer than the box's: its rows would not fit."""
    script = ScriptDirectory.from_config(Config(str(ALEMBIC_INI)))
    source_rev, local_rev = await _revision(source, "source"), await _revision(local, "local")
    if not schema_covers(script, local_rev, source_rev):
        raise StandbyError(
            "version",
            f"the hosted board is at schema {source_rev}, which this box ({local_rev}) does not have yet – "
            "the box has to follow the hosted board's version first (docs/STANDBY.md)",
        )
    return source_rev, local_rev


async def ensure_subscription(local: asyncpg.Connection, source_url: str, *, replace: bool = False) -> str:
    """Create the subscription on first run; afterwards pick up tables a migration added.

    The first run replaces everything on the box with the hosted data, so it refuses while the
    box holds an Ereignis of its own: then it is a board, not a box waiting to become one.
    """
    exists = await local.fetchval("SELECT 1 FROM pg_subscription WHERE subname = $1", SUBSCRIPTION)
    if exists:
        await local.execute(f"ALTER SUBSCRIPTION {SUBSCRIPTION} REFRESH PUBLICATION")
        return "refreshed"

    if not replace and await local.fetchval("SELECT EXISTS (SELECT 1 FROM public.events)"):
        raise StandbyError(
            "in_use",
            "this box holds an Ereignis of its own, so it is a board and not a standby – "
            "the mirror is only set up on a box without Ereignisse",
        )
    kept = [r for r in await local.fetch("SELECT key, value FROM public.settings") if is_local_setting(r["key"])]
    tables = [
        r["tablename"]
        for r in await local.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        if r["tablename"] not in SKIPPED_TABLES
    ]
    async with local.transaction():
        await local.execute("TRUNCATE " + ", ".join(f'public."{t}"' for t in tables) + " CASCADE")
        await local.executemany("INSERT INTO public.settings (key, value) VALUES ($1, $2)", [tuple(r) for r in kept])
    # Not in a transaction block: Postgres refuses CREATE SUBSCRIPTION inside one.
    conninfo = libpq_url(source_url).replace("'", "''")
    await local.execute(
        f"CREATE SUBSCRIPTION {SUBSCRIPTION} CONNECTION '{conninfo}' PUBLICATION {PUBLICATION} WITH (copy_data = true)"
    )
    return "created"


async def reset(local: asyncpg.Connection, source_url: str) -> str:
    """Make the box a pure mirror again, after an outage whose work was carried back by hand.

    Drops the subscription (and its slot on the hosted side), forgets which Ereignisse were
    taken offline, and copies everything again – the box's own work on them is replaced by the
    hosted version. Take a backup first (`just backup`).
    """
    await local.execute(f"DROP SUBSCRIPTION IF EXISTS {SUBSCRIPTION}")
    await install_guards(local)
    await local.execute("DELETE FROM standby.detached_events")
    return await ensure_subscription(local, source_url, replace=True)


async def mirror_state(conn: asyncpg.Connection) -> MirrorState:
    """The mirror as the box sees it. Readable by the backend for the band and the takeover."""
    row = await conn.fetchrow(
        """
        SELECT s.subenabled AS enabled,
               st.last_msg_receipt_time AS received,
               COALESCE(ss.apply_error_count, 0) AS errors
        FROM pg_subscription s
        LEFT JOIN pg_stat_subscription st ON st.subid = s.oid AND st.relid IS NULL
        LEFT JOIN pg_stat_subscription_stats ss ON ss.subid = s.oid
        WHERE s.subname = $1
        """,
        SUBSCRIPTION,
    )
    detached: dict[uuid.UUID, datetime] = {}
    if await conn.fetchval("SELECT to_regclass('standby.detached_events') IS NOT NULL"):
        detached = {r["event_id"]: r["detached_at"] for r in await conn.fetch("SELECT * FROM standby.detached_events")}
    if row is None:
        return MirrorState(configured=False, detached=detached)
    return MirrorState(
        configured=True,
        enabled=row["enabled"],
        last_received_at=row["received"],
        apply_errors=row["errors"],
        detached=detached,
    )


async def detach_event(conn: asyncpg.Connection, event_id: uuid.UUID, by: str) -> datetime:
    """Take one Ereignis offline for good. Returns when; idempotent for an already detached one."""
    if not await conn.fetchval("SELECT to_regclass('standby.detached_events') IS NOT NULL"):
        raise StandbyError("config", "the standby is not set up on this box yet")
    if not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM public.events WHERE id = $1)", event_id):
        raise StandbyError("unknown_event", "this Ereignis does not exist on this box")
    when: datetime = await conn.fetchval(
        """
        INSERT INTO standby.detached_events (event_id, detached_by) VALUES ($1, $2)
        ON CONFLICT (event_id) DO UPDATE SET event_id = EXCLUDED.event_id
        RETURNING detached_at
        """,
        event_id,
        by,
    )
    return when


# --- photos ----------------------------------------------------------------------------------


async def missing_photos(conn: asyncpg.Connection, photos_dir: Path) -> list[tuple[uuid.UUID, str]]:
    """Photos the mirrored reports list that this box does not have on disk yet."""
    rows = await conn.fetch(
        """
        SELECT incident_id, jsonb_array_elements_text(photos_json) AS name FROM public.reko_reports
          WHERE jsonb_typeof(photos_json) = 'array'
        UNION
        SELECT incident_id, jsonb_array_elements_text(photos_json) FROM public.schadenplatz_reports
          WHERE jsonb_typeof(photos_json) = 'array'
        """
    )
    return [
        (r["incident_id"], r["name"])
        for r in rows
        if "/" not in r["name"] and not (photos_dir / str(r["incident_id"]) / r["name"]).exists()
    ]


# A photo that would not download, and a login that failed, are left alone for a while: the
# loop runs every half minute, and logging in that often against a refusing board is exactly
# what its login throttle locks an account for.
PHOTO_RETRY_AFTER = timedelta(hours=1)
LOGIN_RETRY_AFTER = timedelta(minutes=15)
_photo_failed: dict[tuple[uuid.UUID, str], datetime] = {}
_login_failed_at: datetime | None = None


async def fetch_photos(conn: asyncpg.Connection, photos_dir: Path, api: str, user: str, password: str) -> int:
    """Download the missing photos from the hosted board, with a read-only login. Returns how many."""
    global _login_failed_at
    now = datetime.now(UTC)
    wanted = [
        w
        for w in await missing_photos(conn, photos_dir)
        if now - _photo_failed.get(w, now - PHOTO_RETRY_AFTER) >= PHOTO_RETRY_AFTER
    ]
    if not wanted or (_login_failed_at and now - _login_failed_at < LOGIN_RETRY_AFTER):
        return 0
    fetched = 0
    async with httpx.AsyncClient(base_url=api.rstrip("/"), timeout=30) as client:
        login = await client.post("/api/auth/login", data={"username": user, "password": password})
        if login.status_code != 200:
            _login_failed_at = now
            raise StandbyError("photos", f"the photo login on the hosted board failed (HTTP {login.status_code})")
        _login_failed_at = None
        for incident_id, name in wanted:
            resp = await client.get(f"/api/photos/{incident_id}/{name}")
            if resp.status_code != 200:
                _photo_failed[(incident_id, name)] = now  # removed meanwhile, or not readable this way
                continue
            target = photos_dir / str(incident_id) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(".part")
            tmp.write_bytes(resp.content)
            tmp.replace(target)
            fetched += 1
    return fetched


# --- the sidecar ----------------------------------------------------------------------------


def _log(message: str) -> None:
    print(f"{datetime.now().astimezone().isoformat(timespec='seconds')}  {message}", flush=True)


def _status_dir() -> Path:
    return Path(os.environ.get("STANDBY_STATUS_DIR", "/mnt/data/standby"))


def write_status(status: str, stage: str, message: str, details: dict[str, Any] | None = None) -> None:
    """Record one round's outcome – the file `--check` reads and an operator can open."""
    directory = _status_dir()
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status,
        "stage": stage,
        "finished_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "message": message,
        **(details or {}),
    }
    tmp = directory / f"{STATUS_FILE_NAME}.tmp"
    tmp.write_text(json.dumps(payload, indent=2, default=str) + "\n")
    tmp.replace(directory / STATUS_FILE_NAME)


async def run_once(setup: bool) -> bool:
    """One round: (on `setup`) guards and subscription, then versions, health and photos."""
    source_url = os.environ.get("STANDBY_SOURCE_URL", "")
    local_url = os.environ.get("DATABASE_URL", "")
    try:
        if not source_url or not local_url:
            raise StandbyError("config", "STANDBY_SOURCE_URL and DATABASE_URL must both be set (docs/STANDBY.md)")
        try:
            local = await asyncpg.connect(libpq_url(local_url), timeout=30)
        except (OSError, asyncpg.PostgresError, TimeoutError) as exc:
            raise StandbyError("connect", f"cannot reach this box's database: {exc}") from exc
        try:
            details: dict[str, Any] = {}
            try:
                source = await asyncpg.connect(libpq_url(source_url), timeout=30)
            except (OSError, asyncpg.PostgresError, TimeoutError):
                source = None  # offline is the normal case on the day; the mirror says how old it is
            if source is not None:
                try:
                    details["source_revision"], details["local_revision"] = await check_versions(source, local)
                finally:
                    await source.close()
            if setup:
                details["guarded_tables"] = await install_guards(local)
                if source is not None:
                    details["subscription"] = await ensure_subscription(local, source_url)
            state = await mirror_state(local)
            details.update(
                last_received_at=state.last_received_at,
                apply_errors=state.apply_errors,
                detached=len(state.detached),
            )
            if not state.configured:
                raise StandbyError("connect", "no mirror yet – the hosted database has not been reachable")
            user, password = os.environ.get("STANDBY_PHOTO_USER", ""), os.environ.get("STANDBY_PHOTO_PASSWORD", "")
            api = os.environ.get("STANDBY_SOURCE_API", "")
            if source is not None and user and password and api:
                details["photos_fetched"] = await fetch_photos(
                    local, Path(os.environ.get("PHOTOS_DIR", "/mnt/data/photos")), api, user, password
                )
        finally:
            await local.close()
    except StandbyError as exc:
        _log(f"ERROR  [{exc.stage}] {exc}")
        write_status("failed", exc.stage, str(exc))
        return False
    except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, httpx.HTTPError) as exc:
        _log(f"ERROR  [mirror] {type(exc).__name__}: {exc}")
        write_status("failed", "mirror", f"{type(exc).__name__}: {exc}")
        return False
    if not state.current:
        message = "the hosted board has not been heard from recently" if state.enabled else "the mirror is disabled"
        write_status("stale", "mirror", message, details)
        return False
    write_status("ok", "mirror", "mirror current", details)
    return True


async def run_loop() -> None:
    """Set up, then keep reporting. A failed round is reported and the next one sets up again."""
    interval = float(os.environ.get("STANDBY_INTERVAL_SECONDS", "30"))
    _log(f"standby mirror started – every {interval:.0f} s")
    setup = True
    while True:
        ok = await run_once(setup)
        setup = not ok  # after a failure, re-check guards and the subscription next round
        await asyncio.sleep(interval)


async def _reset_from_env() -> int:
    local = await asyncpg.connect(libpq_url(os.environ["DATABASE_URL"]), timeout=30)
    try:
        _log(f"mirror reset: {await reset(local, os.environ['STANDBY_SOURCE_URL'])}")
    finally:
        await local.close()
    return 0


def check() -> int:
    """Exit code for the healthcheck: 0 when a recent round found the mirror running."""
    path = _status_dir() / STATUS_FILE_NAME
    try:
        status = json.loads(path.read_text())
    except (OSError, ValueError):
        print(f"no standby round has run yet ({path} missing or unreadable)", file=sys.stderr)
        return 1
    age = datetime.now().astimezone() - datetime.fromisoformat(status["finished_at"])
    if age > timedelta(minutes=10):
        print(f"the standby sidecar has not reported for {age}", file=sys.stderr)
        return 1
    if status.get("status") != "ok":
        print(f"standby mirror not current [{status.get('stage')}]: {status.get('message')}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "--loop":
        asyncio.run(run_loop())
        return 0
    if mode == "--check":
        return check()
    if mode == "--reset":
        return asyncio.run(_reset_from_env())
    return 0 if asyncio.run(run_once(setup=True)) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
