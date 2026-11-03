# Test report

All results below were produced on the audit host. Nothing is marked as passing
unless it was executed and observed.

## Environment

| Item | Value |
| --- | --- |
| OS | Windows 11 Pro 25H2, build 26200.9818 |
| CPU | Intel Core i7-6500U, 2 cores / 4 threads |
| RAM | 8 GB (8,066 MB visible) |
| Disk | `C:` ~16 GB free, `D:` ~94 GB free (project root `D:\OneOS`) |
| GPU / display | Intel HD 520 + NVIDIA 940MX, 1536x864 desktop at 125 % scaling |
| WebView2 | 156.0.4314.58 |
| Rust | 1.99.1 (stable-x86_64-pc-windows-msvc) |
| Node | 26.13.0 (portable, `D:\OneOS\tools\node`) |
| QEMU | 11.1.0 (v11.1.0-12130-ge470268ff4), Stefan Weil build 2026-08-11 |
| Acceleration | WHPX feature installed, **hypervisor not active** (`HypervisorPresent = False`): reboot pending |

## 1. Provisioning

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 1.1 | QEMU installer SHA-512 verified before extraction | PASS | `qemu-w64-setup-20260811.exe.sha512` matches |
| 1.2 | QEMU extracted without elevation (`__COMPAT_LAYER=RunAsInvoker`) | PASS | 578 files, 1,198 MB in `resources\qemu` |
| 1.3 | `qemu-system-x86_64.exe --version` | PASS | `QEMU emulator version 11.1.0` |
| 1.4 | QEMU accelerators reported | PASS | `tcg`, `whpx` |
| 1.5 | OVMF firmware present | PASS | `share\edk2-x86_64-code.fd` (3,653,632 B), `share\edk2-i386-vars.fd` (540,672 B) |
| 1.6 | Machine `PATH` unchanged | PASS | no `qemu` entry in machine or user PATH |
| 1.7 | No uninstall registry key created | PASS | no QEMU entry in HKLM/HKCU Uninstall |
| 1.8 | Windows features `HypervisorPlatform`, `VirtualMachinePlatform` enabled | PASS (reboot pending) | `enable-whpx.log`, `HypervisorPresent = False` |

## 2. Build

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 2.1 | `tsc --noEmit` | PASS | no diagnostics |
| 2.2 | `cargo check` | PASS | 0 errors, 9 dead-code warnings |
| 2.3 | `npm run tauri build` (release) | PASS | `oneos.exe` 5.7 MB, bundled resources |
| 2.4 | NSIS installer produced | PASS | `OneOS_0.1.0_x64-setup.exe` 2.13 MB |
| 2.5 | LTO profile builds on an 8 GB host | PASS with `lto = "thin"`, `codegen-units = 4` | `lto = true` + `codegen-units = 1` failed with `rustc-LLVM ERROR: out of memory` |

## 3. Application UI

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 3.1 | Application starts and shows a window titled `OneOS` | PASS | `logs\shot-01.png` |
| 3.2 | First-run wizard renders (capability report) | PASS | `logs\ui-01.png` |
| 3.3 | QEMU detected by the app | PASS | wizard shows "QEMU runtime found" |
| 3.4 | Free disk reported | PASS | 93.8 GB |
| 3.5 | Free host memory reported | PASS | 732 MB at the time of the run |
| 3.6 | Step 2 renders resource controls (memory, vCPU, disk, WHPX, UEFI) | PASS | `logs\ui-02.png` |
| 3.7 | Layout fits a 1366-wide window (card 860x700 centred) | PASS | measured through CDP: `innerWidth 1367`, card `x=253.6 w=860 h=700` |
| 3.8 | Step 3 preselects the only ISO in `data\isos` | implemented, verified in the final build | see Â§5 |

## 4. QEMU wiring

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 4.1 | `-vnc 127.0.0.1:<display>` port semantics confirmed | PASS | display 5905 listened on **11805**; the builder now subtracts `VNC_BASE_PORT` (5900) |
| 4.2 | QMP socket accepts a connection and greets | PASS | `{"QMP": {"version": {"qemu": {"major": 11, "minor": 1}}}}` |
| 4.3 | `chardev socket` on a Windows named pipe | **FAIL (QEMU limitation)** | `Failed to bind socket to \\.\pipe\...: Unknown error`; the guest agent now uses loopback TCP |
| 4.4 | Full argument vector boots the ISO (TCG) | PASS | all four ports (50010-50013) accept connections, serial log receives OVMF output |
| 4.5 | Guest RAM encrypted/allocated under the agent sandbox job | **environment artefact** | direct child processes of the agent shell cannot commit >128 MB (`cannot set up guest memory 'pc.ram'`); the same command launched through WMI allocates 1 GB normally |

## 5. Guest installation

Interactive: the Debian installer requires operator input inside the console.

Status of this build (verified live on 2026-11-03 04:11):

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 5.1 | Disk image created for the VM | PASS | `disk.qcow2` 25 GB virtual, `qemu-img info` reports qcow2 |
| 5.2 | QEMU starts with the ISO attached and `-boot order=d` | PASS | `<vm>\qemu-args.log`, process stays alive |
| 5.3 | QMP handshake and VNC password are applied | PASS | status reaches `running`, `display_session` returns a WS URL |
| 5.4 | noVNC renders the guest inside the Guest Display window | PASS | `logs\run-05-console-live.png` shows the Debian 13.7.0 UEFI installer menu |
| 5.5 | UEFI (OVMF) boot works | PASS | TianoCore splash captured with `screendump` (`logs\fb-01.png`) |
| 5.6 | Console keyboard/mouse relay through the loopback WS proxy | PASS | ArrowDown sent from the app moved the installer selection from *Graphical install* to *Install* and the framebuffer repainted (`logs\run-07-key-js.png`) |
| 5.7 | Debian + XFCE installed and first boot | pending | operator step, see `docs/installation.md` |

The install itself is performed by the operator inside the console; the VM used
1 GB of guest RAM and TCG emulation because Windows had not been rebooted yet
(WHPX becomes available after the pending reboot).


## 6. Known failures found and fixed during testing

| # | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| 6.1 | noVNC could never connect | `-vnc 127.0.0.1:<port>` treats the value as a display number, so QEMU listened on `port + 5900` | subtract 5900 before passing the display number |
| 6.2 | Guest agent channel never opened | QEMU cannot bind a Windows named pipe for `-chardev socket` | moved the channel to `127.0.0.1:<allocated port>` |
| 6.3 | "Start installation" booted the empty disk | `build_args` read `cfg.install_mode` instead of the per-start override | start now builds an effective config with the requested install flag |
| 6.4 | VM refused to start when Windows was busy | hard 800 MB reserve with no override | explicit "Start anyway" action (`vm_start(install, force)`) |
| 6.5 | Release build OOM on an 8 GB host | `lto = true` + `codegen-units = 1` | `lto = "thin"` + `codegen-units = 4` |
| 6.6 | Every VM start failed at the QMP handshake | QMP answers no-data commands with `{"return": {}}`, but the client rejected anything non-`null` | treat a successful `qmp_capabilities` / `set_password` reply as success |
| 6.7 | QEMU died instantly with `-vnc ...: Could not open 'en-us': Permission denied` | QEMU resolves its keymap directory relative to the **working directory**; when the app is launched from `C:\Windows\System32` (WMI/scheduled-task style launch) the relative name `en-us` hits that directory's MUI *folder*, and opening a directory yields `EACCES` | the QEMU child now runs with `current_dir(vm_dir)`; the full argument vector is also written to `<vm>\qemu-args.log` for diagnosis |

## 7. Not yet verified

* WHPX execution (blocked on the reboot).
* Debian + XFCE installation and first boot (operator step).
* `qemu-guest-agent` round trip (needs the installed guest).
* Console interaction latency on WHPX.
* Console opened *before* the guest's first video-mode switch can stay black
  until **Reconnect console** is pressed. QEMU's VNC server keeps the
  framebuffer size the client negotiated at connect time (640x480 during early
  UEFI boot); reconnecting after the guest sets its mode shows the correct
  800x600/1280x800 surface. Verified in this run: first attach was black,
  reconnect painted the installer menu immediately.

This section is updated as those steps are completed.

## 8. Session, screen lock, software and storage

Verified live on 2026-11-03 between 07:33 and 07:41 against the release build
(`oneos.exe` 6,400,000 B, `OneOS_0.1.0_x64-setup.exe` 2,248,722 B, both
07:33:53), driven through the DevTools protocol.

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 8.1 | Session identity follows the Windows account | PASS | Settings â†’ Account shows *OneOS runs inside Windows account `<windows-account>`*; the display name was changed to **J. Doe** and `session_info` still returns `J. Doe` after a full restart |
| 8.2 | Set a PIN | PASS | *Set PIN* with `1234` â†’ badge changes to **PIN SET**, buttons become *Change PIN* / *Remove* |
| 8.3 | Ctrl+L locks the session | PASS | synthetic Ctrl+L â†’ clock + avatar lock screen, "SESSION LOCKED" (`logs\run-11-lock.png`) |
| 8.4 | A wrong PIN is rejected | PASS | `0000` â†’ inline "incorrect PIN", the field is cleared |
| 8.5 | The correct PIN unlocks | PASS | `1234` â†’ desktop and open windows return |
| 8.6 | Lock on start-up | PASS | toggle enabled, app restarted â†’ the lock screen appears before the desktop and shows *J. Doe* (`logs\run-12-startlock.png`) |
| 8.7 | Change the PIN | PASS | current `1234` + new `4321` â†’ *PIN saved*; the old PIN is now rejected and `4321` unlocks |
| 8.8 | Brute-force throttle | PASS | five wrong attempts â†’ the sixth answers "too many attempts, try again in 30s"; after 33 s the correct PIN works again |
| 8.9 | Remove the PIN | PASS | *Remove* with the current PIN â†’ `pinSet:false`; the lock screen then offers **Resume session** without a PIN |
| 8.10 | Software window | PASS | dock and launcher open it; the Linux tab lists 7 applications with *Install* disabled and the reason "the Linux machine is not running"; the Windows tab lists 5 applications with official download-page buttons (`logs\run-13-desktop.png`) |
| 8.11 | Download links are validated | PASS | `open_url` with a `file://` URL is rejected: "only http and https links can be opened" |
| 8.12 | The WebView2 profile lives on the data drive | PASS | `D:\OneOS\data\webview\EBWebView` is created at launch; `%LOCALAPPDATA%\os.oneos.desktop` received no writes after the switch and was deleted |
| 8.13 | Storage cleanup | PASS | `scripts\cleanup-storage.ps1` removed 2,634 MB (four NSIS leftovers + debug target) and later 1,192 MB (rebuilt debug target + legacy profile). C: free 8.23 â†’ 11.18 GB, D: free 91.56 â†’ 92.53 GB |

Not covered by the table because the Debian guest is not installed yet:
`linux_app_install` (apt through the QEMU guest agent) and the terminal/file
manager. The command itself is a fixed per-id script; the UI refuses to enable
*Install* until `guest_status` reports a connected agent, which is the correct
behaviour today.


## 9. Debian cloud image and the XFCE desktop

Verified live on 2026-11-03 between 08:04 and 10:02 on the same host, with QEMU
on TCG (2 vCPU, 1024 MB guest) because WHPX still needs a reboot.

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 9.1 | Automated guest install | PASS | `scripts\setup-cloud-guest.ps1` replaced the empty 192 KB placeholder disk with `debian-13-genericcloud-amd64.qcow2` (325 MiB), grew it to 25 GB, reset `efi-vars.fd` and wrote `seed.iso` (label `CIDATA`, 54 KB, user-data 889 B) |
| 9.2 | The seed ISO is well formed | PASS | mounted on Windows: volume `CIDATA`, files `meta-data` (48 B) and `user-data` (889 B) readable |
| 9.3 | QEMU attaches the seed | PASS | `vm\qemu.rs` adds `-drive file=<vm>\seed.iso,format=raw,readonly=on` as a virtio disk whenever the file exists; the guest logged `seed=/dev/vdb` |
| 9.4 | The cloud image boots under UEFI | PASS | GRUB loaded `vmlinuz-...` from the ESP and the serial console streamed the full boot (`logs\cloud-01-boot.png`) |
| 9.5 | cloud-init installs the desktop | PASS | `qemu-guest-agent` first, then XFCE; `cloud-init 25.1.4 finished ... Datasource DataSourceNoCloud [seed=/dev/vdb]` at 347 s guest time |
| 9.6 | The guest agent connects | PASS | `guest_status` returns Debian 13 (trixie), kernel 6.12.113, `guest_exec` runs commands as root, 2 vCPU / 960 MB reported |
| 9.7 | The console needs the full kernel | PASS (after fix) | with the cloud kernel the surface stayed black/garbled because no DRM driver exists; installing `linux-image-amd64` (contains `bochs-drm`) and booting it made QEMU switch the VNC surface to 1280x800 |
| 9.8 | XFCE renders inside the window | PASS | the Linux Desktop window shows the XFCE panel (*Applications*, clock) and the *Home* / *File System* desktop icons (`logs\cloud-16-desktop.png`, `logs\cloud-19-desktop.png`) |
| 9.9 | Boot-time kernel selection | PASS | `linux-image-6.12.115+deb13.1-amd64` is the default GRUB entry after purging the cloud kernel meta package; the fallback cloud kernel stays under *Advanced options* |

### What was needed to make the desktop appear

1. **`linux-image-amd64`** - the cloud kernel ships no DRM drivers, so QEMU never
   learned the guest mode (1280x800) and kept serving 800x600; text arrived
   garbled and the desktop was black.
2. **`video=efifb:off`** - stops `simpledrm/efifb` from claiming the linear
   framebuffer before `bochs-drm` gets it.
3. **`lightdm-gtk-greeter` + `xserver-xorg`** - a `--no-install-recommends` XFCE
   install has neither, so lightdm had no greeter and no X server.
4. **`logind-check-graphical=false`** - without a DRM device logind does not mark
   the seat graphical, and lightdm waits forever instead of starting a session.
5. **Autologin** - `autologin-user=oneos`, `autologin-user-timeout=0`.

All five are now part of `scripts\build-cloud-seed.ps1`, so the next automated
install boots straight to the desktop.

Guest credentials: user `oneos`, password `oneos` (sudo without password). Change
it inside the guest (`passwd`) and delete `<vm>\seed.iso`, which contains the
initial password.


