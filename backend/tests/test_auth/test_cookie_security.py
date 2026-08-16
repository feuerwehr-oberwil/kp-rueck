"""Secure-cookie policy across deployment shapes.

The failure this guards against is invisible: a browser silently DROPS a `Secure` cookie sent
over http://, so a station on a trusted LAN with no TLS can't log in and the symptom looks
like "the password is wrong". Forcing Secure whenever the app is in production made that the
only possible outcome for a plain-HTTP self-host.
"""

import pytest

from app.auth.config import AuthSettings
from app.config import settings as app_settings

STRONG_KEY = "a" * 64

TLS_ORIGIN = "https://kp.example.com"
LAN_ORIGIN = "http://192.168.1.10:8080"


def _settings(**kwargs) -> AuthSettings:
    return AuthSettings(SECRET_KEY=STRONG_KEY, **kwargs)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in ("ENVIRONMENT", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"):
        monkeypatch.delenv(name, raising=False)
    # DOMAIN now outranks the CORS inference, so every test below has to start from a
    # known-empty one – otherwise a developer's own `.env` decides what these assert.
    monkeypatch.setattr(app_settings, "domain", "")


@pytest.fixture
def cors(monkeypatch):
    """Set the app-wide CORS origins, the signal cookie_secure infers TLS from.

    They live on the already-constructed `app.config.settings` singleton, so setting the
    environment variable here would be a no-op – patch the attribute instead.
    """

    def _set(*origins: str) -> None:
        monkeypatch.setattr(app_settings, "cors_origins", list(origins))

    return _set


@pytest.fixture
def domain(monkeypatch):
    """Set `DOMAIN`, i.e. Caddy's site address – the signal that outranks CORS_ORIGINS.

    Same singleton story as `cors`: patch the attribute, not the environment variable.
    """

    def _set(value: str) -> None:
        monkeypatch.setattr(app_settings, "domain", value)

    return _set


def test_development_defaults_to_plain_cookies():
    assert _settings().cookie_secure is False


def test_deployment_defaults_to_secure_cookies(monkeypatch, cors):
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(TLS_ORIGIN)
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


def test_blank_env_value_means_unset(monkeypatch, cors):
    """`AUTH_COOKIE_SECURE=` left blank in a copied .env must not brick the backend."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "")
    cors(TLS_ORIGIN)
    settings = AuthSettings(SECRET_KEY=STRONG_KEY)
    assert settings.COOKIE_SECURE is None
    assert settings.cookie_secure is True


# ==========================================================================================
# Inferring TLS from CORS_ORIGINS – what an operator who set nothing gets.
#
# The shipped .env.example leaves both DOMAIN and AUTH_COOKIE_SECURE empty, so the documented
# LAN self-host ran ENVIRONMENT=production over plain http:// and emitted Secure cookies the
# browser threw away: login returned 200 and bounced back to the form, silently. CORS_ORIGINS
# is the only configured value that must already match the URL browsers really use, so it is
# what we read instead.
# ==========================================================================================


def test_plain_http_deployment_stops_forcing_secure(monkeypatch, cors):
    """The bug: a LAN station on http:// must be able to log in without being told a variable."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(LAN_ORIGIN)
    assert _settings().cookie_secure is False


def test_plain_http_deployment_says_so_out_loud(monkeypatch, cors, caplog):
    """Not forcing Secure is a real downgrade – it must be legible in the boot log."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(LAN_ORIGIN)
    with caplog.at_level("WARNING"):
        _ = _settings().cookie_secure  # evaluated for the warning it logs
    assert "AUTH_COOKIE_SECURE=true" in caplog.text  # the override is named
    assert "Secure" in caplog.text


def test_tls_deployment_still_gets_secure_cookies(monkeypatch, cors):
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(TLS_ORIGIN)
    assert _settings().cookie_secure is True


def test_mixed_origins_never_downgrade(monkeypatch, cors):
    """One https origin means one browser on TLS, and it would lose a non-Secure cookie."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(LAN_ORIGIN, TLS_ORIGIN)
    assert _settings().cookie_secure is True


def test_explicit_true_beats_a_plain_http_deployment(monkeypatch, cors):
    """TLS terminated somewhere we can't see: the operator's word outranks the inference."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(LAN_ORIGIN)
    assert _settings(COOKIE_SECURE=True).cookie_secure is True


def test_explicit_false_beats_a_tls_deployment_and_still_warns(monkeypatch, cors, caplog):
    """The pre-existing escape hatch keeps working – including its warning."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(TLS_ORIGIN)
    with caplog.at_level("WARNING"):
        assert _settings(COOKIE_SECURE=False).cookie_secure is False
    assert "AUTH_COOKIE_SECURE=false" in caplog.text


def test_a_comma_separated_string_is_read_the_same_way(monkeypatch):
    """cors_origins is typed `list[str] | str`; don't trust that the validator always ran."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(app_settings, "cors_origins", f" {LAN_ORIGIN} , http://kp.local ")
    assert _settings().cookie_secure is False


# ==========================================================================================
# DOMAIN vetoes the inference.
#
# The premise the inference rests on – "a wrong CORS_ORIGINS breaks every API call, so it
# cannot stay wrong" – is false on the compose stack: Caddy serves board, API and socket from
# ONE origin, browsers never send a cross-origin request, and a wrong CORS_ORIGINS has no
# symptom at all. `just init` derives DOMAIN and CORS_ORIGINS together; hand-editing `.env`
# (SETUP.md §1) does not, and DOMAIN=kp.example.ch left next to the CORS_ORIGINS=
# http://localhost:8080 default would have shipped login cookies without Secure over the
# public internet, forever and quietly.
# ==========================================================================================


def test_a_domain_keeps_secure_despite_plain_http_origins(monkeypatch, cors, domain):
    """The blocker: DOMAIN set means Caddy is on 443, whatever CORS_ORIGINS claims."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors("http://localhost:8080")
    domain("kp.example.ch")
    assert _settings().cookie_secure is True


def test_the_domain_mismatch_is_logged_with_both_values(monkeypatch, cors, domain, caplog):
    """No longer dangerous, still wrong – and this log line is the only place it shows."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors("http://localhost:8080")
    domain("kp.example.ch")
    with caplog.at_level("ERROR"):
        _ = _settings().cookie_secure  # evaluated for the error it logs
    assert "kp.example.ch" in caplog.text
    assert "http://localhost:8080" in caplog.text


def test_an_explicit_opt_out_still_beats_a_domain(monkeypatch, cors, domain):
    """The operator's word outranks every inference, including this one."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors("http://localhost:8080")
    domain("kp.example.ch")
    assert _settings(COOKIE_SECURE=False).cookie_secure is False


def test_no_domain_is_still_the_lan_install(monkeypatch, cors, domain):
    """A blank DOMAIN is the trusted-LAN shape and must keep logging in without TLS."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors(LAN_ORIGIN)
    domain("   ")  # operators leave whitespace behind; it is not a domain
    assert _settings().cookie_secure is False


def test_untouched_localhost_defaults_read_as_plain_http(monkeypatch, cors):
    """A deliberate choice, not an accident.

    The default origins are http://localhost – a deployment that never set CORS_ORIGINS cannot
    be serving real browsers over TLS anyway (they would be blocked by CORS long before the
    cookie mattered), so treating it as plain HTTP is right, and it keeps the dev default.
    """
    monkeypatch.setenv("ENVIRONMENT", "production")
    cors("http://localhost:3000", "http://localhost:3001")
    assert _settings().cookie_secure is False
