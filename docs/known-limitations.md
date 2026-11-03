# Known limitations

These are measured facts about this build and this host, not guesses.

## Hardware

| Limit | Reality on the audit host |
| --- | --- |
| 2 physical cores (i7-6500U, 4 threads) | 2 vCPU is the practical maximum; the UI caps at 4 |
| 8 GB RAM, ~0.7 GB observed free | The default 1536 MB guest cannot start while other apps hold memory. OneOS refuses to start and offers an explicit "Start anyway" override |
| No hardware acceleration until reboot | WHPX requires HypervisorPlatform + VirtualMachinePlatform **and a reboot**; before that QEMU runs on TCG |
| TCG performance | Expect minutes to boot an installer, seconds per screen redraw. Unusable for daily work; fine for proving the pipeline |
| No GPU acceleration in the guest | QEMU `-vga std` provides a plain framebuffer; XFCE runs without compositing tricks |
| 60 Hz VNC transport | noVNC pushes raw rectangles; animations and video are slow even with WHPX |

## Functional gaps

* **One VM.** The database holds a single VM row; there is no multi-VM manager.
* **Interactive OS installation.** The Debian installer is not automated; the
  operator completes language, partitioning, user and task selection inside the
  console. A fully automated alternative exists: `scripts\setup-cloud-guest.ps1`
  replaces the empty disk with Debian's cloud image and a cloud-init seed, so the
  first boot installs the desktop itself (see `docs/installation.md`).
* **The console needs a DRM-capable guest kernel.** Debian's *cloud* kernel ships
  without any DRM driver. QEMU then never learns the guest resolution, so text
  arrives garbled and the X desktop stays black even though Xorg is running.
  Installing `linux-image-amd64` (which contains `bochs-drm`) and booting it fixes
  the surface; the cloud seed script installs and selects that kernel
  automatically.
* **Guest agent is optional.** Terminal, file manager and guest telemetry need
  `qemu-guest-agent` inside the guest. Without it those windows show a clear
  "Linux agent not reachable" error, and the *Install* buttons in Software stay
  disabled.
* **No snapshots, no rollback, no clone.** Back up `disk.qcow2` while the VM is
  stopped.
* **The guest agent channel is a single ordered pipe.** A call that exceeds its
  deadline leaves its reply queued; the next request would read that stale reply
  ("guest-exec did not return a pid"). The backend now flushes the pipe with
  `guest-sync` and retries once, but concurrent polling during heavy guest I/O can
  still surface a transient "did not answer in time".
* **No clipboard or drag-and-drop bridge.** Copy/paste between Windows and the
  guest is not implemented.
* **No audio.** QEMU is started with `-display none` and no audio backend.
* **No USB or PCI passthrough.**
* **The guest picks its own resolution.** QEMU's `std` VGA starts at 640×480;
  OVMF and the guest then switch to 800×600 (installer) or whatever the desktop
  selects. The console scales that surface into the window; no fixed 1280×720
  mode is imposed.
* **Attaching before the first mode switch can show a black console.** A VNC
  client that connects while the guest is still at 640×480 keeps that size even
  after OVMF changes modes. Press **Reconnect console** in the Guest Display
  toolbar once the installer is up.
* **No automatic ISO download.** OneOS lists ISOs in `data/isos` and validates
  the path; downloading is a manual step.
* **The install-mode flag is manual.** The wizard enables it for the installation
  boot only; after installing Debian, turn *Install mode* off in Settings if it
  was enabled there, otherwise the ISO is booted again.

## Session and screen lock

* **The PIN is self-contained.** It is stored as a salted SHA-256 hash in the
  local SQLite database (16-byte random salt) and checked inside OneOS. It is
  **not** your Windows password or Windows Hello: unlocking OneOS does not
  re-authenticate Windows, so the Windows session stays signed in underneath.
  Verifying the Windows credential would need an elevation prompt on each unlock
  and is unreliable for Microsoft accounts, so it is deliberately not used.
* **There is no idle auto-lock and no recovery code.** Locking is explicit
  (Ctrl+L, the power menu, or *Require the PIN at start-up*). If the PIN is
  forgotten, quit OneOS and delete the `session.pin.hash` row from
  `data\oneos.db` (`docs/recovery.md`).
* **The lock screen prevents use of the shell, not access to the files.** The
  VM, its QCOW2 disk and the QEMU process keep running while locked.

## Application installation

* **Linux applications install with apt inside the guest**, not in Windows. The
  Software window sends one fixed script per catalogue entry through the QEMU
  guest agent, which runs as root inside Debian. It therefore needs an installed
  Debian guest **with `qemu-guest-agent`**; until then every *Install* button is
  disabled and explains why.
* **Chrome is installed from Google's signed repository** (key + apt source),
  which requires outbound HTTPS from the guest. Chromium, Firefox ESR, VLC,
  LibreOffice, GIMP and Flatpak come straight from the Debian archive.
* **The installation path has not been executed end-to-end** in this build: the
  guest has no operating system yet. The command plumbing, validation and UI
  gating are in place; the apt run is unverified.
* **Windows applications are not installed silently.** OneOS is a Windows
  application, so Chrome or any other Windows app installs through its normal
  installer and appears in the Windows taskbar. The Software window only opens
  the vendor's official download page.

## Storage

* **The WebView2 profile moved to the data drive** (`data\webview`, via
  `WEBVIEW2_USER_DATA_FOLDER`). Before this change it wrote ~70 MB and growing
  into `%LOCALAPPDATA%` on C:.
* **Build artefacts are not part of a release install.** The installer is 2.1 MB;
  QEMU (1.2 GB), the ISO (756 MB) and the guest disk are separate files under
  `D:\OneOS`.
* **`scripts\cleanup-storage.ps1`** removes only OneOS-attributable leftovers
  (NSIS temp folders in `%TEMP%`, the debug build tree, the legacy C: profile).
  It is a dry run unless `-Apply` is passed.

## Packaging

* The NSIS bundle contains only `oneos.exe` (2.1 MB). The 1.2 GB QEMU runtime and
  the guest disk are **not** inside the installer: they live in the data folder.
  Distributing OneOS therefore means shipping the folder or replaying
  `scripts/install-qemu-portable.ps1`.
* The data root is resolved at runtime: `ONEOS_HOME`, then a folder containing
  `resources/` or `data/` next to the executable, then the source checkout, then
  the executable's folder, then `%LOCALAPPDATA%\OneOS`.

## Platform

* Windows only. `src/vm/qmp.rs` gates the guest-agent client behind
  `#[cfg(windows)]`.
* The QEMU runtime is an external GPL-2.0 process, not linked into OneOS.
* Tested on Windows 11 Pro 25H2 (26200) with WebView2 156.
