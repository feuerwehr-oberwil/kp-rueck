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


# ESC/POS QR sizing. python-escpos renders the code as an image of
# (modules + 2 * border) * box_size dots, with border=1 — so the box size that fits depends
# on how much content the code carries, which is why a single constant was always going to be
# wrong for one end or the other. The old fixed 4 was justified in a comment as "keeps the
# long, JWT-bearing URL within the paper width"; measured on the real printer, such a URL came
# to 53 modules = 212 dots on 576 dots of paper. It was not near the limit, just small.
QR_BORDER_MODULES = 1
# NOT the maximum that fits. 576 dots are printable (TM-T20III, 80 mm at 203 dpi) and filling
# them was tried at the station: ~64 mm of QR reads as a poster, not as a slip someone hands
# over. This aims at roughly 50 mm, which keeps a token-bearing link comfortably scannable
# while leaving the code recognisably a detail on the paper rather than the whole of it.
# The margin to 576 is deliberate too: the printer profile carries no media width, so nothing
# downstream would catch an image that is too wide — it would just come out clipped.
QR_TARGET_DOTS = 416
QR_MIN_BOX_DOTS = 4
QR_MAX_BOX_DOTS = 12


def qr_box_size(modules: int, target_dots: int = QR_TARGET_DOTS) -> int:
    """Largest module size whose rendered QR still fits `target_dots` across.

    Clamped at both ends: never below the size that used to be hardcoded, and never so large
    that a short link turns into a hand-sized square that eats the roll.
    """
    if modules <= 0:
        return QR_MIN_BOX_DOTS
    fitted = target_dots // (modules + 2 * QR_BORDER_MODULES)
    return max(QR_MIN_BOX_DOTS, min(QR_MAX_BOX_DOTS, fitted))


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
