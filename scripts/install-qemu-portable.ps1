# OneOS - provision the portable QEMU runtime into project resources.
#
# The upstream NSIS installer declares requireAdministrator, but OneOS installs
# QEMU as a plain folder. We therefore run the installer with the Windows
# "RunAsInvoker" compatibility shim, which keeps the whole operation inside the
# user's own folder: no elevation, no PATH edit, no uninstall registry key.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File install-qemu-portable.ps1
# ASCII only: Windows PowerShell 5.1 mis-decodes UTF-8 punctuation in scripts.

$ErrorActionPreference = 'Continue'

$root    = 'D:\OneOS'
$target  = Join-Path $root 'resources\qemu'
$instDir = Join-Path $root 'resources\installers'
$log     = Join-Path $root 'logs\qemu-install.log'
$marker  = Join-Path $root 'logs\qemu-install.result.txt'
$setup   = Join-Path $instDir 'qemu-w64-setup-20260811.exe'
$shaFile = Join-Path $instDir 'qemu-w64-setup-20260811.sha512'
$url     = 'https://qemu.weilnetz.de/w64/2026/qemu-w64-setup-20260811.exe'
$urlSha  = 'https://qemu.weilnetz.de/w64/2026/qemu-w64-setup-20260811.sha512'

New-Item -ItemType Directory -Force -Path $instDir, (Split-Path $log) | Out-Null

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Tee-Object -FilePath $log -Append | Out-Host
}

function Fail([string]$msg) {
    Write-Log "FAILED: $msg"
    Set-Content -Path $marker -Value "FAILED: $msg" -Encoding ASCII
    exit 1
}

# 1. Download and verify the installer.
if (-not (Test-Path $setup)) {
    Write-Log "downloading $url"
    try { Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing -TimeoutSec 900 }
    catch { Fail "download failed: $($_.Exception.Message)" }
}
if (-not (Test-Path $shaFile)) {
    try { Invoke-WebRequest -Uri $urlSha -OutFile $shaFile -UseBasicParsing -TimeoutSec 120 }
    catch { Write-Log "warning: could not fetch the SHA-512 file; skipping verification" }
}
if (Test-Path $shaFile) {
    $expected = ((Get-Content $shaFile -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA512 -Path $setup).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { Fail "SHA-512 mismatch (expected $expected, got $actual)" }
    Write-Log "SHA-512 verified: $actual"
}

# 2. Extract into the project folder without elevation.
if (Test-Path (Join-Path $target 'qemu-system-x86_64.exe')) {
    $v = (& (Join-Path $target 'qemu-system-x86_64.exe') --version 2>&1 | Select-Object -First 1)
    Write-Log "runtime already present: $v"
    Set-Content -Path $marker -Value 'SUCCESS' -Encoding ASCII
    exit 0
}

$sysBefore = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$usrBefore = [Environment]::GetEnvironmentVariable('Path', 'User')

Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $target | Out-Null

Write-Log "running installer silently into $target"
$env:__COMPAT_LAYER = 'RunAsInvoker'
$proc = Start-Process -FilePath $setup -ArgumentList '/S', "/D=$target" -PassThru
$deadline = (Get-Date).AddMinutes(6)
while ((Get-Date) -lt $deadline) {
    if (Test-Path (Join-Path $target 'qemu-system-x86_64.exe')) { break }
    if ($proc.HasExited) { break }
    Start-Sleep -Seconds 2
}
Remove-Item Env:__COMPAT_LAYER -ErrorAction SilentlyContinue

# 3. Verify the side effects we promise never happen.
Start-Sleep -Seconds 2
$sysAfter = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$usrAfter = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($sysBefore -ne $sysAfter) {
    [Environment]::SetEnvironmentVariable('Path', $sysBefore, 'Machine')
    Write-Log 'system PATH was modified - restored'
}
if ($usrBefore -ne $usrAfter) {
    [Environment]::SetEnvironmentVariable('Path', $usrBefore, 'User')
    Write-Log 'user PATH was modified - restored'
}

$qemu = Join-Path $target 'qemu-system-x86_64.exe'
if (-not (Test-Path $qemu)) { Fail 'qemu-system-x86_64.exe was not created' }

$version = (& $qemu --version 2>&1 | Select-Object -First 1)
Write-Log "qemu-system-x86_64 present: $version"
$files = (Get-ChildItem $target -Recurse -File | Measure-Object).Count
Write-Log "files: $files"
Set-Content -Path $marker -Value 'SUCCESS' -Encoding ASCII
Write-Log 'SUCCESS'
