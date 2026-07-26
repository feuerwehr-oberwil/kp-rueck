"""Shared pieces: the job record, an HTTP helper, and logging.

Stdlib only, on purpose. The core of this agent — HTTP, both protocol drivers and the CUPS
output — must install on a bare Raspberry Pi with no venv and no Docker, because that is the
install path a station actually uses. Only the ESC/POS output reaches for third-party
packages, and it imports them lazily so a CUPS-only station never needs them.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field

# Under systemd there is often no locale, so stdout falls back to latin-1 and a single
# non-latin-1 character in a log line would kill the loop. Force UTF-8; never crash on a log.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def log(msg: str) -> None:
    print(msg, flush=True)  # journald / docker logs add the timestamp


class FatalError(Exception):
    """Unrecoverable for this backend — a wrong secret, not a bad minute.

    Retrying cannot fix it, so the worker stops instead of hammering the backend with
    requests that will keep being rejected.
    """


@dataclass
class Job:
    """One print job, in whichever shape its protocol delivers.

    The two backends differ fundamentally here and the difference is not worth hiding:
    KP Front composes the document server-side and hands over an opaque PDF, KP Rück sends
    structured JSON and expects the agent to render it. An output driver consumes one or the
    other, so a mismatch (`escpos` against a PDF) is a config error, reported as one.
    """

    id: str
    backend: str
    kind: str = ""
    document: bytes | None = None  # KP Front: the composed PDF
    payload: dict = field(default_factory=dict)  # KP Rück: structured content
    filename: str | None = None
    color: bool = False


def request(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    method: str | None = None,
    body: bytes | None = None,
    json_body: dict | None = None,
    timeout: float = 30.0,
) -> tuple[int, bytes]:
    """One HTTP round trip. Returns (status, body) and does not raise on an HTTP error status.

    An HTTP error is data here, not an exception: every caller has to distinguish 204 from
    403 from 500 anyway, and letting HTTPError escape would mean each of them wrapping this
    in the same try/except.
    """
    hdrs = dict(headers or {})
    if json_body is not None:
        body = json.dumps(json_body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method or ("POST" if body is not None else "GET"), headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
