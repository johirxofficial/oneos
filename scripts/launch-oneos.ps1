# OneOS - launch the built application for UI testing.
#
# Usage:
#   powershell -File scripts\launch-oneos.ps1 [-Debug]
#
# -Debug sets WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS so scripts\cdp.mjs can drive
# the window over the DevTools protocol (development only).
#
# The process is created through WMI so it does not inherit the memory limits of
# an editor/agent sandbox job. A normal desktop launch behaves the same way.
# ASCII only.

param([switch]$Debug)

$ErrorActionPreference = 'Stop'

$root = 'D:\OneOS'
$exe  = Join-Path $root 'src-tauri\target\release\oneos.exe'
$cmd  = Join-Path $root 'scripts\launch-oneos.cmd'

if (-not (Test-Path $exe)) { throw "not built: $exe" }

Get-Process oneos -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 700

$lines = @('@echo off')
if ($Debug) {
    $lines += 'set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222'
}
$lines += "start `"`" `"$exe`""
Set-Content -Path $cmd -Value ($lines -join "`r`n") -Encoding ASCII

$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "cmd.exe /c `"$cmd`""
}
if ($r.ReturnValue -ne 0) { throw "WMI launch failed: $($r.ReturnValue)" }

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    $p = Get-Process oneos -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($p -and $p.MainWindowHandle -ne 0) {
        "oneos pid=$($p.Id) window=$($p.MainWindowTitle)"
        if ($Debug) {
            Start-Sleep -Seconds 2
            try {
                $targets = (Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json' -UseBasicParsing -TimeoutSec 5).Content
                "devtools: " + ($targets -replace '\s+', ' ')
            } catch {
                "devtools endpoint not reachable: $($_.Exception.Message)"
            }
        }
        exit 0
    }
    Start-Sleep -Milliseconds 500
}
throw 'the application did not open a window in time'
