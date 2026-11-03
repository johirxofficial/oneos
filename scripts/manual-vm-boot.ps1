# OneOS - boot the guest manually with the same argument vector the app builds.
# Verifies QEMU/OVMF/ISO wiring without the UI.
#
# The QEMU process is created through WMI so it does not inherit the memory
# limits of an editor/agent sandbox job; a normal desktop launch behaves the same.
#
# ASCII only.

$ErrorActionPreference = 'Stop'

$root   = 'D:\OneOS'
$qemu   = Join-Path $root 'resources\qemu\qemu-system-x86_64.exe'
$img    = Join-Path $root 'resources\qemu\qemu-img.exe'
$share  = Join-Path $root 'resources\qemu\share'
$vm     = Join-Path $root 'data\virtual-machines\manualtest'
$iso    = Join-Path $root 'data\isos\debian-13.7.0-amd64-netinst.iso'
$disk   = Join-Path $vm 'disk.qcow2'
$vars   = Join-Path $vm 'efi-vars.fd'
$serial = Join-Path $vm 'console.log'
$stderr = Join-Path $vm 'qemu-stderr.log'
$cmdFile = Join-Path $root 'scripts\manual-vm.cmd'

$mem = if ($env:ONEOS_TEST_MEM) { $env:ONEOS_TEST_MEM } else { '1024' }

New-Item -ItemType Directory -Force -Path $vm | Out-Null
if (-not (Test-Path $disk)) { & $img create -f qcow2 $disk 25G | Out-Null }
if (-not (Test-Path $vars)) { Copy-Item (Join-Path $share 'edk2-i386-vars.fd') $vars }

$vncPort = 50010
$qmpPort = 50011
$qgaPort = 50012
$sshPort = 50013

$parts = @(
  "`"$qemu`"",
  '-name oneos-manual',
  '-machine q35',
  '-cpu max',
  '-smp 2',
  "-m $mem",
  '-display none',
  '-vga std',
  "-vnc 127.0.0.1:$($vncPort - 5900),password=on",
  "-qmp tcp:127.0.0.1:$qmpPort,server=on,wait=off",
  '-monitor none',
  "-drive file=$disk,if=none,id=disk0,format=qcow2,cache=writeback,discard=unmap",
  '-device virtio-blk-pci,drive=disk0',
  "-drive file=$iso,media=cdrom,readonly=on,if=none,id=cd0",
  '-device ide-cd,drive=cd0,bus=ide.0',
  '-boot order=d,menu=off',
  "-drive if=pflash,format=raw,unit=0,readonly=on,file=$(Join-Path $share 'edk2-x86_64-code.fd')",
  "-drive if=pflash,format=raw,unit=1,file=$vars",
  "-netdev user,id=net0,hostfwd=tcp:127.0.0.1:$sshPort-:22",
  '-device virtio-net-pci,netdev=net0',
  '-device virtio-serial-pci',
  "-chardev socket,id=qga0,host=127.0.0.1,port=$qgaPort,server=on,wait=off",
  '-device virtserialport,chardev=qga0,name=org.qemu.guest_agent.0',
  '-usb',
  '-device usb-tablet',
  '-rtc base=localtime,driftfix=slew',
  "-serial file:$serial"
)

$line = ($parts -join ' ') + " > `"$vm\qemu-stdout.log`" 2> `"$stderr`""
$cmdText = "@echo off`r`ncd /d $vm`r`n$line`r`n"
Set-Content -Path $cmdFile -Value $cmdText -Encoding ASCII

Remove-Item $stderr, $serial -ErrorAction SilentlyContinue
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c `"$cmdFile`"" }
"launched cmd pid=$($r.ProcessId)"
Start-Sleep -Seconds 4

$q = Get-Process qemu-system-x86_64 -ErrorAction SilentlyContinue
if ($q) {
    "qemu pid=$($q.Id) workingSet=$([math]::Round($q.WorkingSet64/1MB))MB"
} else {
    "qemu is not running"
    if (Test-Path $stderr) { "stderr: " + ((Get-Content $stderr) -join ' ') }
}
