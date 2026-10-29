"""Protocol-independent contracts that must hold before a slip reaches the printer."""

import io
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest
from core import PrintResult, log, qr_box_size, request


@pytest.mark.parametrize("ok,error", [(True, None), (False, "paper jam"), (1, "backup"), (0, None)])
def test_legacy_output_result_keeps_success_and_error(ok, error):
    result = PrintResult.coerce((ok, error))
    assert result.ok is bool(ok)
    assert result.error == error
    assert result.unreachable is False


def test_coercion_preserves_retryable_failure_identity():
    result = PrintResult(False, "offline", unreachable=True)
    assert PrintResult.coerce(result) is result


def test_logs_are_flushed_before_the_agent_moves_on(monkeypatch):
    class BufferedLog(io.StringIO):
        flushed = False

        def flush(self):
            self.flushed = True

    output = BufferedLog()
    with monkeypatch.context() as patch:
        patch.setattr("sys.stdout", output)
        log("printer offline")
    assert output.getvalue() == "printer offline\n"
    assert output.flushed


@pytest.mark.parametrize(
    "modules,target,expected",
    [(50, 416, 8), (51, 416, 7), (30, 200, 6), (1, 416, 12), (500, 416, 4), (0, 416, 4), (-1, 416, 4)],
)
def test_qr_modules_have_integer_dot_sizes_and_include_both_borders(modules, target, expected):
    size = qr_box_size(modules, target)
    assert type(size) is int
    assert size == expected


@pytest.fixture
def http_calls(monkeypatch):
    calls = []

    @contextmanager
    def urlopen(req, timeout):
        calls.append((req, timeout))
        yield SimpleNamespace(status=201, read=lambda: b"response bytes")

    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    return calls


@pytest.mark.parametrize(
    "body,method,expected",
    [(None, None, "GET"), (b"", None, "POST"), (b"raw", None, "POST"), (b"raw", "PATCH", "PATCH")],
)
def test_http_preserves_bytes_method_headers_and_timeout(http_calls, body, method, expected):
    headers = {"X-Agent-Token": "test-token"}
    assert request("http://board.example/jobs", body=body, method=method, headers=headers, timeout=7.5) == (
        201,
        b"response bytes",
    )
    req, timeout = http_calls[0]
    assert req.full_url == "http://board.example/jobs"
    assert req.get_method() == expected
    assert req.data == body
    assert req.get_header("X-agent-token") == "test-token"
    assert timeout == 7.5
    assert headers == {"X-Agent-Token": "test-token"}


def test_empty_json_is_still_a_post_and_does_not_mutate_callers_headers(http_calls):
    headers = {"Content-Type": "text/plain", "X-Agent-Token": "test-token"}
    request("http://board.example/report", headers=headers, json_body={})
    req, timeout = http_calls[0]
    assert req.get_method() == "POST"
    assert req.data == b"{}"
    assert req.get_header("Content-type") == "application/json"
    assert req.get_header("X-agent-token") == "test-token"
    assert headers["Content-Type"] == "text/plain"
    assert timeout == 30.0


def test_http_errors_are_returned_as_status_and_body(monkeypatch):
    def reject(*args, **kwargs):
        raise HTTPError("http://board.example/jobs", 409, "already claimed", {}, io.BytesIO(b"conflict"))

    monkeypatch.setattr("urllib.request.urlopen", reject)
    assert request("http://board.example/jobs") == (409, b"conflict")
