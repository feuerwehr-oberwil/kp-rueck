"""Dump the FastAPI OpenAPI schema to a file — the committed API contract an integrator
can read without running the stack.

    uv run python -m app.dump_openapi [output.json]   # default: ../docs/openapi.json
    just openapi

Why commit it at all: the live Swagger UI is a running-server affair, so anyone writing a
dispatch-system adapter against `POST /api/alarms`, or a print agent against the job queue,
otherwise has to boot Postgres and the backend before they can see the request shape. A file
in the repo is the difference between generating a client and guessing.

``app.openapi()`` builds the schema from every registered route regardless of whether the
HTTP /openapi.json endpoint is exposed, so this works in any environment.
"""

import json
import sys
from pathlib import Path

from .main import app

_DEFAULT = Path(__file__).resolve().parents[2] / "docs" / "openapi.json"


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT
    schema = app.openapi()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    paths = len(schema.get("paths", {}))
    info = schema.get("info", {})
    print(f"✓ Wrote {info.get('title')} {info.get('version')} OpenAPI ({paths} paths) → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
