"""The deploy half of passwordless local login: the proxy strips, and the port is loopback-only.

The backend's 403 is only ever reached by a client whose `X-Local-Autologin` header was thrown
away, and the secret is only ever attached by a listener nobody off this host can connect to.
Both of those facts live in `deploy/Caddyfile` and `docker-compose.yml`, which no Python test
would otherwise touch – so a well-meant edit there could open the feature to the whole LAN with
every backend test still green.

The adapted Caddy config was checked with `caddy adapt` when this was written: the
`request_header` directive is ordered BEFORE `handle`/`reverse_proxy`, so a site-level strip
covers every route including the Next `/backend-api` proxy. What these tests can pin cheaply is
that the strip is still there, still at site level, and still on the public site.

Skipped when the repo root isn't present (running inside the backend image, where only
backend/ is copied).
"""

import pathlib
import re

import pytest

from app.auth.local_autologin import HEADER_NAME

ROOT = pathlib.Path(__file__).resolve().parents[2]
CADDYFILE = ROOT / "deploy" / "Caddyfile"
COMPOSE = ROOT / "docker-compose.yml"

pytestmark = pytest.mark.skipif(not CADDYFILE.exists(), reason="repo root not available (running from the image)")

#: The loopback listener's port inside the container. `LOCAL_PORT` moves the host side only.
CONTAINER_PORT = 8081


def _site_blocks() -> dict[str, str]:
    """The Caddyfile's top-level blocks, keyed by the text before the opening brace.

    Good enough for this file, which has no nested top-level braces outside its blocks: a
    block starts at column 0 and ends at the first `}` at column 0.
    """
    blocks: dict[str, str] = {}
    name: str | None = None
    body: list[str] = []
    for line in CADDYFILE.read_text().splitlines():
        if name is None:
            m = re.fullmatch(r"(\S.*?)\s*\{", line)
            if m:
                name, body = m.group(1), []
            continue
        if line == "}":
            blocks[name] = "\n".join(body)
            name = None
            continue
        body.append(line)
    return blocks


def _directives(text: str) -> list[str]:
    """The lines that mean something – comments are prose and may name anything."""
    return [stripped for line in text.splitlines() if (stripped := line.strip()) and not stripped.startswith("#")]


def test_the_public_site_strips_the_header():
    """A LAN, VPN or internet client cannot claim to be the station machine.

    Without this line the feature is not "passwordless on the station notebook", it is
    "an editor session for anyone who guesses one header value".
    """
    public = _site_blocks()["{$DOMAIN}"]

    assert f"request_header -{HEADER_NAME}" in public, (
        f"the public site in deploy/Caddyfile must delete {HEADER_NAME} from incoming requests"
    )
    # At site level (one tab), not inside a `handle` block – it has to cover /api/*, the Next
    # /backend-api proxy and anything added later without someone remembering to repeat it.
    assert f"\trequest_header -{HEADER_NAME}" in public


def test_the_public_site_never_sets_the_header():
    """Only the loopback listener may attach the secret."""
    public = _directives(_site_blocks()["{$DOMAIN}"])
    sets = [line for line in public if HEADER_NAME in line and "-" + HEADER_NAME not in line]

    assert not sets, f"the public site must not set {HEADER_NAME}: {sets}"


def test_the_loopback_site_sets_the_secret():
    """And takes it from the environment, never from a value committed here."""
    local = _site_blocks()[f":{CONTAINER_PORT}"]

    assert f'request_header {HEADER_NAME} "{{$LOCAL_AUTOLOGIN_SECRET}}"' in local


def test_both_sites_serve_the_same_routes():
    """One routing definition, imported twice – the two sites may differ in nothing else."""
    blocks = _site_blocks()

    assert "(kp_board)" in blocks, "the shared route snippet is gone; the two sites can now drift"
    for site in ("{$DOMAIN}", f":{CONTAINER_PORT}"):
        assert "import kp_board" in blocks[site], f"{site} no longer serves the shared routes"


def test_compose_publishes_the_local_port_on_loopback_only():
    """The bind address IS the trust boundary, so pin it.

    Docker publishes a port with a DNAT rule ahead of the host firewall, so a plain
    `"8081:8081"` would be reachable from the whole LAN whatever ufw says – and that listener
    hands out an editor session to anyone who asks for it.
    """
    published = [line for line in _directives(COMPOSE.read_text()) if f':{CONTAINER_PORT}"' in line]

    assert published == [f'- "127.0.0.1:${{LOCAL_PORT:-{CONTAINER_PORT}}}:{CONTAINER_PORT}"'], (
        f"the :{CONTAINER_PORT} publish in docker-compose.yml must stay bound to 127.0.0.1: {published}"
    )


def test_compose_hands_the_secret_to_caddy():
    """Caddy cannot stamp a secret it was never given – the station would just see a form."""
    compose_text = COMPOSE.read_text()

    assert "LOCAL_AUTOLOGIN_SECRET: ${LOCAL_AUTOLOGIN_SECRET:-}" in compose_text
