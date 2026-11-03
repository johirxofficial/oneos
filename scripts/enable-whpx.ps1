# OneOS - enable hardware virtualization support (WHPX)
# Enables only: HypervisorPlatform + VirtualMachinePlatform
# Does NOT enable full Hyper-V, WSL, or Sandbox.
# Reversible with: Disable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
# Requires: administrator elevation, then one reboot.

$ErrorActionPreference = 'Stop'
$log = 'D:\OneOS\logs\enable-whpx.log'
$marker = 'D:\OneOS\logs\enable-whpx.result.txt'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Tee-Object -FilePath $log -Append | Out-Host
}

try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Write-Log "isAdmin=$isAdmin"
    if (-not $isAdmin) { throw 'This script must be run elevated.' }

    foreach ($f in 'HypervisorPlatform', 'VirtualMachinePlatform') {
        $before = (Get-WindowsOptionalFeature -Online -FeatureName $f).State
        Write-Log "$f before=$before"
        if ($before -ne 'Enabled') {
            $r = Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart -ErrorAction Stop
            Write-Log "$f enable result: RestartNeeded=$($r.RestartNeeded)"
        } else {
            Write-Log "$f already enabled"
        }
        $after = (Get-WindowsOptionalFeature -Online -FeatureName $f).State
        Write-Log "$f after=$after"
    }

    'SUCCESS' | Set-Content -Path $marker -Encoding ASCII
    Write-Log 'DONE - reboot required for WHPX to become active'
}
catch {
    $m = $_.Exception.Message
    ('FAILED: ' + $m) | Set-Content -Path $marker -Encoding ASCII
    Write-Log ('FAILED: ' + $m)
}
