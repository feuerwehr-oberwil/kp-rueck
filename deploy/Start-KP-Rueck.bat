@echo off
rem Doppelklick-Start fuer KP Rueck. Die eigentliche Logik liegt in start-kp-rueck.ps1
rem daneben; diese Datei existiert, weil sich eine .ps1 nicht doppelklicken laesst.
rem ASCII only in here on purpose: cmd.exe zeigt Umlaute je nach Codepage falsch an.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-kp-rueck.ps1"
if errorlevel 1 (
    echo.
    echo Der Start wurde nicht abgeschlossen - die Meldung oben sagt, was zu tun ist.
)
echo.
pause
endlocal
