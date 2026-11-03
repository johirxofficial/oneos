# Build a cloud-init NoCloud seed ISO for the OneOS Linux VM.
#
# The Debian "genericcloud" image runs cloud-init on first boot. It looks for a
# filesystem labelled CIDATA that contains `user-data` and `meta-data`. This
# script writes those two files and packs them into <VmDir>\seed.iso with
# Windows' built-in IMAPI2 ISO writer (no external tools).
#
#   powershell -File scripts\build-cloud-seed.ps1 -VmDir "D:\OneOS\data\virtual-machines\<id>"
#
# Options: -UserName oneos -Password oneos -Hostname oneos -Desktop xfce
# ASCII only.

param(
    [Parameter(Mandatory = $true)][string]$VmDir,
    [string]$UserName = 'oneos',
    [string]$Password = 'oneos',
    [string]$Hostname = 'oneos',
    [string]$Desktop = 'xfce'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $VmDir)) { throw "VM directory not found: $VmDir" }

$src = Join-Path $env:TEMP 'oneos-cloud-seed'
Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $src | Out-Null

$desktopPackages = if ($Desktop -eq 'xfce') {
    'xfce4 xfce4-terminal lightdm lightdm-gtk-greeter xserver-xorg dbus-x11'
} else {
    $Desktop
}

$userData = @"
#cloud-config
hostname: $Hostname
manage_etc_hosts: true
timezone: Asia/Dhaka
users:
  - name: $UserName
    gecos: OneOS
    groups: [sudo, audio, video, netdev, plugdev, autologin]
    shell: /bin/bash
    lock_passwd: false
    plain_text_passwd: $Password
    sudo: "ALL=(ALL) NOPASSWD:ALL"
chpasswd:
  expire: false
ssh_pwauth: true
package_update: true
package_upgrade: false
runcmd:
  - export DEBIAN_FRONTEND=noninteractive; apt-get install -y qemu-guest-agent
  - systemctl enable --now qemu-guest-agent
  - export DEBIAN_FRONTEND=noninteractive; apt-get install -y --no-install-recommends $desktopPackages
  - export DEBIAN_FRONTEND=noninteractive; apt-get install -y --no-install-recommends linux-image-amd64
  - sh -c 'if dpkg -s linux-image-amd64 >/dev/null 2>&1; then apt-get purge -y "linux-image-*-cloud-amd64" linux-image-cloud-amd64; update-grub; fi'
  - sed -i 's/^GRUB_CMDLINE_LINUX="\\(.*\\)"/GRUB_CMDLINE_LINUX="\\1 video=efifb:off"/' /etc/default/grub
  - update-grub
  - sed -i 's/^#\\?logind-check-graphical=.*/logind-check-graphical=false/' /etc/lightdm/lightdm.conf
  - sed -i 's/^#\\?autologin-user=.*/autologin-user=$UserName/' /etc/lightdm/lightdm.conf
  - sed -i 's/^#\\?autologin-user-timeout=.*/autologin-user-timeout=0/' /etc/lightdm/lightdm.conf
  - systemctl set-default graphical.target
  - systemctl restart lightdm || true
"@

$metaData = "instance-id: oneos-$Hostname`nlocal-hostname: $Hostname"

Set-Content -Path (Join-Path $src 'user-data') -Value $userData -Encoding ASCII
Set-Content -Path (Join-Path $src 'meta-data') -Value $metaData -Encoding ASCII

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class OneOsIsoWriter
{
    public static void Copy(object streamObject, string file)
    {
        IStream stream = (IStream)streamObject;
        using (var fs = File.Create(file))
        {
            var buffer = new byte[65536];
            IntPtr read = Marshal.AllocHGlobal(4);
            try
            {
                while (true)
                {
                    stream.Read(buffer, buffer.Length, read);
                    int n = Marshal.ReadInt32(read);
                    if (n <= 0) break;
                    fs.Write(buffer, 0, n);
                }
            }
            finally
            {
                Marshal.FreeHGlobal(read);
            }
        }
    }
}
"@

$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
try {
    $fsi.FileSystemsToCreate = 3   # ISO9660 + Joliet
    $fsi.VolumeName = 'CIDATA'
    $fsi.Root.AddTree($src, $false)
    $image = $fsi.CreateResultImage()

    $isoPath = Join-Path $VmDir 'seed.iso'
    [OneOsIsoWriter]::Copy($image.ImageStream, $isoPath)
}
finally {
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($fsi) | Out-Null
}

$size = [math]::Round((Get-Item $isoPath).Length / 1KB, 1)
"seed: $isoPath ($size KB) user=$UserName host=$Hostname"
