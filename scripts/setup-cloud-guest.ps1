# Replace the OneOS VM disk with the Debian cloud image and prepare cloud-init.
#
# The distro "genericcloud" image boots straight into a configured system and
# expands its root filesystem on first boot, so no interactive installer is
# needed. This script:
#   1. refuses to run while QEMU is alive,
#   2. archives the current disk (unless it is the empty 192 KB placeholder),
#   3. copies the cloud image to disk.qcow2 and grows it,
#   4. resets the UEFI variable store so OVMF rediscovers the boot loader,
#   5. writes seed.iso with the cloud-init profile.
#
#   powershell -File scripts\setup-cloud-guest.ps1 -VmDir "D:\OneOS\data\virtual-machines\<id>"
#
# Options: -Image <qcow2> -DiskGb 25 -UserName oneos -Password oneos
# ASCII only.

param(
    [Parameter(Mandatory = $true)][string]$VmDir,
    [string]$Image = 'D:\OneOS\data\isos\debian-13-genericcloud-amd64.qcow2',
    [int]$DiskGb = 25,
    [string]$UserName = 'oneos',
    [string]$Password = 'oneos'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $VmDir)) { throw "VM directory not found: $VmDir" }
if (-not (Test-Path $Image)) { throw "cloud image not found: $Image" }
if (Get-Process qemu-system-x86_64 -ErrorAction SilentlyContinue) {
    throw 'QEMU is running; stop the Linux machine first'
}

$disk = Join-Path $VmDir 'disk.qcow2'
$qemuImg = 'D:\OneOS\resources\qemu\qemu-img.exe'
if (-not (Test-Path $qemuImg)) { throw "qemu-img not found: $qemuImg" }

# Keep a small placeholder out of the way, archive anything that has data.
if (Test-Path $disk) {
    $size = (Get-Item $disk).Length
    if ($size -lt 4MB) {
        Remove-Item $disk -Force
        "removed empty placeholder disk ($([math]::Round($size/1KB,1)) KB)"
    } else {
        $backup = "$disk.before-cloud"
        if (Test-Path $backup) { Remove-Item $backup -Force }
        Move-Item $disk $backup
        "archived previous disk -> $backup"
    }
}

Copy-Item $Image $disk
"copied cloud image -> $disk"

& $qemuImg resize $disk "${DiskGb}G" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "qemu-img resize failed ($LASTEXITCODE)" }
"grown to ${DiskGb}G"

$vars = Join-Path $VmDir 'efi-vars.fd'
if (Test-Path $vars) {
    Remove-Item $vars -Force
    'reset UEFI variable store'
}

& (Join-Path $PSScriptRoot 'build-cloud-seed.ps1') -VmDir $VmDir -UserName $UserName -Password $Password

$info = & $qemuImg info --output=json $disk | ConvertFrom-Json
"disk: $($info.format) virtual=$([math]::Round($info.'virtual-size'/1GB,1))GB"
"login: $UserName / $Password (change it after the desktop appears)"
