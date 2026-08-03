"""X-Forwarded-For must not be forgeable by the caller.

The header is written by the client and appended to by each proxy, so its leftmost entry
is whatever the caller typed. Both the rate limiter and the audit log used to read exactly
that, which meant `X-Forwarded-For: 1.2.3.4` was enough to pick your own identity for the
login throttle, the request ceiling and the audit trail at once.
"""

from unittest.mock import MagicMock, patch

import pytest

from app.middleware.rate_limit import client_ip


def _request(xff: str | None, peer: str | None = "10.0.0.9"):
    request = MagicMock()
    request.headers = {"X-Forwarded-For": xff} if xff is not None else {}
    request.client = MagicMock(host=peer) if peer else None
    return request


@pytest.mark.parametrize(
    ("xff", "expected"),
    [
        # One proxy in front (the reference deployments): the entry IT appended is the
        # rightmost, and everything left of it is caller-supplied noise.
        ("203.0.113.7", "203.0.113.7"),
        ("1.2.3.4, 203.0.113.7", "203.0.113.7"),
        ("evil, spoofed, 203.0.113.7", "203.0.113.7"),
    ],
)
def test_takes_the_entry_our_own_proxy_appended(xff: str, expected: str):
    with patch("app.middleware.rate_limit.settings.trusted_proxy_count", 1):
        assert client_ip(_request(xff)) == expected


def test_a_spoofed_header_cannot_change_the_answer():
    """The whole point: the attacker controls the left, we read the right."""
    with patch("app.middleware.rate_limit.settings.trusted_proxy_count", 1):
        honest = client_ip(_request("203.0.113.7"))
        spoofed = client_ip(_request("1.2.3.4, 203.0.113.7"))
    assert honest == spoofed == "203.0.113.7"


def test_falls_back_to_the_socket_when_the_chain_is_shorter_than_configured():
    """Fewer hops than expected means the request did not come the documented way."""
    with patch("app.middleware.rate_limit.settings.trusted_proxy_count", 2):
        assert client_ip(_request("203.0.113.7")) == "10.0.0.9"


def test_header_is_ignored_entirely_without_a_proxy():
    """TRUSTED_PROXY_COUNT=0 is the direct-exposure case."""
    with patch("app.middleware.rate_limit.settings.trusted_proxy_count", 0):
        assert client_ip(_request("1.2.3.4")) == "10.0.0.9"


def test_no_header_uses_the_socket_address():
    with patch("app.middleware.rate_limit.settings.trusted_proxy_count", 1):
        assert client_ip(_request(None)) == "10.0.0.9"


def test_handles_a_missing_peer():
    with patch("app.middleware.rate_limit.settings.trusted_proxy_count", 0):
        assert client_ip(_request(None, peer=None)) is None
