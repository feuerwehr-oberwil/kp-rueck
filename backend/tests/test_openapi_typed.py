"""Every JSON success response publishes its shape – the drift test can only see what is typed.

A route that answers ``dict[str, Any]`` publishes ``{}`` in `docs/openapi.json`, so the
committed contract (and the client types built from it) cannot notice when its body
changes. Give a new route a ``response_model``. The routes below answer something that is
not a JSON object of a known shape (a file, a webhook ack, a passthrough) or are still to be
typed; take a route off the list when it gets its model.
"""

from app.main import app

STILL_UNTYPED = {
    ("GET", "/health"),
    ("GET", "/health/detailed"),
    ("GET", "/api/deployment"),
    ("GET", "/api/demo/status"),
    ("POST", "/api/demo/sandbox"),
    ("POST", "/api/demo/reset"),
    ("GET", "/api/admin/import/template"),
    ("GET", "/api/admin/export/data"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/diag/export"),
    ("GET", "/api/diag/telemetry"),
    ("PUT", "/api/diag/telemetry/consent"),
    ("POST", "/api/diag/telemetry/install-id"),
    ("GET", "/api/diag/client-address"),
    ("POST", "/api/divera/webhook"),
    ("GET", "/api/divera/polling/status"),
    ("POST", "/api/firehub/webhook"),
    ("POST", "/api/exports/events/{event_id}/audit"),
    ("GET", "/api/exports/events/{event_id}/report"),
    ("GET", "/api/exports/events/{event_id}/lageblatt"),
    ("GET", "/api/exports/events/{event_id}/einsaetze.xlsx"),
    ("GET", "/api/integrations/roster-snapshot"),
    ("POST", "/api/integrations/roster-snapshot/sync"),
    ("GET", "/api/personnel/check-in/stats"),
    ("POST", "/api/reko/{incident_id}/photos"),
    ("DELETE", "/api/reko/{incident_id}/photos/{filename}"),
    ("POST", "/api/reko/transfer-rekos"),
    ("GET", "/api/feld/incidents/{incident_id}/photos/{filename}"),
    ("GET", "/api/settings/branding/logo"),
    ("POST", "/api/training/gps-sim/stop"),
}


def _untyped(schema: dict[str, object]) -> bool:
    """`{}`, or an object that names neither its properties, a model nor its value type."""
    if not schema:
        return True
    return (
        schema.get("type") == "object"
        and "properties" not in schema
        and not isinstance(schema.get("additionalProperties"), dict)
    )


def test_json_success_responses_are_typed():
    untyped = set()
    for path, operations in app.openapi()["paths"].items():
        for method, operation in operations.items():
            for status, response in operation.get("responses", {}).items():
                body = response.get("content", {}).get("application/json")
                if status.startswith("2") and body is not None and _untyped(body.get("schema", {})):
                    untyped.add((method.upper(), path))
    assert not untyped - STILL_UNTYPED, f"give these a response_model: {sorted(untyped - STILL_UNTYPED)}"
    assert not STILL_UNTYPED - untyped, f"typed now – take them off STILL_UNTYPED: {sorted(STILL_UNTYPED - untyped)}"
