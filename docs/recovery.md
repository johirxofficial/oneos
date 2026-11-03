# Recovery

## The VM will not start

1. Read the error in the console panel; it is the QEMU message verbatim.
2. Check `data\virtual-machines\<id>\qemu-stderr.log` for the last lines.
3. Check `data\virtual-machines\<id>\qemu-args.log`; it is the exact argument
   vector OneOS passed to QEMU, one argument per line.
4. Confirm QEMU is still present:

```powershell
D:\OneOS\resources\qemu\qemu-system-x86_64.exe --version
```

If the runtime is missing, re-run `scripts\install-qemu-portable.ps1`.

OneOS deliberately runs QEMU with the VM directory as its working directory.
QEMU resolves its keymap files relative to the process working directory, so a
QEMU started from `C:\Windows\System32` (which contains an `en-us` MUI folder)
aborts with `Could not open 'en-us': Permission denied`.

## "not enough free host memory"

Windows reports less free RAM than `guest size + 800 MB`. Close applications, or
use the **Start anyway** action that appears after the error. The guest will run,
but Windows may swap heavily.

## The console is black or never connects

* Is the status "running"? If it is "starting", QEMU has not finished booting.
* Is port `vnc_port` set? It is shown in the window's status line.
* If terminal/files fail but the console works, the guest agent is the problem,
  not VNC.

Reconnect with the refresh icon in the console toolbar. The proxy accepts a new
connection at any time while the VM runs.

## QEMU is left over after a crash

```powershell
Get-Process qemu-system-x86_64 | Stop-Process -Force
```

OneOS kills the process on normal exit, including window close. A hard kill of
`oneos.exe` can leave QEMU behind. The disk is not corrupted by that, but the
QCOW2 lock is held until the process is gone.

## The disk looks corrupt

Stop everything, then:

```powershell
D:\OneOS\resources\qemu\qemu-img.exe check --repair `
  D:\OneOS\data\virtual-machines\<id>\disk.qcow2
```

`--repair` can lose the last writes. Back up the file first if it matters.

## UEFI boot loops or the guest no longer boots

The per-VM UEFI variable store is `efi-vars.fd`. Stop the VM, delete that file,
and OneOS copies a fresh OVMF template on the next start. Boot entries inside the
guest are lost, so you may need to pick the boot device again.

## QEMU was updated and WHPX stopped working

Check the mode in Settings → System and run:

```powershell
D:\OneOS\resources\qemu\qemu-system-x86_64.exe -accel help
```

The list must contain `whpx`. If it does not, the installed runtime was built
without WHPX; restore the runtime from `resources\installers`.

## Windows features are disabled

WHPX needs both features. Re-run `scripts\enable-whpx.ps1` in an **elevated**
PowerShell and reboot. OneOS never enables features by itself.

## I forgot the OneOS PIN

The PIN is only a local screen lock. Quit OneOS (the power menu, or stop
`oneos.exe`) and delete the stored hash, then start again:

```powershell
# with OneOS closed:
sqlite3 D:\OneOS\data\oneos.db "DELETE FROM settings WHERE key LIKE 'session.pin.%';"
```

`sqlite3` may not be installed; any SQLite browser works. Deleting the two rows
(`session.pin.salt`, `session.pin.hash`) leaves the display name and the
*lock on start* flag untouched. If *lock on start* is still on, the lock screen
will then unlock with the **Resume session** button until a new PIN is set.

## Start over completely

Stop the VM, then delete:

```
data\virtual-machines\<id>\          guest disk + firmware vars + logs
data\oneos.db                        configuration + settings + event log
```

The next launch shows the first-run wizard again. The QEMU runtime and ISOs are
untouched.

## Collecting a useful bug report

```
logs\oneos.log.*
data\virtual-machines\<id>\qemu-stderr.log
data\virtual-machines\<id>\console.log     (may contain guest data)
the exact error text from the UI
QEMU version: resources\qemu\qemu-system-x86_64.exe --version
mode: WHPX or TCG, from Settings → System
```
