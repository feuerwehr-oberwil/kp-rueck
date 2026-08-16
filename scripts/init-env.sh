#!/usr/bin/env bash
# Write a .env for a fresh station from three questions – or from flags, with nobody watching.
#
# Setting KP Rück up used to mean running `openssl rand -hex 32` twice, inventing three more
# passwords, and pasting all five into the right lines of a 200-line file – five chances to put
# a value on the wrong line, in a file where a wrong line means "the backend won't boot" or,
# worse, "logins silently fail". Only two of those values are a decision a station actually has
# to make (the two logins it will type). The rest is entropy, and entropy is this script's job.
#
#   ./scripts/init-env.sh                       # or: just init
#   ./scripts/init-env.sh --yes --lan           # unattended, for a runbook or a flaky SSH session
#   ./scripts/init-env.sh --yes --domain kp.example.ch
#   ./scripts/init-env.sh --help
#
# It NEVER touches an existing .env – see the guard below for why that matters. A re-run reports
# what this station is configured to do instead.
set -euo pipefail

# Every file this script creates holds secrets, including the temporaries set_key writes and
# renames over .env. A chmod at the end is not enough: `mv` gives the destination the SOURCE
# file's mode, so a 600 .env silently becomes 644 again on the next key. The umask covers the
# whole run, temporaries included, and there is no window in which .env is world-readable.
umask 077

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_ROOT/.env.example"
ENV_FILE="$REPO_ROOT/.env"

BLUE='\033[1;34m'; GREEN='\033[1;32m'; YELLOW='\033[1;33m'; RED='\033[1;31m'; OFF='\033[0m'

# A half-written .env is worse than none: the next run would hit the never-overwrite guard and
# refuse, leaving the operator with a file that has three of five secrets and no way forward
# that the script offers. So a failure after the copy takes the file with it.
PARTIAL=0
trap 'code=$?; if [ "$code" -ne 0 ] && [ "$PARTIAL" -eq 1 ]; then rm -f "$ENV_FILE" "$ENV_FILE".tmp.*; printf "${YELLOW}⚠  Removed the incomplete %s – nothing was left half-written.${OFF}\n" "$ENV_FILE" >&2; fi' EXIT
say()  { printf "${BLUE}→ %s${OFF}\n" "$*"; }
ok()   { printf "${GREEN}✓ %s${OFF}\n" "$*"; }
warn() { printf "${YELLOW}⚠  %s${OFF}\n" "$*"; }
bad()  { printf "${RED}✗ %s${OFF}\n" "$*"; }
die()  { printf "${RED}✗ %s${OFF}\n" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------------------

usage() {
    cat <<'EOF'
Write a .env for a fresh KP Rück station.

Usage: ./scripts/init-env.sh [options]          (or: just init [options])

With no options it asks three questions and generates everything else. With --lan or --domain
it asks nothing that a flag or an environment variable has already answered, so it can run
from a runbook, from CI, or over an SSH session that may drop.

  --lan              Plain HTTP on the station LAN: no domain, no certificate.
  --domain <name>    HTTPS on this domain. Caddy fetches the certificate itself, so this box
                     must own ports 80 AND 443 – HTTP_PORT is set to 80 for that reason.
  --port <n>         Host port for the board (--lan only). Default 8080, or the next free
                     port if 8080 is taken. A port you name explicitly is never moved for you.
  --host <addr>      Address browsers use to reach this box (--lan only). Default: detected.
  -y, --yes          Never ask anything. Needs --lan or --domain, and takes the default for
                     every remaining question.
  -h, --help         This text.

Passwords – both accounts are created on first boot, both need 12+ characters:

  ADMIN_SEED_PASSWORD   the admin login, your first way into the board
  VIEWER_PASSWORD       the read-only login, for wall displays and guests

  Set them in the environment to choose your own. Leave them unset and a strong one is
  generated and printed once, at the end – a generated password the operator can read beats
  a prompt that hangs an unattended script. Interactively, unset still means you are asked.

      ADMIN_SEED_PASSWORD='…' VIEWER_PASSWORD='…' ./scripts/init-env.sh --yes --lan

Re-running against an existing .env never overwrites it. It prints a status report instead:
what is configured, what is missing, and what to do next.
EOF
}

# ---------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------

MODE=""            # lan | domain  (empty = ask)
DOMAIN_ARG=""
PORT_ARG=""
HOST_ARG=""
YES=0

# need_value FLAG EXAMPLE "$@" – refuse a value-taking option with nothing usable after it.
#
# The second test is the one that earns its keep: `--yes --port --host 10.0.0.5` leaves plenty
# of arguments, so --port would eat `--host` and the loop would then blame `10.0.0.5`, the one
# argument that was correct. No option here takes a value starting with a hyphen, so a value
# that looks like a flag IS the missing value.
need_value() {
    [ "$#" -ge 4 ] || die "$1 needs a value after it, e.g. $2"
    case "$4" in
        -*) die "$1 needs a value after it, and '$4' is not one – anything starting with a hyphen is read as the next option. Write it as: $2" ;;
    esac
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --lan)     MODE=lan; shift ;;
        --domain)  need_value --domain "--domain kp.example.ch" "$@"; MODE=domain; DOMAIN_ARG="$2"; shift 2 ;;
        --port)    need_value --port "--port 8080" "$@"; PORT_ARG="$2"; shift 2 ;;
        --host)    need_value --host "--host 192.168.1.50" "$@"; HOST_ARG="$2"; shift 2 ;;
        -y|--yes)  YES=1; shift ;;
        -h|--help) usage; exit 0 ;;
        --)        shift ;;   # `just init -- --yes --lan` – harmless, and a habit worth not punishing
        *)         usage >&2; die "Unknown option: $1" ;;
    esac
done

# ---------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------

# 32 bytes of hex. openssl is on every Docker host we have met, but a fallback costs two lines
# and removes the one hard dependency this script would otherwise have.
rand_hex() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
    fi
}

# A password nobody has to type but everybody has to be able to read off a screen and copy into
# a password manager. Letters and digits only, deliberately: this value is written into .env,
# and docker compose interpolates `$` in an env file while `#` starts a comment there – a
# generated password containing either would break the stack in a way nobody would connect to
# the password. 24 alphanumerics is ~142 bits, far past the backend's 12-character minimum.
gen_password() {
    local raw
    if command -v openssl >/dev/null 2>&1; then
        raw="$(openssl rand -base64 96)"
    else
        raw="$(od -An -tx1 -N96 /dev/urandom)"
    fi
    raw="$(printf '%s' "$raw" | tr -dc 'A-Za-z0-9')"
    [ "${#raw}" -ge 24 ] || die "Could not generate a password – no openssl and no usable /dev/urandom."
    printf '%s' "${raw:0:24}"
}

# set_key KEY VALUE – replace the whole `KEY=...` line, matched on the key and nothing else.
#
# By KEY, never by line number: .env.example gets reorganised, and a positional edit would keep
# "working" while writing the admin password into the Traccar block. The awk `index(...) == 1`
# test is an anchored `^KEY=` match; awk rather than sed because the VALUE is a password and may
# contain any of sed's delimiters and backreference characters, which no amount of quoting makes
# comfortable. The value travels through the environment, so awk never parses it.
#
# A key that is not in the template is a hard failure: it means the template was renamed or
# trimmed, and silently skipping would produce a .env that looks complete and boots to an error.
set_key() {
    local key="$1" value="$2" tmp
    grep -q "^${key}=" "$ENV_FILE" \
        || die "Key '${key}' is missing from .env.example – the template and this script have drifted. Fix scripts/init-env.sh before shipping this .env."
    tmp="$ENV_FILE.tmp.$$"
    KP_INIT_VALUE="$value" awk -v key="$key" '
        !done && index($0, key "=") == 1 { print key "=" ENVIRON["KP_INIT_VALUE"]; done = 1; next }
        { print }
    ' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
}

# envval KEY – read a value back out of an existing .env, the same way `just up`, `just doctor`
# and `just backup` do. A plain grep|cut keeps the trailing \r of a file edited on Windows and
# leaves surrounding quotes in the value, and both survive far enough to become a mystery.
envval() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'
}

# Ask for a password twice, without echoing it, until it is long enough and typed the same way
# twice. The backend refuses to start on anything under 12 characters and the seed refuses to
# fall back to a default – catching it here turns a container that exits on boot with a
# stack trace into one more line at the prompt.
read_password() {  # read_password <label>  → sets REPLY_PASSWORD
    local label="$1" first second
    while :; do
        printf '  %s (min. 12 characters): ' "$label"
        IFS= read -r -s first || die "Aborted."
        printf '\n'
        if [ "${#first}" -lt 12 ]; then
            warn "Too short (${#first} characters) – the backend will refuse to start."
            continue
        fi
        printf '  repeat: '
        IFS= read -r -s second || die "Aborted."
        printf '\n'
        if [ "$first" != "$second" ]; then
            warn "The two entries differ."
            continue
        fi
        REPLY_PASSWORD="$first"
        return 0
    done
}

# resolve_password ENVVAR LABEL – the environment wins, then the prompt, then generation.
#   → REPLY_PASSWORD, and REPLY_PASSWORD_SOURCE = env | typed | generated
#
# An environment value that is too short is a hard failure rather than a quiet fallback to a
# generated one: the operator meant that password, and a station that silently got a different
# one finds out when nobody can log in.
resolve_password() {
    local var="$1" label="$2" supplied
    eval "supplied=\${$var-}"
    if [ -n "$supplied" ]; then
        [ "${#supplied}" -ge 12 ] || die "$var is only ${#supplied} characters – the backend refuses anything under 12."
        REPLY_PASSWORD="$supplied"
        REPLY_PASSWORD_SOURCE=env
        return 0
    fi
    if [ "$INTERACTIVE" -eq 1 ]; then
        read_password "$label"
        REPLY_PASSWORD_SOURCE=typed
        return 0
    fi
    REPLY_PASSWORD="$(gen_password)"
    REPLY_PASSWORD_SOURCE=generated
}

# Best-effort LAN address, purely to offer a sane default for CORS_ORIGINS. Wrong here is not
# fatal – the operator sees it and can type over it – but right here saves the single most
# common LAN misconfiguration: a CORS origin that does not match how browsers reach the board.
detect_host() {
    local ip=""
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || ip=""
    if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
        ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')" || ip=""
    fi
    if [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1; then
        ip="$(ipconfig getifaddr en0 2>/dev/null)" || ip=""
    fi
    printf '%s' "${ip:-localhost}"
}

ask() {  # ask <question> <default>  → sets REPLY_VALUE
    local question="$1" default="$2" answer
    if [ "$INTERACTIVE" -eq 0 ]; then
        REPLY_VALUE="$default"
        return 0
    fi
    printf '  %s [%s]: ' "$question" "$default"
    IFS= read -r answer || die "Aborted."
    REPLY_VALUE="${answer:-$default}"
}

confirm() {  # confirm <question> – Enter means yes; yes without asking when unattended
    local reply
    [ "$INTERACTIVE" -eq 1 ] || return 0
    printf '  %s [Y/n]: ' "$1"
    IFS= read -r reply || return 1
    case "$reply" in [nN]*) return 1 ;; *) return 0 ;; esac
}

# port_in_use PORT – 0 when something is already listening on it.
#
# Whatever the host happens to have: ss on a Debian station box, lsof on macOS, netstat on the
# oddities. Every one of them is a "maybe", so a TCP connect to the port is the last word – this
# must never answer "free" merely because a tool was missing, since the whole point is to stop
# HTTP_PORT being written to a port that cannot bind.
port_in_use() {
    local p="$1"
    if command -v ss >/dev/null 2>&1; then
        if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"; then return 0; fi
    fi
    if command -v lsof >/dev/null 2>&1; then
        if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
    fi
    if command -v netstat >/dev/null 2>&1; then
        if netstat -an 2>/dev/null | awk '/^tcp/ && /LISTEN/ {print $4}' | grep -qE "[:.]${p}\$"; then return 0; fi
    fi
    if (exec 3<>"/dev/tcp/127.0.0.1/${p}") >/dev/null 2>&1; then return 0; fi
    return 1
}

# first_free_port START – the first free port at or above START, or nothing.
# Counting upwards rather than trying a list of favourites: 8081 next to 8080 is a number the
# operator can predict and recognise in a firewall rule.
first_free_port() {
    local p="$1" limit
    limit=$((p + 200))
    while [ "$p" -le 65535 ] && [ "$p" -lt "$limit" ]; do
        if ! port_in_use "$p"; then printf '%s' "$p"; return 0; fi
        p=$((p + 1))
    done
    return 1
}

# port_holder PORT – a phrase naming what is listening, or nothing when we cannot tell.
#
# Docker first, because on the host this collision happens on, the answer is a container – and
# on a station running both boards it is almost always KP Front's Caddy, which owns 80 and 443
# (docs/RUNNING-BOTH.md §1). "Port 8080 is in use" sends someone hunting; "kp-front-caddy-1 has
# it" ends the hunt.
port_holder() {
    local p="$1" name="" proc=""
    if command -v docker >/dev/null 2>&1; then
        name="$(docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null \
            | awk -F'|' -v pat=":${p}->" 'index($2, pat) { print $1; exit }')" || name=""
    fi
    if [ -n "$name" ]; then
        case "$name" in
            *kp-front*|*kpfront*) printf 'the container %s – that is the KP Front stack (docs/RUNNING-BOTH.md §1)' "$name" ;;
            *kp-rueck*|*kprueck*) printf 'the container %s – a KP Rück stack is already running on this box' "$name" ;;
            *)                    printf 'the container %s' "$name" ;;
        esac
        return 0
    fi
    if command -v lsof >/dev/null 2>&1; then
        proc="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk 'NR == 2 { print $1 " (pid " $2 ")"; exit }')" || proc=""
    fi
    if [ -z "$proc" ] && command -v ss >/dev/null 2>&1; then
        proc="$(ss -ltnpH 2>/dev/null | awk -v pat="[:.]${p}\$" '$4 ~ pat { print $NF; exit }')" || proc=""
    fi
    [ -n "$proc" ] && printf '%s' "$proc"
    return 0
}

# ---------------------------------------------------------------------------------------
# Status report – what a re-run does instead of overwriting
# ---------------------------------------------------------------------------------------

# secret_line KEY LABEL – say whether a value is present and long enough, never what it is.
secret_line() {
    local key="$1" label="$2" min="${3:-0}" value
    value="$(envval "$key")"
    if [ -z "$value" ]; then
        bad "$(printf '%-22s empty – the stack refuses to start without it' "$label")"
    elif [ "$min" -gt 0 ] && [ "${#value}" -lt "$min" ]; then
        bad "$(printf '%-22s only %d characters – the seed needs %d, so no account is created' "$label" "${#value}" "$min")"
    else
        ok "$(printf '%-22s set' "$label")"
    fi
}

# port_line PORT WHAT – free, held by our own stack (which is what "running" looks like), or
# held by somebody else (which is why the board does not answer).
port_line() {
    local p="$1" what="$2" holder
    if ! port_in_use "$p"; then
        ok "$(printf '%-22s %s is free' "$what" "$p")"
        return 0
    fi
    holder="$(port_holder "$p")"
    case "$holder" in
        *kp-rueck*|*kprueck*) ok "$(printf '%-22s %s held by this stack (%s)' "$what" "$p" "$holder")" ;;
        "")                   warn "$(printf '%-22s %s is in use – by what, this box will not say' "$what" "$p")" ;;
        *)                    bad "$(printf '%-22s %s held by %s' "$what" "$p" "$holder")" ;;
    esac
}

status_report() {
    local domain http_port https_port cors tag profiles url running probe

    printf '\n'
    warn "$ENV_FILE already exists – nothing was written and no secret was regenerated."
    cat <<'EOF'

  That is deliberate, not caution. The file holds SECRET_KEY and AUTH_SECRET_KEY, and both
  must stay STABLE for the life of this deployment: new ones invalidate every issued token
  and log every user out – during an Einsatz, if that is when this was run – and a restored
  database backup expects the OLD values. There is no --force for it.

  Here is what this station is configured to do instead.
EOF

    domain="$(envval DOMAIN)"
    http_port="$(envval HTTP_PORT)"; http_port="${http_port:-8080}"
    https_port="$(envval HTTPS_PORT)"; https_port="${https_port:-443}"
    cors="$(envval CORS_ORIGINS)"
    tag="$(envval KP_RUECK_TAG)"
    profiles="$(envval COMPOSE_PROFILES)"

    # Same rule as `just up` and `just doctor`: CORS_ORIGINS IS the address browsers use, so on
    # a LAN it is the source of truth here – never localhost.
    if [ -n "$domain" ]; then url="https://$domain"
    elif [ -n "${cors%%,*}" ]; then url="${cors%%,*}"
    else url="http://localhost:$http_port"; fi

    printf '\n'
    say "Configured"
    printf '  %-22s %s\n' "DOMAIN"           "${domain:-(empty – plain HTTP)}"
    printf '  %-22s %s\n' "HTTP_PORT"        "$http_port"
    printf '  %-22s %s\n' "HTTPS_PORT"       "$https_port"
    printf '  %-22s %s\n' "CORS_ORIGINS"     "${cors:-(unset)}"
    printf '  %-22s %s\n' "KP_RUECK_TAG"     "${tag:-latest}"
    printf '  %-22s %s\n' "COMPOSE_PROFILES" "${profiles:-(none – the nightly backup is OFF)}"
    printf '  %-22s %s\n' "Board URL"        "$url"

    printf '\n'
    say "Secrets (values are never printed)"
    secret_line POSTGRES_PASSWORD   "POSTGRES_PASSWORD"
    secret_line SECRET_KEY          "SECRET_KEY"
    secret_line AUTH_SECRET_KEY     "AUTH_SECRET_KEY"
    secret_line ADMIN_SEED_PASSWORD "ADMIN_SEED_PASSWORD" 12
    secret_line VIEWER_PASSWORD     "VIEWER_PASSWORD" 12

    printf '\n'
    say "Ports on this box"
    port_line "$http_port" "HTTP_PORT"
    port_line "$https_port" "HTTPS_PORT"

    printf '\n'
    say "This stack"
    running=""
    if command -v docker >/dev/null 2>&1; then
        running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^kp-rueck-')" || running=""
    fi
    if [ -z "$running" ]; then
        warn "No container of this stack is running."
        printf '  Start it: just up\n'
    else
        ok "$(printf '%s container(s) running' "$(printf '%s\n' "$running" | wc -l | tr -d ' ')")"
        if [ -n "$domain" ]; then probe="$url"; else probe="http://localhost:$http_port"; fi
        if command -v curl >/dev/null 2>&1; then
            if curl -sfk -m 10 "$probe/health" >/dev/null 2>&1; then
                ok "The backend answers on $probe/health"
            else
                warn "Nothing answers on $probe/health – full report: just doctor"
            fi
        fi
    fi

    printf '\n'
    printf 'Next:\n'
    printf '  just up            # start it, or apply a change you made in .env\n'
    printf '  just doctor        # the full health report, containers, backups and tiles\n'
    printf '\n'
    printf 'To change one value, edit %s and run: just up\n' "$ENV_FILE"
    printf 'To start over from scratch, move the old file aside with your own hands first –\n'
    printf 'having seen what you are moving:\n'
    printf '\n'
    printf '      mv .env .env.old && just init\n'
    printf '\n'
}

# ---------------------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------------------

[ -f "$TEMPLATE" ] || die "$TEMPLATE not found – run this from a KP Rück checkout."

# An existing .env is never overwritten, not even behind a flag – a re-run is a status report.
if [ -e "$ENV_FILE" ]; then
    status_report
    exit 0
fi

# Two different reasons not to prompt, and they must not be confused once one of them turns into
# an error: --yes means the operator asked for it, no tty means the shell handed us none. Naming
# a flag nobody typed sends people looking for a flag they did not pass.
INTERACTIVE=1
[ "$YES" -eq 0 ] || INTERACTIVE=0
[ -t 0 ] || INTERACTIVE=0

case "$MODE" in
    domain)
        [ -z "$PORT_ARG" ] || die "--port applies to --lan only: a domain install has to serve on 80, or Let's Encrypt cannot validate the certificate."
        [ -z "$HOST_ARG" ] || die "--host applies to --lan only: with a domain, the domain IS the address browsers use."
        ;;
esac

if [ -z "$MODE" ] && [ "$INTERACTIVE" -eq 0 ]; then
    if [ "$YES" -eq 1 ]; then
        die "--yes needs --lan or --domain <name>, so that HTTPS-or-not stays your decision and not this script's guess."
    fi
    die "There is no terminal to ask on – this script's input is a pipe or a redirect, and answers piped in are NOT read.
  Say which one you want instead:
      ./scripts/init-env.sh --lan                     plain HTTP on the station LAN
      ./scripts/init-env.sh --domain kp.example.ch    HTTPS on that domain"
fi

# ---------------------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------------------

printf '\n'
say "Setting up .env for this station."
if [ "$INTERACTIVE" -eq 1 ]; then
    printf '  Three questions. Everything else is generated.\n\n'
else
    printf '  Unattended. Everything not given as a flag or in the environment is generated.\n\n'
fi

printf 'Logins\n'
if [ "$INTERACTIVE" -eq 1 ]; then
    printf '  These are the two accounts created on first boot. Write them down now;\n'
    printf '  they are not shown again, and the admin one is your first login.\n\n'
fi

resolve_password ADMIN_SEED_PASSWORD "admin password"
ADMIN_PASSWORD="$REPLY_PASSWORD"
ADMIN_SOURCE="$REPLY_PASSWORD_SOURCE"
resolve_password VIEWER_PASSWORD "viewer password (read-only, for wall displays and guests)"
VIEWER_PW="$REPLY_PASSWORD"
VIEWER_SOURCE="$REPLY_PASSWORD_SOURCE"

if [ "$INTERACTIVE" -eq 0 ]; then
    [ "$ADMIN_SOURCE" = env ]  && printf '  admin password taken from ADMIN_SEED_PASSWORD in the environment.\n'
    [ "$ADMIN_SOURCE" = generated ] && printf '  admin password generated – printed once at the end.\n'
    [ "$VIEWER_SOURCE" = env ] && printf '  viewer password taken from VIEWER_PASSWORD in the environment.\n'
    [ "$VIEWER_SOURCE" = generated ] && printf '  viewer password generated – printed once at the end.\n'
fi

if [ -z "$MODE" ]; then
    printf '\nNetworking\n'
    printf '  Do you have a domain name pointing at this machine?\n'
    printf '  A domain means automatic HTTPS. Without one the board serves plain HTTP,\n'
    printf '  which is fine on a trusted station LAN.\n\n'

    DOMAIN_ANSWER=""
    while :; do
        printf '  Domain name? (y/n): '
        IFS= read -r DOMAIN_ANSWER || die "Aborted."
        case "$DOMAIN_ANSWER" in
            [yYjJ]*) MODE=domain; break ;;
            [nN]*)   MODE=lan;    break ;;
            *)       warn "Please answer y or n." ;;
        esac
    done
else
    printf '\nNetworking\n'
fi

# HTTPS_PORT is only written when it has to move off 443 – see the LAN branch below.
HTTPS_PORT_SET=""
PORT_BLOCKED=no

if [ "$MODE" = domain ]; then
    DOMAIN_VALUE="$DOMAIN_ARG"
    while :; do
        if [ -z "$DOMAIN_VALUE" ]; then
            printf '  Domain (e.g. kp.example.ch): '
            IFS= read -r DOMAIN_VALUE || die "Aborted."
        fi
        # People paste the whole URL out of a browser; take it and tidy it rather than
        # rejecting it, because `https://kp.example.ch/` in DOMAIN gives Caddy a site address
        # it cannot serve and the failure is a certificate error, not a config error.
        DOMAIN_VALUE="${DOMAIN_VALUE#http://}"
        DOMAIN_VALUE="${DOMAIN_VALUE#https://}"
        DOMAIN_VALUE="${DOMAIN_VALUE%%/*}"
        case "$DOMAIN_VALUE" in
            "")    MSG="A domain is required – answer n to the previous question for a LAN setup." ;;
            *[!a-zA-Z0-9.-]*) MSG="That does not look like a hostname." ;;
            *.*)   MSG="" ;;
            *)     MSG="That looks like a host name without a domain – use the full name." ;;
        esac
        [ -z "$MSG" ] && break
        # Unattended there is nobody to re-ask, and a bad --domain must not become a .env.
        [ "$INTERACTIVE" -eq 1 ] || die "$MSG"
        warn "$MSG"
        DOMAIN_VALUE=""
    done
    DOMAIN_SET="$DOMAIN_VALUE"
    # 80, not 8080: Caddy's automatic certificate uses the ACME HTTP-01 challenge, which Let's
    # Encrypt sends to port 80 of the domain – and the http:// → https:// redirect lives there
    # too. On a port other than 80 the certificate is never issued and the board is only
    # reachable if the operator types https:// by hand.
    HTTP_PORT_SET=80
    CORS_SET="https://$DOMAIN_VALUE"
    PUBLIC_URL_SHOWN="https://$DOMAIN_VALUE"
    # Only unattended: interactively the operator just typed this and gets it in the summary
    # anyway, and the point of the flags is that a log tells you what a run decided.
    [ "$INTERACTIVE" -eq 1 ] || printf '  HTTPS for %s, certificate handled by Caddy.\n' "$DOMAIN_SET"

    # This branch has no free port to fall back to: 80 and 443 are not a preference, they are
    # what the certificate flow needs. So when they are taken the honest thing is to write the
    # only configuration that branch can have and say, loudly and twice, what must be freed –
    # not to write it silently and let Caddy fail with a bind error nobody can read.
    for P in 80 443; do
        if port_in_use "$P"; then
            PORT_BLOCKED=yes
            HOLDER="$(port_holder "$P")"
            warn "Port $P is already in use on this box."
            [ -n "$HOLDER" ] && printf '     Held by %s.\n' "$HOLDER"
        fi
    done
    if [ "$PORT_BLOCKED" = yes ]; then
        printf '     A domain install must own BOTH 80 and 443 – that is where the certificate is\n'
        printf '     validated and where the http:// redirect lives, so neither can be moved.\n'
        printf '     Free them before "just up", or put one reverse proxy in front of both stacks:\n'
        printf '     docs/RUNNING-BOTH.md §1.\n'
    fi
else
    DOMAIN_SET=""

    # Offer a port that can actually bind. Doing this before the question rather than after it
    # means the operator is never asked to approve a number this box has already refused.
    DEFAULT_PORT="${PORT_ARG:-8080}"
    case "$DEFAULT_PORT" in
        ''|*[!0-9]*) die "--port takes a number, not '$DEFAULT_PORT'." ;;
    esac
    if port_in_use "$DEFAULT_PORT"; then
        HOLDER="$(port_holder "$DEFAULT_PORT")"
        ALT="$(first_free_port $((DEFAULT_PORT + 1)))" || ALT=""
        if [ -n "$PORT_ARG" ]; then
            # A port the operator named explicitly is not negotiable. Moving it quietly would
            # leave their reverse proxy, their firewall rule or their bookmark pointing at
            # nothing – so this stops instead, before a single secret is written.
            printf '\n'
            [ -n "$HOLDER" ] && printf '  Port %s is held by %s.\n' "$DEFAULT_PORT" "$HOLDER"
            die "Port $DEFAULT_PORT is already in use, and you asked for that one specifically – nothing was moved for you.${ALT:+ Port $ALT is free:  --port $ALT}"
        fi
        warn "Port $DEFAULT_PORT is already in use on this box."
        [ -n "$HOLDER" ] && printf '     Held by %s.\n' "$HOLDER"
        if [ -n "$ALT" ]; then
            printf '     Offering %s instead.\n' "$ALT"
            DEFAULT_PORT="$ALT"
        else
            warn "Found no free port to offer – free one up, or pass --port."
        fi
    fi

    while :; do
        ask "Host port for the board" "$DEFAULT_PORT"
        HTTP_PORT_SET="$REPLY_VALUE"
        case "$HTTP_PORT_SET" in
            ''|*[!0-9]*) MSG="Ports are numbers." ;;
            *) if [ "$HTTP_PORT_SET" -ge 1 ] && [ "$HTTP_PORT_SET" -le 65535 ]; then MSG=""; else MSG="Out of range."; fi ;;
        esac
        if [ -n "$MSG" ]; then
            [ "$INTERACTIVE" -eq 1 ] || die "$MSG"
            warn "$MSG"
            continue
        fi
        # The operator may have typed over the offer with a port of their own.
        if port_in_use "$HTTP_PORT_SET"; then
            HOLDER="$(port_holder "$HTTP_PORT_SET")"
            warn "Port $HTTP_PORT_SET is already in use."
            [ -n "$HOLDER" ] && printf '     Held by %s.\n' "$HOLDER"
            ALT="$(first_free_port $((HTTP_PORT_SET + 1)))" || ALT=""
            if [ -n "$ALT" ] && confirm "Use $ALT instead?"; then
                HTTP_PORT_SET="$ALT"
            else
                PORT_BLOCKED=yes
                warn "Keeping $HTTP_PORT_SET – Caddy cannot bind it until whatever holds it is stopped."
            fi
        fi
        break
    done

    ask "Address browsers will use to reach this box" "${HOST_ARG:-$(detect_host)}"
    LAN_HOST="$REPLY_VALUE"
    CORS_SET="http://$LAN_HOST:$HTTP_PORT_SET"
    PUBLIC_URL_SHOWN="$CORS_SET"
    [ "$INTERACTIVE" -eq 1 ] || printf '  Plain HTTP on %s.\n' "$CORS_SET"

    # 443 is published by this stack's Caddy unconditionally, even with DOMAIN empty and no
    # certificate to serve on it – the Caddyfile's single origin is deliberately not behind a
    # compose profile (docs/RUNNING-BOTH.md §1). So on a box where KP Front already owns 443,
    # a perfectly correct LAN configuration still fails to start, on a port it never uses.
    if port_in_use 443; then
        HOLDER="$(port_holder 443)"
        HTTPS_PORT_SET="$(first_free_port 8443)" || HTTPS_PORT_SET=""
        warn "Port 443 is already in use on this box."
        [ -n "$HOLDER" ] && printf '     Held by %s.\n' "$HOLDER"
        if [ -n "$HTTPS_PORT_SET" ]; then
            printf '     This stack publishes 443 even on a plain-HTTP LAN install, so it would\n'
            printf '     fail to start on a port it never serves. Moving HTTPS_PORT to %s.\n' "$HTTPS_PORT_SET"
        else
            PORT_BLOCKED=yes
            warn "Found no free port for HTTPS_PORT – the stack will fail to bind 443."
        fi
    fi
fi

# ---------------------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------------------

printf '\n'
say "Writing $ENV_FILE"

cp "$TEMPLATE" "$ENV_FILE"
PARTIAL=1

set_key POSTGRES_PASSWORD "$(rand_hex)"
set_key SECRET_KEY "$(rand_hex)"
set_key AUTH_SECRET_KEY "$(rand_hex)"
set_key ADMIN_SEED_PASSWORD "$ADMIN_PASSWORD"
set_key VIEWER_PASSWORD "$VIEWER_PW"

set_key DOMAIN "$DOMAIN_SET"
set_key HTTP_PORT "$HTTP_PORT_SET"
set_key CORS_ORIGINS "$CORS_SET"
[ -z "$HTTPS_PORT_SET" ] || set_key HTTPS_PORT "$HTTPS_PORT_SET"

# Deliberately left EMPTY on both branches, including the plain-HTTP one.
#
# Do NOT "fix" this to AUTH_COOKIE_SECURE=false for LAN installs. The backend derives the right
# answer from CORS_ORIGINS: a plain http:// origin means a browser would drop a Secure cookie,
# so it turns the flag off by itself. Writing an explicit value here pins the wrong half of that
# pair the moment the station later puts a domain in front – the origin becomes https://, the
# derivation would follow, and a stale `false` would keep sending the login cookie in the clear.
set_key AUTH_COOKIE_SECURE ""

# Belt and braces on top of the umask, so this holds even if someone adds a write path above
# that does not inherit it.
chmod 600 "$ENV_FILE"
PARTIAL=0

ok "Wrote $ENV_FILE (mode 600)"

printf '\n'
printf 'Generated (you never need to type these):\n'
printf '  POSTGRES_PASSWORD, SECRET_KEY, AUTH_SECRET_KEY\n'
source_label() {  # where a password came from, for the summary – never the value itself
    case "$1" in
        env)       printf 'from the environment' ;;
        typed)     printf 'from your answer' ;;
        generated) printf 'generated – see below' ;;
    esac
}
printf 'Logins:\n'
printf '  ADMIN_SEED_PASSWORD  %s\n' "$(source_label "$ADMIN_SOURCE")"
printf '  VIEWER_PASSWORD      %s\n' "$(source_label "$VIEWER_SOURCE")"
printf 'Networking:\n'
printf '  DOMAIN=%s\n' "${DOMAIN_SET:-(empty – plain HTTP)}"
printf '  HTTP_PORT=%s\n' "$HTTP_PORT_SET"
[ -z "$HTTPS_PORT_SET" ] || printf '  HTTPS_PORT=%s  (moved off 443 – something else owns it)\n' "$HTTPS_PORT_SET"
printf '  CORS_ORIGINS=%s\n' "$CORS_SET"
printf '  AUTH_COOKIE_SECURE=  (empty – the backend derives it from CORS_ORIGINS)\n'
printf '\n'

# The one thing on this page that is gone the moment the screen scrolls. It goes last-but-one,
# right above "Next", because a generated password printed halfway up a wall of configuration
# is a password nobody wrote down.
if [ "$ADMIN_SOURCE" = generated ] || [ "$VIEWER_SOURCE" = generated ]; then
    warn "WRITE THESE DOWN NOW – they are not stored anywhere else and never shown again."
    [ "$ADMIN_SOURCE" = generated ]  && printf '  admin   %s\n' "$ADMIN_PASSWORD"
    [ "$VIEWER_SOURCE" = generated ] && printf '  viewer  %s\n' "$VIEWER_PW"
    printf '  (they are also in %s, which is mode 600 – back that file up.)\n' "$ENV_FILE"
    printf '\n'
fi

if [ "$MODE" = domain ]; then
    printf 'Before you start it:\n'
    printf '  - %s must resolve to this machine (A/AAAA record).\n' "$DOMAIN_SET"
    printf '  - Ports 80 AND 443 must be reachable from the internet. Port 80 is not optional:\n'
    printf "    Let's Encrypt validates the certificate over http:// on port 80, and the\n"
    printf '    redirect to https:// lives there too. HTTP_PORT is set to 80 for that reason.\n'
    if [ "$PORT_BLOCKED" = yes ]; then
        printf '  - Something on this box ALREADY holds 80 or 443 (see the warning above).\n'
        printf '    Until it is stopped, "just up" fails with a bind error – free the port or\n'
        printf '    follow docs/RUNNING-BOTH.md §1.\n'
    fi
    printf '\n'
elif [ "$PORT_BLOCKED" = yes ]; then
    printf 'Before you start it:\n'
    printf '  - A port this configuration needs is held by something else (see above).\n'
    printf '    "just up" will fail to bind until that is stopped.\n'
    printf '\n'
fi

printf 'Next:\n'
printf '  just up            # start it and wait until it answers\n'
printf '  just doctor        # health report if something looks wrong\n'
printf '\n'
printf 'Then log in at %s as "admin" with the password above,\n' "$PUBLIC_URL_SHOWN"
printf 'and change it (docs/SETUP.md §2).\n'
printf '\n'
warn "Keep a copy of .env somewhere safe, with your backups."
printf '  Restoring a database under different secrets logs everyone out.\n'
