"""Every JSON success response publishes its shape – the drift test can only see what is typed.

A route that answers ``dict[str, Any]`` publishes ``{}`` in `docs/openapi.json`, so the
committed contract (and the client types built from it) cannot notice when its body
changes. Give every route a ``response_model``; a download names its own content type
(``response_class`` plus ``responses={200: {"content": {...}}}``) so it is not listed as JSON.
"""

from app.main import app


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
    assert not untyped, f"give these a response_model: {sorted(untyped)}"
