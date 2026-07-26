"""Secure-cookie policy across deployment shapes.

The failure this guards against is invisible: a browser silently DROPS a `Secure` cookie sent
over http://, so a station on a trusted LAN with no TLS can't log in and the symptom looks
like "the password is wrong". Forcing Secure whenever the app is in production made that the
only possible outcome for a plain-HTTP self-host.
"""

import pytest

from app.auth.config import AuthSettings

STRONG_KEY = "a" * 64


def _settings(**kwargs) -> AuthSettings:
    return AuthSettings(SECRET_KEY=STRONG_KEY, **kwargs)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in ("ENVIRONMENT", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"):
        monkeypatch.delenv(name, raising=False)


def test_development_defaults_to_plain_cookies():
    assert _settings().cookie_secure is False


def test_deployment_defaults_to_secure_cookies(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert _settings().cookie_secure is True


def test_deployment_honours_an_explicit_opt_out(monkeypatch):
    """The trusted-LAN escape hatch: plain HTTP, no domain, no TLS."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert _settings(COOKIE_SECURE=False).cookie_secure is False


def test_opting_out_is_logged(monkeypatch, caplog):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with caplog.at_level("WARNING"):
        _ = _settings(COOKIE_SECURE=False).cookie_secure  # evaluated for the warning it logs
    assert "plain HTTP" in caplog.text


def test_development_can_force_secure(monkeypatch):
    assert _settings(COOKIE_SECURE=True).cookie_secure is True


def test_unset_is_not_the_same_as_false():
    """The tri-state is the whole point: only an explicit value overrides the default."""
    assert _settings().COOKIE_SECURE is None


def test_blank_env_value_means_unset(monkeypatch):
    """`AUTH_COOKIE_SECURE=` left blank in a copied .env must not brick the backend."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "")
    settings = AuthSettings(SECRET_KEY=STRONG_KEY)
    assert settings.COOKIE_SECURE is None
    assert settings.cookie_secure is True
