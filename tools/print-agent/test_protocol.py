"""Exercise polling and reporting boundaries without network delays or real printers."""

import json
from types import SimpleNamespace
from unittest.mock import Mock, call
from urllib.error import URLError

import pytest
from core import FatalError, Job
from protocols.front import FrontProtocol
from protocols.rueck import RueckProtocol


@pytest.fixture
def protocol(monkeypatch):
    now = [1000.0]
    sleeps = []
    monkeypatch.setattr("protocols.rueck.time", SimpleNamespace(monotonic=lambda: now[0], sleep=sleeps.append))
    proto = RueckProtocol(
        "http://board.example/",
        "test-token",
        poll_idle_sec=31,
        poll_active_sec=3,
        active_duration_sec=77,
        long_poll_sec=12,
    )
    return proto, now, sleeps


@pytest.mark.parametrize("status", [401, 403])
def test_config_authentication_failure_stops_the_agent(protocol, status):
    proto, _, _ = protocol
    proto._request = Mock(return_value=(status, b"denied"))
    with pytest.raises(FatalError, match=str(status)):
        proto.refresh_config()


def test_config_sets_printer_address_port_enabled_and_refresh_deadline(protocol):
    proto, now, _ = protocol
    proto._request = Mock(return_value=(200, b'{"enabled":true,"ip":"10.0.0.8","port":"9101"}'))
    proto.refresh_config()
    assert (proto.enabled, proto.printer_ip, proto.printer_port) == (True, "10.0.0.8", 9101)
    assert proto._config_at == now[0]
    assert proto.url == "http://board.example"


def test_config_defaults_disable_printing_and_preserve_the_standard_port(protocol):
    proto, _, _ = protocol
    proto._request = Mock(return_value=(200, b"{}"))
    proto.refresh_config()
    assert (proto.enabled, proto.printer_ip, proto.printer_port) == (False, "", 9100)


def test_failed_config_refresh_preserves_last_known_printer(protocol):
    proto, _, _ = protocol
    proto.enabled, proto.printer_ip, proto.printer_port = True, "10.0.0.8", 9101
    proto._config_at = 900
    proto._request = Mock(return_value=(503, b"restarting"))
    proto.refresh_config()
    assert (proto.enabled, proto.printer_ip, proto.printer_port, proto._config_at) == (True, "10.0.0.8", 9101, 900)


def test_disabled_printer_rechecks_config_on_every_poll(protocol):
    proto, _, sleeps = protocol
    proto._request = Mock(return_value=(200, b'{"enabled":false}'))
    assert proto.poll() == []
    assert proto.poll() == []
    assert proto._request.call_args_list == [call("/api/print/config/"), call("/api/print/config/")]
    assert sleeps == [31, 31]


def test_first_poll_cannot_print_before_config_even_just_after_system_boot(protocol):
    proto, now, sleeps = protocol
    now[0] = 1
    proto._request = Mock(return_value=(503, b"unavailable"))
    assert proto.poll() == []
    proto._request.assert_called_once_with("/api/print/config/")
    assert sleeps == [31]


@pytest.mark.parametrize("token,expected_headers", [("test-token", {"X-Agent-Token": "test-token"}), ("", {})])
def test_transport_keeps_the_full_base_path_and_authentication_header(monkeypatch, token, expected_headers):
    transport = Mock(return_value=(200, b"ok"))
    monkeypatch.setattr("protocols.rueck.request", transport)
    proto = RueckProtocol("http://board.example/PiX///", token)
    assert proto._request("/api/print/config/") == (200, b"ok")
    # Header names are case insensitive on the wire.
    args, kwargs = transport.call_args
    assert args == ("http://board.example/PiX/api/print/config/",)
    assert {k.lower(): v for k, v in kwargs["headers"].items()} == {k.lower(): v for k, v in expected_headers.items()}


@pytest.mark.parametrize("age,refresh", [(119.999, False), (120, True)])
def test_enabled_printer_refreshes_config_at_two_minutes(protocol, age, refresh):
    proto, now, _ = protocol
    proto.enabled = True
    proto._config_at = now[0] - age
    proto.refresh_config = Mock()
    proto._request = Mock(return_value=(200, b"[]"))
    assert proto.poll() == []
    assert proto.refresh_config.call_count == int(refresh)
    proto._request.assert_called_once_with("/api/print/jobs/pending/?limit=10&wait=12", timeout=32)


@pytest.mark.parametrize("status", [401, 403])
def test_pending_auth_failure_is_fatal(protocol, status):
    proto, now, sleeps = protocol
    proto.enabled, proto._config_at = True, now[0]
    proto._request = Mock(return_value=(status, b"denied"))
    with pytest.raises(FatalError, match=str(status)):
        proto.poll()
    assert sleeps == []


def test_unclaimed_jobs_stay_in_queue_and_only_one_success_is_claimed(protocol):
    proto, now, sleeps = protocol
    proto.enabled, proto._config_at = True, now[0]
    pending = [{"id": 1}, {"id": 2, "job_type": "assignment", "payload": {"title": "Fire"}}, {"id": 3}]
    proto._request = Mock(side_effect=[(200, json.dumps(pending).encode()), (409, b"taken"), (200, b"ok")])
    assert proto.poll() == [Job("2", "http://board.example", "assignment", {"title": "Fire"})]
    assert proto._request.call_args_list == [
        call("/api/print/jobs/pending/?limit=10&wait=12", timeout=32),
        call("/api/print/jobs/1/claim/", method="PATCH", body=b""),
        call("/api/print/jobs/2/claim/", method="PATCH", body=b""),
    ]
    assert sleeps == []


def test_a_claimed_job_with_no_optional_payload_still_has_a_valid_record(protocol):
    proto, now, _ = protocol
    proto.enabled, proto._config_at = True, now[0]
    proto._request = Mock(side_effect=[(200, b'[{"id":"7"}]'), (200, b"")])
    assert proto.poll() == [Job("7", "http://board.example", "", {})]


@pytest.mark.parametrize("held,expected_sleeps", [(0, [31]), (5.999, [31]), (6, []), (12, [])])
def test_long_poll_does_not_add_another_wait_after_the_backend_waited(protocol, held, expected_sleeps):
    proto, now, sleeps = protocol
    proto.enabled, proto._config_at = True, now[0]

    def pending(*args, **kwargs):
        now[0] += held
        return 200, b"[]"

    proto._request = Mock(side_effect=pending)
    assert proto.poll() == []
    assert sleeps == expected_sleeps


def test_pending_server_failure_uses_the_fallback_gap(protocol):
    proto, now, sleeps = protocol
    proto.enabled, proto._config_at = True, now[0]
    proto._request = Mock(return_value=(503, b"unavailable"))
    assert proto.poll() == []
    assert sleeps == [31]


@pytest.mark.parametrize(
    "ok,unreachable,error,note,expected",
    [
        (
            True,
            False,
            None,
            "backup printer",
            {"status": "completed", "error_message": "backup printer", "retryable": False},
        ),
        (True, True, "ignored", None, {"status": "completed", "error_message": None, "retryable": False}),
        (False, False, "bad job", "ignored", {"status": "failed", "error_message": "bad job", "retryable": False}),
        (False, True, "offline", None, {"status": "failed", "error_message": "offline", "retryable": True}),
    ],
)
def test_completion_report_keeps_permanent_and_retryable_failures_distinct(
    protocol, ok, unreachable, error, note, expected
):
    proto, now, sleeps = protocol
    proto._request = Mock(return_value=(200, b""))
    proto.report("job-7", ok, error, unreachable=unreachable, note=note)
    proto._request.assert_called_once_with(
        "/api/print/jobs/job-7/complete/", method="PATCH", json_body=expected, timeout=10
    )
    assert sleeps == [0]
    assert proto._last_job_at == (now[0] if ok else 0)


def test_plain_failure_is_permanent_by_default(protocol):
    proto, _, _ = protocol
    proto._request = Mock(return_value=(200, b""))
    proto.report("job-7", False, "unrenderable")
    assert proto._request.call_args.kwargs["json_body"]["retryable"] is False


@pytest.mark.parametrize("status", [200, 400, 401, 403, 409, 499])
def test_answered_completion_does_not_retry_a_client_refusal(protocol, status):
    proto, _, sleeps = protocol
    proto._request = Mock(return_value=(status, b""))
    proto.report("job-7", True)
    assert proto._request.call_count == 1
    assert sleeps == [0]


def test_completion_retries_network_and_server_errors_with_a_bounded_budget(protocol):
    proto, _, sleeps = protocol
    proto._request = Mock(side_effect=[OSError("connection reset"), (500, b"restart"), (200, b"ok")])
    proto.report("job-7", True)
    assert proto._request.call_count == 3
    assert sleeps == [0, 1, 3]
    assert all(args.kwargs["timeout"] == 10 for args in proto._request.call_args_list)


def test_completion_exhaustion_does_not_crash_the_next_print_job(protocol, capsys):
    proto, _, sleeps = protocol
    proto._request = Mock(return_value=(503, b"restart"))
    proto.report("job-7", False, "offline")
    assert proto._request.call_count == 3
    assert sleeps == [0, 1, 3]
    lines = capsys.readouterr().out.splitlines()
    assert len([line for line in lines if "retrying" in line]) == 2
    assert "job-7" in lines[-1] and "HTTP 503" in lines[-1]
    assert "may print a second time" in lines[-1]


def test_network_report_failure_names_the_underlying_reason(protocol, capsys):
    proto, _, _ = protocol
    proto._request = Mock(side_effect=URLError(OSError("network down")))
    proto.report("job-7", True)
    last_line = capsys.readouterr().out.splitlines()[-1]
    assert "job-7" in last_line and "(network down)" in last_line


def test_active_polling_gap_expires_at_its_deadline_and_only_success_renews_it(protocol):
    proto, now, _ = protocol
    proto._request = Mock(return_value=(200, b""))
    assert proto._gap == 31
    proto.report("job-7", True)
    assert proto._gap == 3
    now[0] += 76.999
    assert proto._gap == 3
    now[0] += 0.001
    assert proto._gap == 31
    proto.report("job-8", False, "bad job")
    assert proto._gap == 31


# --- KP Front: the wire contract of kp-front's backend/app/api/print_relay.py -------------


@pytest.fixture
def front(monkeypatch):
    now = [1000.0]
    sleeps = []
    monkeypatch.setattr("protocols.front.time", SimpleNamespace(monotonic=lambda: now[0], sleep=sleeps.append))
    return FrontProtocol("http://front.example/", "front-secret", poll_sec=7), now, sleeps


def test_front_claim_downloads_the_pdf_and_keeps_the_claimed_metadata(front):
    proto, _, sleeps = front
    claimed = {"id": "j1", "kind": "zeitplan", "incident_id": "i1", "filename": "Zeitplan.pdf",
               "color": True, "created_at": "2026-10-30T12:00:00+00:00"}
    proto._request = Mock(side_effect=[(200, json.dumps(claimed).encode()), (200, b"%PDF")])
    assert proto.poll() == [Job("j1", "http://front.example", "zeitplan", document=b"%PDF",
                                filename="Zeitplan.pdf", color=True)]
    assert proto._request.call_args_list == [
        call("/api/print-agent/claim", body=b"", method="POST", timeout=60.0),
        call("/api/print-agent/jobs/j1/file", timeout=120.0),
    ]
    assert sleeps == []


def test_front_undownloadable_job_is_reported_failed_not_left_claimed(front):
    proto, _, _ = front
    proto._request = Mock(side_effect=[(200, b'{"id":"j2"}'), (409, b""), (200, b"")])
    assert proto.poll() == []
    assert proto._request.call_args_list[-1] == call(
        "/api/print-agent/jobs/j2/status", json_body={"status": "failed", "error": "PDF download: HTTP 409"}
    )


def test_front_download_that_breaks_off_is_reported_failed(front):
    proto, _, _ = front
    proto._request = Mock(side_effect=[(200, b'{"id":"j3"}'), TimeoutError("timed out"), (200, b"")])
    assert proto.poll() == []
    assert proto._request.call_args_list[-1] == call(
        "/api/print-agent/jobs/j3/status", json_body={"status": "failed", "error": "PDF download: timed out"}
    )


def test_front_only_an_immediate_204_waits_out_the_poll_gap(front):
    proto, now, sleeps = front
    proto._request = Mock(return_value=(204, b""))
    assert proto.poll() == [] and sleeps == [7]

    def hang(*_a, **_kw):
        now[0] += 7  # a completed long-poll hang
        return 204, b""

    proto._request = Mock(side_effect=hang)
    assert proto.poll() == [] and sleeps == [7]


def test_front_report_sends_the_backup_note_on_success_and_the_error_on_failure(front):
    proto, _, _ = front
    proto._request = Mock(return_value=(200, b""))
    proto.report("j3", True, "ignored", note="auf Ersatzdrucker gedruckt")
    proto.report("j4", False, "Papierstau", note="ignored")
    assert proto._request.call_args_list == [
        call("/api/print-agent/jobs/j3/status", json_body={"status": "done", "error": "auf Ersatzdrucker gedruckt"}),
        call("/api/print-agent/jobs/j4/status", json_body={"status": "failed", "error": "Papierstau"}),
    ]
