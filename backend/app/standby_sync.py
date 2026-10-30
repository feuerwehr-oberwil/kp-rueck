"""Copy a hosted board's configuration onto a standby box every night, one way.

A station whose board runs hosted (Railway) can keep a compose stack in the Magazin as a
standby: the day the internet drops, that box still answers on the LAN. A box with no roster
is no use on that day, though, so the `standby-sync` sidecar (profile `standby`) runs this
module and copies the station's configuration – users, settings, fleet, roster, material,
templates, training locations – from the hosted database. Einsätze are not copied: on the
day, the paper Lageblatt carries the running operation over (docs/AUSFALL_SOP.md).

    python -m app.standby_sync           copy once, now
    python -m app.standby_sync --loop    copy daily at STANDBY_SYNC_AT (the compose sidecar)
    python -m app.standby_sync --check   exit 0 only if the last copy succeeded and is recent

Environment:

    STANDBY_SOURCE_URL     the hosted database – a read-only login (docs/STANDBY.md)
    DATABASE_URL           this box's database (set by docker-compose.yml)
    STANDBY_SYNC_AT        HH:MM for --loop                      (default 04:15)
    STANDBY_SYNC_ON_START  --loop copies once immediately        (default true)
    STANDBY_STATUS_DIR     where last-sync.json goes             (default /mnt/data/standby)
    STANDBY_MAX_AGE_HOURS  staleness --check tolerates           (default 26)

It refuses, and changes nothing, in two cases:

- **The box has its own Ereignis.** Then it is the board, not a standby, and a copy would
  replace the roster under a running operation. The copy stays off until the box's
  Ereignisse are gone.
- **The hosted schema is newer than this box's.** The box is updated by release, the hosted
  board by merge, so the box falls behind. Its tables cannot hold the newer data, so the
  copy waits until the box is updated (docs/DEPLOYMENT.md §4).

The source is only ever read, inside a read-only transaction, even if the login could write.
The box side runs in one transaction: either the whole configuration is replaced or nothing is.
"""

import asyncio
import json
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import asyncpg
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError

# The configuration tables, parents before children – rows are inserted in this order, and a
# foreign key between two of them is checked as each row lands. Every other table is
# operational and stays as it is. A new configuration table goes here AND into dev-sync's
# CONFIG_TABLES (scripts/dev-sync.sh); a test holds the two lists and the order together.
CONFIG_TABLES: tuple[str, ...] = (
    "users",
    "settings",
    "vehicles",
    "personnel",
    "personnel_external_identities",
    "material_groups",
    "materials",
    "special_function_types",
    "emergency_templates",
    "training_locations",
    "auftrag_templates",
    "auftrag_template_resources",
)

# Settings that describe THIS box, not the station. They keep the box's own value.
# - alarm_webhook_secret: each deployment has its own, or one alarm is accepted by both
#   (docs/RUNNING-BOTH.md).
# - map_mode: the hosted board has no tile server; the box has one, and needs `auto` or
#   `offline` to fall back to it.
# - railway_database_url: a connection string pointing outward must never arrive with a copy.
# - seed.completed_at, deployment_role: markers of how this database was created.
# - telemetry.*: the install id and consent belong to one installation.
# - roster_snapshot.*: the status of this box's own roster reads.
LOCAL_SETTINGS = frozenset(
    {"alarm_webhook_secret", "map_mode", "railway_database_url", "seed.completed_at", "deployment_role"}
)
LOCAL_SETTING_PREFIXES = ("telemetry.", "roster_snapshot.")

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
STATUS_FILE_NAME = "last-sync.json"


class StandbySyncError(Exception):
    """The copy did not run, and why – `stage` names the step for the status file."""

    def __init__(self, stage: str, message: str) -> None:
        super().__init__(message)
        self.stage = stage


@dataclass
class SyncReport:
    """What one copy did: the two schema revisions and the rows written per table."""

    source_revision: str
    local_revision: str
    rows: dict[str, int] = field(default_factory=dict)


def is_local_setting(key: str) -> bool:
    """True for a setting that keeps the box's own value (see LOCAL_SETTINGS)."""
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
    """The URL asyncpg accepts: SQLAlchemy writes its driver into the scheme, libpq does not."""
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _revision(conn: asyncpg.Connection, side: str) -> str:
    try:
        revision = await conn.fetchval("SELECT version_num FROM alembic_version")
    except asyncpg.UndefinedTableError:
        revision = None
    if not revision:
        raise StandbySyncError("version", f"the {side} database has no schema revision (alembic_version is empty)")
    return str(revision)


async def _local_columns(conn: asyncpg.Connection, table: str) -> set[str]:
    rows = await conn.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        table,
    )
    return {row["column_name"] for row in rows}


async def sync_once(source_url: str, local_url: str) -> SyncReport:
    """Replace the box's configuration with the source's. Raises StandbySyncError, changing nothing."""
    script = ScriptDirectory.from_config(Config(str(ALEMBIC_INI)))
    try:
        source = await asyncpg.connect(libpq_url(source_url), timeout=30)
    except (OSError, asyncpg.PostgresError, TimeoutError) as exc:
        raise StandbySyncError("connect", f"cannot reach the source database: {exc}") from exc
    try:
        local = await asyncpg.connect(libpq_url(local_url), timeout=30)
    except (OSError, asyncpg.PostgresError, TimeoutError) as exc:
        await source.close()
        raise StandbySyncError("connect", f"cannot reach this box's database: {exc}") from exc

    try:
        # One snapshot across all tables, and no write possible whatever the login may do.
        async with source.transaction(isolation="repeatable_read", readonly=True):
            report = SyncReport(await _revision(source, "source"), await _revision(local, "local"))
            if not schema_covers(script, report.local_revision, report.source_revision):
                raise StandbySyncError(
                    "version",
                    f"the source is at schema {report.source_revision}, which this box ({report.local_revision}) "
                    "does not have yet – update the box to a release at least as new (docs/DEPLOYMENT.md §4)",
                )
            # Table names come from CONFIG_TABLES, never from input.
            data = {table: await source.fetch(f'SELECT * FROM "{table}"') for table in CONFIG_TABLES}  # noqa: S608

        async with local.transaction():
            # A board request holding a lock fails this copy after 30 s rather than hanging it.
            await local.execute("SET LOCAL lock_timeout = '30s'")
            # Inside the transaction, so no Ereignis can be opened between the check and the copy.
            await local.execute("LOCK TABLE events IN SHARE MODE")
            if await local.fetchval("SELECT EXISTS (SELECT 1 FROM events)"):
                raise StandbySyncError(
                    "in_use",
                    "this box holds an Ereignis of its own, so it is the board now and not a standby – "
                    "the copy stays off until its Ereignisse are deleted",
                )
            kept = [row for row in await local.fetch("SELECT key, value FROM settings") if is_local_setting(row["key"])]

            # CASCADE empties what points at these rows – with no Ereignis that is the box's own
            # audit trail, notifications and print jobs, none of which outlive the standby role.
            await local.execute("TRUNCATE " + ", ".join(f'"{t}"' for t in CONFIG_TABLES) + " CASCADE")

            for table in CONFIG_TABLES:
                records: Sequence[asyncpg.Record] = data[table]
                if table == "settings":
                    records = [r for r in records if not is_local_setting(r["key"])]
                report.rows[table] = len(records)
                if not records:
                    continue
                columns = list(records[0].keys())
                missing = set(columns) - await _local_columns(local, table)
                if missing:
                    raise StandbySyncError(
                        "version",
                        f"{table} on the source has columns this box does not: {', '.join(sorted(missing))}",
                    )
                await local.copy_records_to_table(table, records=[tuple(r) for r in records], columns=columns)

            await local.executemany(
                "INSERT INTO settings (key, value) VALUES ($1, $2)", [(r["key"], r["value"]) for r in kept]
            )
        return report
    except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError) as exc:
        raise StandbySyncError("copy", f"{type(exc).__name__}: {exc}") from exc
    finally:
        await source.close()
        await local.close()


# --- the sidecar: status file, loop and healthcheck ---------------------------------------


def _log(message: str) -> None:
    print(f"{datetime.now().astimezone().isoformat(timespec='seconds')}  {message}", flush=True)


def _status_dir() -> Path:
    return Path(os.environ.get("STANDBY_STATUS_DIR", "/mnt/data/standby"))


def write_status(directory: Path, status: str, stage: str, message: str, report: SyncReport | None = None) -> None:
    """Record the outcome of one run – the file `--check` reads and an operator can open."""
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status,
        "stage": stage,
        "finished_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "message": message,
        "source_revision": report.source_revision if report else None,
        "local_revision": report.local_revision if report else None,
        "rows": report.rows if report else {},
    }
    tmp = directory / f"{STATUS_FILE_NAME}.tmp"
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(directory / STATUS_FILE_NAME)


async def run_once() -> bool:
    """One copy with its status file written, whatever happens. True on success."""
    directory = _status_dir()
    source_url = os.environ.get("STANDBY_SOURCE_URL", "")
    local_url = os.environ.get("DATABASE_URL", "")
    try:
        if not source_url or not local_url:
            raise StandbySyncError("config", "STANDBY_SOURCE_URL and DATABASE_URL must both be set (docs/STANDBY.md)")
        report = await sync_once(source_url, local_url)
    except StandbySyncError as exc:
        _log(f"ERROR  [{exc.stage}] {exc}")
        write_status(directory, "failed", exc.stage, str(exc))
        return False
    total = sum(report.rows.values())
    _log(f"✓ configuration copied: {total} rows, schema {report.source_revision} → {report.local_revision}")
    write_status(directory, "ok", "complete", f"{total} rows", report)
    return True


def seconds_until(at: str, now: datetime) -> float:
    """Seconds from `now` to the next HH:MM – tomorrow's when today's has passed."""
    hour, minute = (int(part) for part in at.split(":"))
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def run_loop() -> None:
    """Copy daily at STANDBY_SYNC_AT. A failed copy leaves its status and the loop goes on."""
    at = os.environ.get("STANDBY_SYNC_AT", "04:15")
    _log(f"standby sync started – daily at {at}")
    if os.environ.get("STANDBY_SYNC_ON_START", "true") == "true":
        # Now rather than at 04:15, so a wrong URL or a missing grant fails while someone is looking.
        await run_once()
    while True:
        wait = seconds_until(at, datetime.now().astimezone())
        _log(f"next copy in {int(wait // 3600)}h {int(wait % 3600 // 60)}min (at {at})")
        await asyncio.sleep(wait)
        await run_once()


def check() -> int:
    """Exit code for the healthcheck: 0 when the last copy succeeded within the allowed age."""
    path = _status_dir() / STATUS_FILE_NAME
    max_age = timedelta(hours=float(os.environ.get("STANDBY_MAX_AGE_HOURS", "26")))
    try:
        status = json.loads(path.read_text())
    except (OSError, ValueError):
        print(f"no standby sync has run yet ({path} missing or unreadable)", file=sys.stderr)
        return 1
    if status.get("status") != "ok":
        print(f"last standby sync FAILED [{status.get('stage')}]: {status.get('message')}", file=sys.stderr)
        return 1
    if datetime.now().astimezone() - datetime.fromisoformat(status["finished_at"]) > max_age:
        print(f"last standby sync is older than {max_age}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "--loop":
        asyncio.run(run_loop())
        return 0
    if mode == "--check":
        return check()
    return 0 if asyncio.run(run_once()) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
