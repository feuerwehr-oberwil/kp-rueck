# Double-click starter for Windows – the real logic behind Start-KP-Rueck.bat, which launches
# this via `powershell -ExecutionPolicy Bypass -File`. The macOS twin is "Start KP Rück.command".
#
# The contract with the operator: no terminal knowledge, no .env editing, no passwords on disk.
# This writes an .env of pure entropy plus LAN defaults (the /setup wizard handles the account
# passwords in the browser), starts the production compose stack and waits for it. Running it
# again starts the installed release; upgrades require the complete matching release files. It never overwrites an existing .env – same guard
# philosophy as scripts/init-env.sh.
#
# Operator-facing output is German; comments stay English like the rest of the repo.
# This file is saved as UTF-8 WITH BOM on purpose: Windows PowerShell 5.1 reads a BOM-less
# script as ANSI and garbles every umlaut in the messages below.

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Say([string]$m)  { Write-Host "> $m" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "OK $m" -ForegroundColor Green }
function Warn2([string]$m){ Write-Host "!  $m" -ForegroundColor Yellow }

# Every failure path ends here: one clear German sentence about what to do, never a stack
# trace as the last line. The .bat wrapper keeps the window open afterwards.
function Fail([string]$m) {
    Write-Host ""
    Write-Host "X $m" -ForegroundColor Red
    exit 1
}

# cwd is NOT reliable on double-click – resolve the repo root from this file's own location.
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$Port = 8080

Write-Host ""
Say "KP Rück wird gestartet …"

if (-not (Test-Path (Join-Path $RepoRoot 'docker-compose.yml'))) {
    Fail "Dieser Ordner ist unvollständig – bitte das heruntergeladene ZIP komplett entpacken und «Start-KP-Rueck.bat» im entpackten Ordner erneut doppelklicken."
}

try {
    $ReleaseVersion = (Get-Content (Join-Path $RepoRoot 'frontend/package.json') -Raw -ErrorAction Stop | ConvertFrom-Json).version
} catch { Fail "Release-Version fehlt. Bitte das vollständige ZIP eines veröffentlichten Releases verwenden." }
if ($ReleaseVersion -notmatch '^\d+\.\d+\.\d+$') {
    Fail "Release-Version ungültig. Bitte das vollständige ZIP eines veröffentlichten Releases verwenden."
}

# --- Docker ------------------------------------------------------------------------------
function Test-DockerReady {
    docker info *> $null
    return ($LASTEXITCODE -eq 0)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Warn2 "Docker ist auf diesem Computer noch nicht installiert."
    Write-Host "  Docker ist das Programm, das das Board im Hintergrund laufen lässt."
    Write-Host "  Die Download-Seite öffnet sich jetzt im Browser:"
    Write-Host "    1. «Docker Desktop for Windows» herunterladen und installieren."
    Write-Host "    2. Docker Desktop einmal starten und die Einrichtung bestätigen."
    Write-Host "    3. Danach «Start-KP-Rueck.bat» erneut doppelklicken – es geht dort weiter, wo es aufgehört hat."
    Start-Process "https://www.docker.com/products/docker-desktop/" -ErrorAction SilentlyContinue
    Fail "Bitte zuerst Docker Desktop installieren, dann diese Datei erneut doppelklicken."
}

if (-not (Test-DockerReady)) {
    # The CLI exists but the daemon is down – almost always "Docker Desktop is not running".
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) {
        Say "Docker Desktop wird gestartet …"
        Start-Process $desktop -ErrorAction SilentlyContinue
        Write-Host "  Das kann eine Minute dauern " -NoNewline
        $deadline = (Get-Date).AddSeconds(120)
        while (-not (Test-DockerReady)) {
            if ((Get-Date) -gt $deadline) { break }
            Write-Host "." -NoNewline
            Start-Sleep -Seconds 3
        }
        Write-Host ""
    }
    if (-not (Test-DockerReady)) {
        Fail "Docker läuft noch nicht. Bitte Docker Desktop von Hand starten, warten bis es «running» meldet, und diese Datei erneut doppelklicken."
    }
}
Ok "Docker läuft."

docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    Fail "Diese Docker-Installation ist zu alt (kein «docker compose»). Bitte Docker Desktop aktualisieren und diese Datei erneut doppelklicken."
}

# --- .env --------------------------------------------------------------------------------
# Pure entropy + LAN defaults, nothing an operator has to invent: the account passwords are
# set in the browser at /setup on the first visit. Never overwrites an existing .env – those
# secrets must stay stable for the life of the deployment.
$EnvFile = Join-Path $RepoRoot '.env'
if (Test-Path $EnvFile) {
    Ok "Vorhandene Konfiguration (.env) wird weiterverwendet."
    $LanIp = $null
} else {
    Say "Konfiguration wird erstellt …"
    function New-HexSecret {
        # 32 bytes from the platform CSPRNG, as 64 hex chars – same shape as `openssl rand -hex 32`.
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    # Best-effort LAN address, so other screens in the Gerätehaus are an allowed origin too.
    # Both entries are plain http:// on purpose – mixing schemes in CORS_ORIGINS breaks logins.
    $LanIp = $null
    try {
        $LanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -in @('Dhcp','Manual') } |
            Select-Object -First 1).IPAddress
    } catch {}
    $cors = "http://localhost:$Port"
    if ($LanIp) { $cors += ",http://${LanIp}:$Port" }
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $content = @"
# Automatisch erstellt von «Start-KP-Rueck» am $stamp.
# Die drei Geheimwerte müssen STABIL bleiben – neue Werte melden alle Benutzer ab und passen
# nicht mehr zu einem Datenbank-Backup. Diese Datei gehört darum mit zu den Backups.
# Alle weiteren Einstellungen: siehe .env.example im gleichen Ordner.
POSTGRES_PASSWORD=$(New-HexSecret)
SECRET_KEY=$(New-HexSecret)
AUTH_SECRET_KEY=$(New-HexSecret)
# Kein Admin-/Viewer-Passwort hier: die Konten werden beim ersten Besuch im Browser gesetzt.
DOMAIN=
HTTP_PORT=$Port
CORS_ORIGINS=$cors
KP_RUECK_TAG=$ReleaseVersion
COMPOSE_PROFILES=backup
"@
    # UTF-8 WITHOUT BOM and LF endings: docker compose reads this file, and a BOM would glue
    # itself onto the first line. The German comments survive fine as plain UTF-8.
    $content = $content -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($EnvFile, $content + "`n", (New-Object System.Text.UTF8Encoding($false)))
    # The Windows equivalent of chmod 600: drop inherited ACLs, grant only this user.
    try {
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $EnvFile /inheritance:r /grant:r "${me}:(F)" *> $null
    } catch {}
    Ok "Konfiguration erstellt (.env, Zugriff nur für diesen Benutzer)."
}

# A re-used .env may carry another port (edited by hand) – believe the file, not our default,
# or the wait loop below polls an address nobody serves.
$envLines = Get-Content $EnvFile -ErrorAction SilentlyContinue
$envPort = ($envLines | Where-Object { $_ -match '^HTTP_PORT=(\d+)\s*$' } | Select-Object -Last 1)
if ($envPort -match '^HTTP_PORT=(\d+)') { $Port = [int]$Matches[1] }
$Url = "http://localhost:$Port"
# With a DOMAIN, Caddy answers only for that hostname – localhost is not a probe there.
$envDomain = ($envLines | Where-Object { $_ -match '^DOMAIN=.+\S' } | Select-Object -Last 1)
if ($envDomain -match '^DOMAIN=(\S+)') { $Url = "https://$($Matches[1])" }

# Read .env as data only. A moving tag or mismatched release must never silently upgrade
# or downgrade an existing installation. Keep the existing Compose project and secrets.
$tagLine = ($envLines | Where-Object { $_ -match '^KP_RUECK_TAG=' } | Select-Object -Last 1)
$installedTag = if ($tagLine) { $tagLine.Substring('KP_RUECK_TAG='.Length) } else { '' }
if ($installedTag -notmatch '^\d+\.\d+\.\d+$') {
    Fail "KP_RUECK_TAG in .env muss eine feste Version X.Y.Z sein. Bitte die installierte Version prüfen, das vollständige passende Release verwenden und dessen Version eintragen. Anleitung: docs/DEPLOYMENT.md Abschnitt 4."
}
if ($installedTag -ne $ReleaseVersion) {
    Fail "Die Dateien gehören zu Release $ReleaseVersion, .env wählt $installedTag. Bitte das vollständige passende Release verwenden; bei einem geplanten Update zuerst Backup und Anleitung in docs/DEPLOYMENT.md Abschnitt 4 beachten."
}
# Shell variables otherwise take precedence over .env in Compose.
$env:KP_RUECK_TAG = $ReleaseVersion
Say "Release $ReleaseVersion wird gestartet (fehlende Images werden geladen) …"
docker compose up -d --pull missing --no-build
if ($LASTEXITCODE -ne 0) {
    Fail "Der Start ist fehlgeschlagen. Bitte prüfen: Images für Release $ReleaseVersion verfügbar, Internet beim ersten Start und Ports $Port/443 frei. Details: docs/DEPLOYMENT.md."
}

# --- Wait until it answers ---------------------------------------------------------------
# First boot runs migrations and seeding before anything answers – 2–3 minutes is normal.
Say "Warten, bis das Board antwortet – der erste Start dauert 2–3 Minuten, das ist normal "
# A certificate that is still being issued must not read as "the board is down".
try { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } } catch {}
$deadline = (Get-Date).AddSeconds(300)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "$Url/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 5
}
Write-Host ""
if (-not $ready) {
    Fail "Das Board hat nach 5 Minuten noch nicht geantwortet. Bitte diese Datei noch einmal doppelklicken; hilft auch das nicht, unter https://github.com/feuerwehr-oberwil/kp-rueck/issues melden."
}

Write-Host ""
Ok "Das Board läuft: $Url"
Say "Der Browser öffnet sich – beim ersten Besuch werden dort Admin-Passwort und Stationsname gesetzt."
Start-Process $Url -ErrorAction SilentlyContinue
Write-Host ""
if ($LanIp) {
    Write-Host "  Andere Geräte im gleichen Netz erreichen das Board unter http://${LanIp}:$Port"
}
Write-Host "  Erneut doppelklicken startet dieses Release. Updates erfolgen bewusst mit dem"
Write-Host "  vollständigen neuen Release und Backup: docs/DEPLOYMENT.md Abschnitt 4."
Write-Host ""
exit 0
