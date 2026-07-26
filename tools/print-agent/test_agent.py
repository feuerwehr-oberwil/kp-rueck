"""End-to-end tests for the unified print agent, against stub backends.

The agent cannot be proven on real hardware in CI, so these tests drive the whole path that
does not need a printer: the real HTTP client against a real (stub) HTTP server speaking each
backend's actual wire contract, the real claim/report state machine, and the real CUPS output
driving fake `lp`/`lpstat` binaries on PATH. What is left unproven is exactly one thing —
whether paper comes out — and that is what the manual test on the Pi is for.

Stdlib only, like the agent itself. Run: `uv run pytest tools/print-agent -q`
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from agent import _build, load_backends  # noqa: E402
from core import FatalError  # noqa: E402

PDF_BYTES = b"%PDF-1.4 fake"


class _Stub(HTTPServer):
    """Records what the agent did, so a test can assert on the conversation."""

    def __init__(self, handler):
        super().__init__(("127.0.0.1", 0), handler)
        self.seen: list[tuple[str, str]] = []
        self.reported: list[dict] = []
        self.claims = 0
        self.token: str | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


class FrontHandler(BaseHTTPRequestHandler):
    """Implements kp-front's three endpoints."""

    def log_message(self, *a):  # keep pytest output readable
        pass

    def _auth_ok(self) -> bool:
        return self.headers.get("X-Print-Agent-Secret") == "front-secret"

    def do_POST(self):
        self.server.seen.append(("POST", self.path))
        if not self._auth_ok():
            self.send_response(403); self.end_headers(); return
        if self.path == "/api/print-agent/claim":
            self.server.claims += 1
            if self.server.claims > 1:  # one job, then an empty queue
                self.send_response(204); self.end_headers(); return
            body = json.dumps({"id": "job-1", "filename": "rapport.pdf", "color": False}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)
        elif self.path.endswith("/status"):
            length = int(self.headers.get("Content-Length", 0))
            self.server.reported.append(json.loads(self.rfile.read(length)))
            self.send_response(200); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

    def do_GET(self):
        self.server.seen.append(("GET", self.path))
        if not self._auth_ok():
            self.send_response(403); self.end_headers(); return
        if self.path == "/api/print-agent/jobs/job-1/file":
            self.send_response(200); self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(PDF_BYTES))); self.end_headers()
            self.wfile.write(PDF_BYTES)
        else:
            self.send_response(404); self.end_headers()


class RueckHandler(BaseHTTPRequestHandler):
    """Implements kp-rueck's four endpoints."""

    def log_message(self, *a):
        pass

    def _auth_ok(self) -> bool:
        return self.headers.get("X-Agent-Token") == "rueck-token"

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.server.seen.append(("GET", self.path))
        if not self._auth_ok():
            self.send_response(403); self.end_headers(); return
        if self.path == "/api/print/config/":
            self._json({"enabled": True, "ip": "10.0.0.9", "port": 9100})
        elif self.path.startswith("/api/print/jobs/pending/"):
            self.server.claims += 1
            if self.server.claims > 1:
                self._json([])
            else:
                self._json([{"id": "t-7", "job_type": "assignment", "payload": {"title": "Brand"}}])
        else:
            self.send_response(404); self.end_headers()

    def do_PATCH(self):
        self.server.seen.append(("PATCH", self.path))
        if not self._auth_ok():
            self.send_response(403); self.end_headers(); return
        if self.path.endswith("/claim/"):
            self._json({"ok": True})
        elif self.path.endswith("/complete/"):
            length = int(self.headers.get("Content-Length", 0))
            self.server.reported.append(json.loads(self.rfile.read(length)))
            self._json({"ok": True})
        else:
            self.send_response(404); self.end_headers()


def _serve(handler):
    srv = _Stub(handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


@pytest.fixture
def front_server():
    srv = _serve(FrontHandler)
    yield srv
    srv.shutdown()


@pytest.fixture
def rueck_server():
    srv = _serve(RueckHandler)
    yield srv
    srv.shutdown()


@pytest.fixture
def fake_cups(tmp_path, monkeypatch):
    """Put fake `lp` and `lpstat` on PATH so the CUPS driver can be exercised for real.

    `lp` records its argv so the test can assert on the options actually passed, and reports
    a request id the way real CUPS does. `lpstat` reports an empty queue, i.e. the job drained.
    """
    bindir = tmp_path / "bin"
    bindir.mkdir()
    argv_log = tmp_path / "lp-argv.json"

    (bindir / "lp").write_text(textwrap.dedent(f"""\
        #!/usr/bin/env python3
        import json, sys
        json.dump(sys.argv[1:], open({str(argv_log)!r}, "w"))
        print("request id is FakePrinter-42 (1 file(s))")
        """))
    (bindir / "lpstat").write_text("#!/usr/bin/env python3\nprint('')\n")
    for f in ("lp", "lpstat"):
        os.chmod(bindir / f, 0o755)
    monkeypatch.setenv("PATH", f"{bindir}{os.pathsep}{os.environ['PATH']}")
    return argv_log


# --- KP Front protocol + CUPS output ---------------------------------------------------


def test_front_backend_claims_downloads_prints_and_reports(front_server, fake_cups):
    backend = _build({
        "name": "front", "protocol": "kp-front", "url": front_server.url,
        "secret": "front-secret", "output": "cups", "printer": "FakePrinter",
    })
    backend.run(threading.Event(), once=True)

    paths = [p for _, p in front_server.seen]
    assert "/api/print-agent/claim" in paths
    assert "/api/print-agent/jobs/job-1/file" in paths
    assert front_server.reported == [{"status": "done", "error": None}]

    argv = json.loads(fake_cups.read_text())
    assert argv[:2] == ["-d", "FakePrinter"]
    assert "media=A4" in argv and "sides=two-sided-long-edge" in argv
    # Not a colour job, so monochrome must have been requested.
    assert "print-color-mode=monochrome" in argv
    # The PDF is passed as a real file that exists at call time.
    assert argv[-1].endswith(".pdf")


def test_front_lp_options_from_config_come_last(front_server, fake_cups):
    """A station overriding a default must win: CUPS honours the LAST occurrence."""
    backend = _build({
        "name": "front", "protocol": "kp-front", "url": front_server.url,
        "secret": "front-secret", "output": "cups", "printer": "FakePrinter",
        "lp_options": ["-o", "sides=one-sided"],
    })
    backend.run(threading.Event(), once=True)

    argv = json.loads(fake_cups.read_text())
    duplex, simplex = argv.index("sides=two-sided-long-edge"), argv.index("sides=one-sided")
    assert simplex > duplex, "the configured override must come after the default"


def test_front_wrong_secret_is_fatal_not_a_retry_loop(front_server, fake_cups):
    backend = _build({
        "name": "front", "protocol": "kp-front", "url": front_server.url,
        "secret": "wrong", "output": "cups", "printer": "FakePrinter",
    })
    with pytest.raises(FatalError):
        backend.protocol.poll()


def test_front_job_never_silently_disappears(front_server, fake_cups, monkeypatch):
    """If printing fails, the backend must be told — a claimed job with no report is stuck."""
    from outputs.cups import CupsOutput
    monkeypatch.setattr(CupsOutput, "print_job", lambda self, job: (False, "printer on fire"))

    backend = _build({
        "name": "front", "protocol": "kp-front", "url": front_server.url,
        "secret": "front-secret", "output": "cups", "printer": "FakePrinter",
    })
    backend.run(threading.Event(), once=True)
    assert front_server.reported == [{"status": "failed", "error": "printer on fire"}]


# --- KP Rück protocol + ESC/POS output --------------------------------------------------


def test_rueck_backend_polls_claims_and_completes(rueck_server):
    backend = _build({
        "name": "rueck", "protocol": "kp-rueck", "url": rueck_server.url,
        "secret": "rueck-token", "output": "escpos", "dry_run": True,
    })
    backend.protocol.refresh_config()
    backend.run(threading.Event(), once=True)

    paths = [p for _, p in rueck_server.seen]
    assert "/api/print/config/" in paths
    assert any(p.startswith("/api/print/jobs/pending/") for p in paths)
    assert "/api/print/jobs/t-7/claim/" in paths
    assert rueck_server.reported == [{"status": "completed", "error_message": None}]


def test_rueck_adopts_the_printer_address_the_backend_reports(rueck_server):
    """The address lives in KP Rück's settings, not on this machine."""
    backend = _build({
        "name": "rueck", "protocol": "kp-rueck", "url": rueck_server.url,
        "secret": "rueck-token", "output": "escpos", "dry_run": True,
    })
    backend.protocol.refresh_config()
    backend.run(threading.Event(), once=True)
    assert (backend.output.ip, backend.output.port) == ("10.0.0.9", 9100)


def test_rueck_wrong_token_is_fatal(rueck_server):
    backend = _build({
        "name": "rueck", "protocol": "kp-rueck", "url": rueck_server.url,
        "secret": "wrong", "output": "escpos", "dry_run": True,
    })
    with pytest.raises(FatalError):
        backend.protocol.refresh_config()


# --- Configuration ----------------------------------------------------------------------


def test_both_backends_run_from_one_config(tmp_path, front_server, rueck_server, fake_cups):
    cfg = tmp_path / "agent.json"
    cfg.write_text(json.dumps({"backends": [
        {"name": "front", "protocol": "kp-front", "url": front_server.url,
         "secret": "front-secret", "output": "cups", "printer": "FakePrinter"},
        {"name": "rueck", "protocol": "kp-rueck", "url": rueck_server.url,
         "secret": "rueck-token", "output": "escpos", "dry_run": True},
    ]}))
    backends = load_backends(str(cfg))
    assert [b.name for b in backends] == ["front", "rueck"]
    assert backends[0].protocol.name == "kp-front"
    assert backends[1].protocol.name == "kp-rueck"


def test_legacy_kp_front_env_still_works(monkeypatch):
    """The previous agents' environments must keep working untouched."""
    monkeypatch.setenv("KP_BASE_URL", "https://front.example.org")
    monkeypatch.setenv("KP_PRINT_AGENT_SECRET", "s")
    monkeypatch.setenv("KP_PRINTER", "Laser")
    monkeypatch.setenv("KP_LP_OPTS", "-o sides=one-sided")
    monkeypatch.delenv("BACKEND_URL", raising=False)

    backends = load_backends(None)
    assert len(backends) == 1
    assert backends[0].protocol.name == "kp-front"
    assert backends[0].output.printer == "Laser"
    assert backends[0].output.lp_options == ["-o", "sides=one-sided"]


def test_legacy_kp_rueck_env_still_works(monkeypatch):
    monkeypatch.setenv("BACKEND_URL", "http://backend:8000")
    monkeypatch.setenv("AGENT_TOKEN", "t")
    monkeypatch.delenv("KP_BASE_URL", raising=False)

    backends = load_backends(None)
    assert len(backends) == 1
    assert backends[0].protocol.name == "kp-rueck"
    assert backends[0].output.name == "escpos"


def test_tuning_knobs_actually_reach_the_drivers(monkeypatch):
    """Regression guard: compose used to pass POLL_INTERVAL while the agent read
    POLL_INTERVAL_IDLE — config that looked set and did nothing. Assert each knob lands."""
    monkeypatch.delenv("KP_BASE_URL", raising=False)
    monkeypatch.setenv("BACKEND_URL", "http://backend:8000")
    monkeypatch.setenv("AGENT_TOKEN", "t")
    monkeypatch.setenv("POLL_INTERVAL_IDLE", "31")
    monkeypatch.setenv("POLL_INTERVAL_ACTIVE", "3")
    monkeypatch.setenv("ACTIVE_DURATION", "77")

    proto = load_backends(None)[0].protocol
    assert (proto.poll_idle_sec, proto.poll_active_sec, proto.active_duration_sec) == (31.0, 3.0, 77.0)

    monkeypatch.delenv("BACKEND_URL", raising=False)
    monkeypatch.setenv("KP_BASE_URL", "https://front.example.org")
    monkeypatch.setenv("KP_PRINT_AGENT_SECRET", "s")
    monkeypatch.setenv("KP_PRINTER", "Laser")
    monkeypatch.setenv("KP_POLL_SEC", "9")
    monkeypatch.setenv("KP_CLAIM_TIMEOUT_SEC", "45")
    monkeypatch.setenv("KP_CUPS_TIMEOUT_SEC", "120")

    backend = load_backends(None)[0]
    assert (backend.protocol.poll_sec, backend.protocol.claim_timeout_sec) == (9.0, 45.0)
    assert backend.output.cups_timeout_sec == 120.0


def test_a_nonsense_tuning_value_is_refused_not_silently_defaulted():
    with pytest.raises(SystemExit) as e:
        _build({"name": "x", "protocol": "kp-front", "url": "http://x", "secret": "s",
                "output": "cups", "printer": "p", "poll_sec": "soon"})
    assert "non-numeric poll_sec" in str(e.value)


def test_mismatched_protocol_and_output_is_refused_at_startup():
    """Caught when the config is read, not at 3am on the first real job."""
    with pytest.raises(SystemExit) as e:
        _build({"name": "x", "protocol": "kp-front", "url": "http://x",
                "secret": "s", "output": "escpos"})
    assert "kp-front goes with cups" in str(e.value)


def test_no_configuration_at_all_explains_itself(monkeypatch):
    monkeypatch.delenv("KP_BASE_URL", raising=False)
    monkeypatch.delenv("BACKEND_URL", raising=False)
    with pytest.raises(SystemExit) as e:
        load_backends(None)
    assert "--config" in str(e.value)


def test_the_agent_core_imports_without_third_party_packages():
    """The bare-Pi promise: importing the agent must not need python-escpos or pillow.

    Run in a subprocess with those modules blocked, because they are installed in this
    environment and a plain import here would prove nothing.
    """
    here = Path(__file__).resolve().parent
    script = textwrap.dedent("""
        import sys
        class Blocker:
            def find_module(self, name, path=None):
                if name.split(".")[0] in {"escpos", "PIL", "httpx"}:
                    raise ImportError(f"{name} is blocked for this test")
        sys.meta_path.insert(0, Blocker())
        import agent, outputs.escpos, outputs.cups, protocols.front, protocols.rueck
        print("ok")
    """)
    run = subprocess.run([sys.executable, "-c", script], cwd=here, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert "ok" in run.stdout
