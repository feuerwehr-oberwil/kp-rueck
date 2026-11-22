"""Lifecycle code lives in the app's `lifespan` context (app/main.py), never in FastAPI's
deprecated startup/shutdown events (docs/BACKEND.md › Backend conventions).

The suite ignores DeprecationWarning (pyproject `filterwarnings`), so FastAPI's own warning
would never fail a run: this test reads the source instead. It parses app/ as Python, so a
mention in a comment or a string does not count.
"""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
EVENT_HOOKS = {"on_event", "add_event_handler"}


def test_no_startup_or_shutdown_event_handlers() -> None:
    offenders = [
        f"{path.relative_to(APP.parent)}:{node.lineno}"
        for path in sorted(APP.rglob("*.py"))
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.Attribute) and node.attr in EVENT_HOOKS
    ]
    assert offenders == [], "Move it into the lifespan context in app/main.py"
