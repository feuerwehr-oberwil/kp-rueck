"""Tests for rate limiting middleware."""

import pytest

from app.middleware.rate_limit import RateLimits, get_client_identifier, rate_limit_exceeded_handler


class MockRequest:
    """Mock request object for testing."""

    def __init__(self, headers: dict = None, client_host: str = "127.0.0.1"):
        self.headers = headers or {}
        self.client = type("Client", (), {"host": client_host})()
        self.scope = {"client": (client_host, 12345)}


@pytest.mark.unit
class TestGetClientIdentifier:
    """Tests for client identifier extraction."""

    def test_uses_x_forwarded_for_when_present(self):
        """Should use X-Forwarded-For header when present (behind proxy)."""
        request = MockRequest(headers={"X-Forwarded-For": "192.168.1.100"})
        assert get_client_identifier(request) == "192.168.1.100"

    def test_uses_first_ip_from_forwarded_chain(self):
        """Should use first IP when multiple IPs in X-Forwarded-For chain."""
        request = MockRequest(headers={"X-Forwarded-For": "192.168.1.100, 10.0.0.1, 172.16.0.1"})
        assert get_client_identifier(request) == "192.168.1.100"

    def test_strips_whitespace_from_forwarded_ip(self):
        """Should strip whitespace from extracted IP."""
        request = MockRequest(headers={"X-Forwarded-For": "  192.168.1.100  "})
        assert get_client_identifier(request) == "192.168.1.100"

    def test_falls_back_to_remote_address_when_no_header(self):
        """Should use remote address when X-Forwarded-For not present."""
        request = MockRequest(client_host="10.0.0.50")
        identifier = get_client_identifier(request)
        # Falls back to slowapi's get_remote_address
        assert identifier is not None


@pytest.mark.unit
class TestRateLimits:
    """Tests for rate limit configuration."""

    def test_login_limit_is_strict(self):
        """Login should have strict limits to prevent brute force."""
        assert "5/minute" == RateLimits.LOGIN

    def test_export_limit_is_moderate(self):
        """Export should have moderate limits due to resource intensity."""
        assert "10/minute" == RateLimits.EXPORT

    def test_default_limit_is_reasonable(self):
        """Default limit should allow normal usage."""
        assert "100/minute" == RateLimits.DEFAULT


@pytest.mark.unit
class TestRateLimitExceededHandler:
    """Tests for rate limit exceeded response handler."""

    def test_returns_429_status(self):
        """Should return HTTP 429 Too Many Requests."""

        class MockException:
            detail = "5 per 1 minute"

        response = rate_limit_exceeded_handler(MockRequest(), MockException())
        assert response.status_code == 429

    def test_returns_german_error_message(self):
        """Should return user-friendly German error message."""
        import json

        class MockException:
            detail = "5 per 1 minute"

        response = rate_limit_exceeded_handler(MockRequest(), MockException())
        body = json.loads(response.body)
        assert "Zu viele Anfragen" in body["detail"]

    def test_includes_retry_after_header(self):
        """Should include Retry-After header for clients."""

        class MockException:
            detail = "5 per 1 minute"

        response = rate_limit_exceeded_handler(MockRequest(), MockException())
        assert "Retry-After" in response.headers
