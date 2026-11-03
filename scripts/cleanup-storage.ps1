# OneOS storage cleanup.
#
# Removes leftovers that belong to this project and nothing else:
#   * NSIS extraction folders created while installing QEMU/OneOS (*.tmp in %TEMP%)
#   * rustc/cargo scratch directories in %TEMP%
#   * the OneOS debug build tree (release artefacts are kept)
#   * the legacy WebView2 profile on C: (only after it has been migrated to D:)
#
#   powershell -ExecutionPolicy Bypass -File scripts\cleanup-storage.ps1          # dry run
#   powershell -ExecutionPolicy Bypass -File scripts\cleanup-storage.ps1 -Apply   # delete

param([switch]$Apply)

$ErrorActionPreference = "SilentlyContinue"
$temp = $env:LOCALAPPDATA + "\Temp"

$targets = @()
$targets += Get-ChildItem $temp -Filter "ns*.tmp" -Force | Where-Object { $_.PSIsContainer -and $_.LastWriteTime -lt (Get-Date).AddHours(-6) }
$targets += Get-ChildItem $temp -Filter "rustc*" -Force | Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-6) }
$targets += Get-ChildItem $temp -Filter "cargo*" -Force | Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-6) }

$paths = @("D:\OneOS\src-tauri\target\debug")

# The WebView2 profile lives on C: until the app is rebuilt with the D: redirect.
$legacy = $env:LOCALAPPDATA + "\os.oneos.desktop"
if ((Test-Path "D:\OneOS\data\webview") -and (Test-Path $legacy)) {
    $paths += $legacy
}

function Get-Size($item) {
    if ($null -eq $item) { return 0 }
    if ($item -is [System.IO.FileInfo]) { return $item.Length }
    return (Get-ChildItem $item.FullName -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum
}

$total = 0
foreach ($t in $targets) {
    $mb = [math]::Round((Get-Size $t) / 1MB, 1)
    $total += $mb
    if ($Apply) { Remove-Item $t.FullName -Recurse -Force }
    "{0,9:N1} MB  {1}" -f $mb, $t.FullName
}
foreach ($p in $paths) {
    if (-not (Test-Path $p)) { continue }
    $mb = [math]::Round((Get-Size (Get-Item $p)) / 1MB, 1)
    $total += $mb
    if ($Apply) { Remove-Item $p -Recurse -Force }
    "{0,9:N1} MB  {1}" -f $mb, $p
}

$free = Get-PSDrive C, D | Select-Object Name, @{ n = "FreeGB"; e = { [math]::Round($_.Free / 1GB, 2) } }
""
if ($Apply) {
    "Removed {0:N1} MB" -f $total
} else {
    "Would remove {0:N1} MB (dry run - pass -Apply to delete)" -f $total
}
$free | Format-Table -AutoSize
