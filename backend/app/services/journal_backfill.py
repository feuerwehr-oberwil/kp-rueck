# ruff: noqa: S608 — every SQL fragment here is a module constant; nothing user-supplied is spliced in.
"""Einsatztagebuch backfill — the log rebuilt from the tables that already hold the facts.

Runs on every boot (`main.lifespan`) and is idempotent: each statement writes the same rows
the flush hook (`services/journal.py`) writes, under the same `source_key`, and only the
keys the log does not hold yet. So it

* fills `journal_entries` once, the first time a station boots this version — the PDF of
  an existing Ereignis keeps every line it printed;
* picks up what an OLD instance wrote during a rolling cutover (it had no hook) and
  anything the hook skipped because it failed — the hook never fails a board write, it
  logs and moves on, and this is where the line comes back.

What it cannot rebuild: field Meldungen and field facts whose audit rows were already
swept by `AUDIT_RETENTION_DAYS`, a release that was taken back (the assignment row only
remembers its last state) and a cleared Reko arrival. Those exist only as the hook wrote
them.

The keys must stay in step with the hook — a key spelled differently here is a duplicate
line in every Ereignis. `tests/test_services/test_journal.py` pins that both write the same
rows and that a second run writes none.
"""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

logger = logging.getLogger(__name__)

#: Serialises two instances booting at once (Railway overlaps old and new).
_LOCK_KEY = 0x6A6F75726E616C  # "journal"

_GPS_USER = "00000000-0000-0000-0000-0000000000a1"  # services.gps_automation.GPS_SYSTEM_USER_ID

_USER_NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)"

#: Exact milliseconds since the epoch (EXTRACT returns numeric since PG 14) — the same
#: integer `services.journal.ms` computes.
_MS = "floor(extract(epoch FROM {col}) * 1000)::bigint"

_RESOURCE_NAME = """
    CASE a.resource_type
        WHEN 'personnel' THEN COALESCE(p.name, a.resource_id::text)
        WHEN 'vehicle' THEN COALESCE(
            CASE WHEN COALESCE(v.radio_call_sign, '') <> '' THEN v.name || ' (' || v.radio_call_sign || ')'
                 ELSE v.name END,
            a.resource_id::text)
        WHEN 'material' THEN COALESCE(m.name, a.resource_id::text)
        ELSE a.resource_id::text
    END
"""

_ASSIGNMENT_JOINS = """
    FROM incident_assignments a
    JOIN incidents i ON i.id = a.incident_id
    LEFT JOIN personnel p ON a.resource_type = 'personnel' AND p.id = a.resource_id
    LEFT JOIN vehicles v ON a.resource_type = 'vehicle' AND v.id = a.resource_id
    LEFT JOIN materials m ON a.resource_type = 'material' AND m.id = a.resource_id
    LEFT JOIN users u ON u.id = a.assigned_by
"""

# An ISO timestamp from an audit row's changes, or NULL — never a cast error that would
# abort the whole backfill over one malformed row.
_TS = (
    "CASE WHEN (l.changes_json->>'{k}') ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}' THEN (l.changes_json->>'{k}')::timestamptz END"
)

#: Each SELECT yields: event_id, incident_id, kind, text, data, occurred_at, author_name,
#: created_by, source_key.
SELECTS: tuple[str, ...] = (
    # Einsatz erstellt
    f"""
    SELECT i.event_id, i.id, 'incident', NULL,
           jsonb_build_object('action', 'created', 'title', i.title, 'source', i.source),
           i.created_at, LEFT({_USER_NAME}, 100), i.created_by, 'incident:' || i.id || ':created'
    FROM incidents i LEFT JOIN users u ON u.id = i.created_by
    WHERE i.created_at IS NOT NULL
    """,
    # Status
    f"""
    SELECT i.event_id, i.id, 'status', NULL,
           jsonb_build_object('from_status', t.from_status, 'to_status', t.to_status),
           t.timestamp, LEFT({_USER_NAME}, 100), t.user_id, 'status:' || t.id
    FROM status_transitions t
    JOIN incidents i ON i.id = t.incident_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.timestamp IS NOT NULL AND t.from_status <> t.to_status
    """,
    # zugeteilt
    f"""
    SELECT i.event_id, i.id, 'assignment', NULL,
           jsonb_build_object('action', 'assigned', 'resource_type', a.resource_type,
                              'resource_name', {_RESOURCE_NAME}),
           a.assigned_at, LEFT({_USER_NAME}, 100), a.assigned_by,
           'assign:' || a.id || ':' || {_MS.format(col="a.assigned_at")}
    {_ASSIGNMENT_JOINS}
    WHERE a.assigned_at IS NOT NULL
    """,
    # vom Einsatz abgezogen
    f"""
    SELECT i.event_id, i.id, 'assignment', NULL,
           jsonb_build_object('action', 'unassigned', 'resource_type', a.resource_type,
                              'resource_name', {_RESOURCE_NAME}),
           a.unassigned_at, NULL, NULL::uuid,
           'unassign:' || a.id || ':' || {_MS.format(col="a.unassigned_at")}
    {_ASSIGNMENT_JOINS}
    WHERE a.unassigned_at IS NOT NULL
    """,
    # Reko-Bericht eingegangen (filed only)
    f"""
    SELECT i.event_id, i.id, 'reko', NULLIF(btrim(r.summary_text), ''),
           jsonb_build_object('relevant', r.is_relevant),
           r.submitted_at, LEFT(COALESCE(p.name, {_USER_NAME}), 100), NULL::uuid,
           'reko:' || r.id || ':' || {_MS.format(col="r.submitted_at")}
    FROM reko_reports r
    JOIN incidents i ON i.id = r.incident_id
    LEFT JOIN personnel p ON p.id = r.submitted_by_personnel_id
    LEFT JOIN users u ON u.id = r.created_by_user_id
    WHERE NOT COALESCE(r.is_draft, false) AND r.submitted_at IS NOT NULL
    """,
    # Reko vor Ort
    f"""
    SELECT i.event_id, i.id, 'field', NULL,
           jsonb_build_object('type', 'reko_arrived', 'source',
                              CASE WHEN r.arrived_reported_by_user_id IS NOT NULL THEN 'kp' ELSE 'feld' END),
           r.arrived_at, LEFT({_USER_NAME}, 100), NULL::uuid,
           'reko_arrived:' || r.id || ':' || {_MS.format(col="r.arrived_at")}
    FROM reko_reports r
    JOIN incidents i ON i.id = r.incident_id
    LEFT JOIN users u ON u.id = r.arrived_reported_by_user_id
    WHERE r.arrived_at IS NOT NULL
    """,
    # Meldung an den Trupp
    """
    SELECT i.event_id, i.id, 'message', f.message,
           jsonb_build_object('direction', 'to_field'),
           f.created_at, f.author_name, f.created_by, 'kpmsg:' || f.id
    FROM incident_field_messages f
    JOIN incidents i ON i.id = f.incident_id
    """,
    # Meldung vom Feld (whatever the audit sweep has left)
    f"""
    SELECT i.event_id, i.id, 'message', btrim(l.changes_json->>'message'),
           jsonb_build_object('direction', 'from_field', 'source', l.changes_json->>'source'),
           l.timestamp, LEFT(COALESCE(NULLIF(l.changes_json->>'personnel_name', ''), {_USER_NAME}), 100),
           l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.resource_type = 'incident' AND l.action_type = 'field_message'
      AND COALESCE(btrim(l.changes_json->>'message'), '') <> ''
    """,
    # Divera-Alarm
    f"""
    SELECT i.event_id, i.id, 'alarm', NULL,
           jsonb_build_object('recipients',
               CASE WHEN jsonb_typeof(l.changes_json->'recipients') = 'array'
                    THEN jsonb_array_length(l.changes_json->'recipients') END),
           l.timestamp, LEFT({_USER_NAME}, 100), l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.resource_type = 'incident' AND l.action_type = 'divera_alarm'
    """,
    # Feld: vor Ort, beendet, Abholung, Rapport erfasst — set and cleared
    f"""
    SELECT i.event_id, i.id, 'field', NULLIF(btrim(l.changes_json->>'pickup_note'), ''),
           jsonb_build_object('type', l.action_type, 'source',
               CASE WHEN l.user_id = '{_GPS_USER}'::uuid THEN 'gps' ELSE l.changes_json->>'source' END),
           COALESCE({_TS.format(k="arrived_at")}, {_TS.format(k="field_complete_reported_at")}, l.timestamp),
           CASE WHEN l.changes_json->>'source' = 'kp' THEN LEFT({_USER_NAME}, 100) END,
           l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.resource_type = 'incident'
      AND l.action_type IN ('field_arrived', 'field_arrived_cleared', 'field_complete', 'field_complete_cleared',
                            'field_pickup_requested', 'field_pickup_cleared', 'rapport_submitted')
    """,
    # Anfrage vom Feld: in Arbeit / erledigt / wieder offen (R13)
    f"""
    SELECT i.event_id, i.id, 'field', NULLIF(btrim(l.changes_json->>'label'), ''),
           jsonb_build_object('type', 'field_request_' || (l.changes_json->>'to'), 'source', NULL),
           l.timestamp, LEFT({_USER_NAME}, 100), l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.resource_type = 'incident' AND l.action_type = 'field_request_status'
      AND l.changes_json->>'to' IN ('open', 'in_progress', 'done')
    """,
    # Einsatz gelöscht / wiederhergestellt / zusammengeführt / getrennt
    f"""
    SELECT i.event_id, i.id, 'incident', NULL,
           jsonb_build_object('action', CASE l.action_type WHEN 'delete' THEN 'deleted'
                                                           WHEN 'restore' THEN 'restored'
                                                           ELSE l.action_type END,
                              'title', i.title)
           || CASE WHEN x.other_id IS NOT NULL
                   THEN jsonb_build_object('other_incident_id', o.id::text, 'other_title', o.title)
                   ELSE '{{}}'::jsonb END,
           l.timestamp, LEFT({_USER_NAME}, 100), l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    CROSS JOIN LATERAL (SELECT CASE l.action_type
        WHEN 'merge' THEN l.changes_json->>'merged_incident_id'
        WHEN 'merged_into' THEN l.changes_json->>'target_incident_id'
        WHEN 'unmerge' THEN CASE WHEN l.changes_json->>'merged_incident_id' = i.id::text
                                 THEN l.changes_json->>'target_incident_id'
                                 ELSE l.changes_json->>'merged_incident_id' END
        END AS other_id) x
    LEFT JOIN incidents o ON o.id::text = x.other_id
    WHERE l.resource_type = 'incident'
      AND l.action_type IN ('delete', 'restore', 'merge', 'merged_into', 'unmerge')
    """,
)


def statements() -> list[str]:
    """The INSERTs, each writing only keys the log does not hold yet."""
    return [
        "INSERT INTO journal_entries "
        "(id, event_id, incident_id, kind, text, data, occurred_at, author_name, created_by, source_key) "
        "SELECT gen_random_uuid(), s.* FROM ("
        + select
        + ") AS s(event_id, incident_id, kind, text, data, occurred_at, author_name, created_by, source_key) "
        "WHERE NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_key = s.source_key)"
        for select in SELECTS
    ]


async def backfill_journal(conn: AsyncConnection) -> int:
    """Run the backfill in the caller's transaction; returns the rows written."""
    await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    written = 0
    for statement in statements():
        # Raw driver SQL: the source keys contain ':' (`incident:<id>:created`), which a
        # SQLAlchemy text() would read as bind parameters.
        result = await conn.exec_driver_sql(statement)
        written += max(result.rowcount or 0, 0)
    return written


async def backfill_on_boot(engine: AsyncEngine) -> None:
    """Boot hook. Never stops the boot: a failure is logged and the next boot tries again."""
    try:
        async with engine.begin() as conn:
            written = await backfill_journal(conn)
        if written:
            logger.info("Einsatztagebuch backfill: %d rows added", written)
    except Exception:
        logger.exception("Einsatztagebuch backfill failed — will retry on the next boot")
