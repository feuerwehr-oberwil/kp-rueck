#!/bin/bash
# Double-click starter for macOS: from an unzipped release folder to a running board, with the
# browser opened on the first-run wizard. The Windows twin is Start-KP-Rueck.bat next to it.
#
# The contract with the operator: no terminal knowledge, no .env editing, no passwords on disk.
# This writes an .env of pure entropy plus LAN defaults (the /setup wizard handles the account
# passwords in the browser), starts the production compose stack and waits for it. Running it
# again starts the installed release; upgrades require the complete matching release files. It never overwrites an existing .env – same guard
# philosophy as scripts/init-env.sh.
#
# Operator-facing output is German (the double-click audience); comments stay English like the
# rest of the repo.
set -u

# cwd is NOT reliable on double-click – resolve everything from this file's own location.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 1

BLUE='\033[1;34m'; GREEN='\033[1;32m'; YELLOW='\033[1;33m'; RED='\033[1;31m'; OFF='\033[0m'
say()  { printf "${BLUE}→ %s${OFF}\n" "$*"; }
ok()   { printf "${GREEN}✓ %s${OFF}\n" "$*"; }
warn() { printf "${YELLOW}⚠  %s${OFF}\n" "$*"; }

# Every failure path ends here: one clear German sentence about what to do, and a pause so the
# Terminal window cannot vanish before it was read.
fail() {
    printf "\n${RED}✗ %s${OFF}\n\n" "$*"
    read -r -p "Enter drücken, um dieses Fenster zu schliessen … " _ || true
    exit 1
}

PORT=8080

printf '\n'
say "KP Rück wird gestartet …"

[ -f "$REPO_ROOT/docker-compose.yml" ] || fail "Dieser Ordner ist unvollständig – bitte das heruntergeladene ZIP komplett entpacken und die Datei «Start KP Rück» im entpackten Ordner erneut doppelklicken."

# The release package supplies the version; never infer an upgrade from a moving image tag.
RELEASE_VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' frontend/package.json 2>/dev/null)"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Release-Version fehlt. Bitte das vollständige ZIP eines veröffentlichten Releases verwenden."

# ── Docker ────────────────────────────────────────────────────────────────────────────────
# Any working `docker` is fine – Docker Desktop and OrbStack both count. Only when the daemon
# is down do we try to launch whichever of the two is installed, then wait for it.
docker_ready() { docker info >/dev/null 2>&1; }

if ! command -v docker >/dev/null 2>&1; then
    printf '\n'
    warn "Docker ist auf diesem Mac noch nicht installiert."
    printf '  Docker ist das Programm, das das Board im Hintergrund laufen lässt.\n'
    printf '  Die Download-Seite öffnet sich jetzt im Browser:\n'
    printf '    1. «Docker Desktop for Mac» herunterladen und installieren (Apple Chip wählen,\n'
    printf '       ausser der Mac ist von vor 2021).\n'
    printf '    2. Docker Desktop einmal starten und die Einrichtung bestätigen.\n'
    printf '    3. Danach «Start KP Rück» erneut doppelklicken – es geht dort weiter, wo es aufgehört hat.\n'
    open "https://www.docker.com/products/docker-desktop/" 2>/dev/null || true
    fail "Bitte zuerst Docker Desktop installieren, dann diese Datei erneut doppelklicken."
fi

if ! docker_ready; then
    # The CLI exists but the daemon is down – almost always "Docker Desktop is not running".
    LAUNCHED=""
    if [ -d "/Applications/Docker.app" ]; then
        say "Docker Desktop wird gestartet …"
        open -a Docker 2>/dev/null && LAUNCHED=yes
    elif [ -d "/Applications/OrbStack.app" ]; then
        say "OrbStack wird gestartet …"
        open -a OrbStack 2>/dev/null && LAUNCHED=yes
    fi
    if [ -n "$LAUNCHED" ]; then
        printf '  Das kann eine Minute dauern '
        DEADLINE=$(( $(date +%s) + 120 ))
        while ! docker_ready; do
            [ "$(date +%s)" -lt "$DEADLINE" ] || break
            printf '.'
            sleep 3
        done
        printf '\n'
    fi
    docker_ready || fail "Docker läuft noch nicht. Bitte Docker Desktop (oder OrbStack) von Hand starten, warten bis es «running» meldet, und diese Datei erneut doppelklicken."
fi
ok "Docker läuft."

docker compose version >/dev/null 2>&1 || fail "Diese Docker-Installation ist zu alt (kein «docker compose»). Bitte Docker Desktop aktualisieren und diese Datei erneut doppelklicken."

# ── .env ──────────────────────────────────────────────────────────────────────────────────
# Pure entropy + LAN defaults, nothing an operator has to invent: the account passwords are
# set in the browser at /setup on the first visit. Never overwrites an existing .env – those
# secrets must stay stable for the life of the deployment.
if [ -f .env ]; then
    ok "Vorhandene Konfiguration (.env) wird weiterverwendet."
else
    say "Konfiguration wird erstellt …"
    umask 077
    rand_hex() {
        if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
        else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
    }
    # Best-effort LAN address, so other screens in the Gerätehaus are an allowed origin too.
    # Both entries are plain http:// on purpose – mixing schemes in CORS_ORIGINS breaks logins.
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    CORS="http://localhost:${PORT}"
    [ -n "$LAN_IP" ] && CORS="${CORS},http://${LAN_IP}:${PORT}"
    cat > .env <<EOF
# Automatisch erstellt von «Start KP Rück» am $(date '+%Y-%m-%d %H:%M').
# Die drei Geheimwerte müssen STABIL bleiben – neue Werte melden alle Benutzer ab und passen
# nicht mehr zu einem Datenbank-Backup. Diese Datei gehört darum mit zu den Backups.
# Alle weiteren Einstellungen: siehe .env.example im gleichen Ordner.
POSTGRES_PASSWORD=$(rand_hex)
SECRET_KEY=$(rand_hex)
AUTH_SECRET_KEY=$(rand_hex)
# Kein Admin-/Viewer-Passwort hier: die Konten werden beim ersten Besuch im Browser gesetzt.
DOMAIN=
HTTP_PORT=${PORT}
CORS_ORIGINS=${CORS}
KP_RUECK_TAG=${RELEASE_VERSION}
COMPOSE_PROFILES=backup
EOF
    chmod 600 .env
    ok "Konfiguration erstellt (.env, Zugriff nur für diesen Benutzer)."
fi

# A re-used .env may carry another port (edited by hand, or written by `just init`) – believe
# the file, not our default, or the wait loop below polls an address nobody serves.
ENV_PORT="$(sed -n 's/^HTTP_PORT=//p' .env | tail -n1 | tr -d '\r')"
case "$ENV_PORT" in *[!0-9]*|'') ;; *) PORT="$ENV_PORT" ;; esac
URL="http://localhost:${PORT}"
# With a DOMAIN, Caddy answers only for that hostname – localhost is not a probe there.
ENV_DOMAIN="$(sed -n 's/^DOMAIN=//p' .env | tail -n1 | tr -d '\r')"
[ -n "$ENV_DOMAIN" ] && URL="https://${ENV_DOMAIN}"

# Validate data without sourcing .env as shell code. Existing moving tags require an
# explicit operator choice; silently replacing them could downgrade a running station.
ENV_TAG="$(sed -n 's/^KP_RUECK_TAG=//p' .env | tail -n1 | tr -d '\r')"
[[ "$ENV_TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "KP_RUECK_TAG in .env muss eine feste Version X.Y.Z sein. Bitte die installierte Version prüfen, das vollständige passende Release verwenden und dessen Version eintragen. Anleitung: docs/DEPLOYMENT.md Abschnitt 4."
[ "$ENV_TAG" = "$RELEASE_VERSION" ] || fail "Die Dateien gehören zu Release ${RELEASE_VERSION}, .env wählt ${ENV_TAG}. Bitte das vollständige passende Release verwenden; bei einem geplanten Update zuerst Backup und Anleitung in docs/DEPLOYMENT.md Abschnitt 4 beachten."
# Shell variables otherwise take precedence over .env in Compose.
export KP_RUECK_TAG="$RELEASE_VERSION"

say "Release ${RELEASE_VERSION} wird gestartet (fehlende Images werden geladen) …"
docker compose up -d --pull missing --no-build || fail "Der Start ist fehlgeschlagen. Bitte prüfen: Images für Release ${RELEASE_VERSION} verfügbar, Internet beim ersten Start und Ports ${PORT}/443 frei. Details: docs/DEPLOYMENT.md."

# ── Wait until it answers ────────────────────────────────────────────────────────────────
# First boot runs migrations and seeding before anything answers – 2–3 minutes is normal.
say "Warten, bis das Board antwortet – der erste Start dauert 2–3 Minuten, das ist normal "
DEADLINE=$(( $(date +%s) + 300 ))
READY=no
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    # -k: a certificate that is still being issued must not read as "the board is down".
    if curl -sfk -m 5 "${URL}/health" >/dev/null 2>&1; then READY=yes; break; fi
    printf '.'
    sleep 5
done
printf '\n'
[ "$READY" = yes ] || fail "Das Board hat nach 5 Minuten noch nicht geantwortet. Bitte diese Datei noch einmal doppelklicken; hilft auch das nicht, unter https://github.com/feuerwehr-oberwil/kp-rueck/issues melden."

printf '\n'
ok "Das Board läuft: ${URL}"
say "Der Browser öffnet sich – beim ersten Besuch werden dort Admin-Passwort und Stationsname gesetzt."
open "$URL" 2>/dev/null || true
printf '\n'
if [ -n "${LAN_IP:-}" ]; then
    printf '  Andere Geräte im gleichen Netz erreichen das Board unter http://%s:%s\n' "$LAN_IP" "$PORT"
fi
printf '  Erneut doppelklicken startet dieses Release. Updates erfolgen bewusst mit dem\n'
printf '  vollständigen neuen Release und Backup: docs/DEPLOYMENT.md Abschnitt 4.\n'
printf '\n'
read -r -p "Enter drücken, um dieses Fenster zu schliessen … " _ || true
exit 0
