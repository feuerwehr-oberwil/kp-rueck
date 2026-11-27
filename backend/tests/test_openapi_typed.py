"""Every JSON success response publishes its shape – the drift test can only see what is typed.

A route that answers ``dict[str, Any]`` publishes ``{}`` in `docs/openapi.json`, so the
committed contract (and the client types built from it) cannot notice when its body
changes. Give every route a ``response_model``; a download names its own content type
(``response_class`` plus ``responses={200: {"content": {...}}}``) so it is not listed as JSON.
"""

import types
import typing
from collections.abc import Iterator

from fastapi.datastructures import DefaultPlaceholder
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel

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


def _api_routes(routes: list) -> Iterator[APIRoute]:
    """Every APIRoute, through the routers `include_router` wraps."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from _api_routes(route.original_router.routes)


def _is_model(annotation: object) -> bool:
    """A pydantic model, or a union of them."""
    union = typing.get_origin(annotation) in (typing.Union, types.UnionType)
    members = typing.get_args(annotation) if union else (annotation,)
    return all(isinstance(m, type) and issubclass(m, BaseModel) for m in members)


def _answers_json(route: APIRoute) -> bool:
    response_class = route.response_class
    if isinstance(response_class, DefaultPlaceholder):
        response_class = response_class.value
    return issubclass(response_class, JSONResponse) and route.status_code != 204


def test_hidden_json_routes_are_typed():
    """`include_in_schema=False` routes (the standby box's sync) are not in the contract, so the
    test above cannot see them; their handlers get a model all the same."""
    untyped = sorted(
        (sorted(route.methods), route.path)
        for route in _api_routes(app.routes)
        if not route.include_in_schema and _answers_json(route) and not _is_model(route.response_model)
    )
    assert not untyped, f"give these a response_model: {untyped}"
