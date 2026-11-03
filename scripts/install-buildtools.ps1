# OneOS - install MSVC Build Tools (C++ linker + Windows SDK) for Rust/Tauri
# System-wide install. Reversible via Apps & Features.
# Requires administrator elevation.

$ErrorActionPreference = 'Continue'
$log = 'D:\OneOS\logs\buildtools.log'
$marker = 'D:\OneOS\logs\buildtools.result.txt'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Tee-Object -FilePath $log -Append | Out-Host
}

Write-Log 'starting Build Tools install via winget'

$args = @(
    'install', '--id', 'Microsoft.VisualStudio.2022.BuildTools', '--exact',
    '--accept-package-agreements', '--accept-source-agreements',
    '--disable-interactivity',
    '--override', '"--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
)

$proc = Start-Process -FilePath 'winget.exe' -ArgumentList $args -NoNewWindow -PassThru -Wait
Write-Log "winget exit code: $($proc.ExitCode)"

$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path $vswhere) {
    $path = & $vswhere -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    Write-Log "vswhere installationPath: $path"
}

# Verify link.exe exists in the expected MSVC layout
$link = Get-ChildItem 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC' -Recurse -Filter link.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($link) {
    Write-Log "link.exe found: $($link.FullName)"
    'SUCCESS' | Set-Content -Path $marker -Encoding ASCII
} else {
    Write-Log 'link.exe NOT found'
    'FAILED: link.exe not found' | Set-Content -Path $marker -Encoding ASCII
}
