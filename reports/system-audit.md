# OneOS — Phase Zero System Audit

**Audit date:** 2026-11-03
**Audited host:** Acer TravelMate P259-MG
**Report status:** Milestone 1 — initial audit complete, environment preparation pending approval
**Audit scope:** read-only inspection only. No software installed, no Windows feature changed, no BIOS/UEFI setting touched, no system file modified.

---

## 1. Executive summary

| Area | Verdict | Detail |
|---|---|---|
| Host OS | **PASS** | Windows 11 Pro 25H2, build 26200.9818, UEFI, 64-bit |
| CPU / virtualization capability | **PASS** | Core i7-6500U — VT-x enabled in firmware, SLAT yes, DEP yes |
| Hypervisor platform (WHPX) | **BLOCKED — needs approval** | `HypervisorPlatform` and `VirtualMachinePlatform` are both **Disabled** |
| RAM | **MARGINAL** | 8 GB total, only ~0.7 GB free right now. Highest risk in the project |
| Storage | **PASS, conditional** | C: only 15.9 GB free. D: has 98.9 GB free → project + VM data belong on D: |
| GPU | **PASS (not used for acceleration)** | 940MX + HD 520 present; NVIDIA driver is from 2016. Not required for this architecture |
| Network | **PASS** | qemu.org and kernel.org both reachable (HTTP 200) |
| Toolchain | **MISSING** | No Rust, no Node.js, no QEMU, no MSVC Build Tools, no CMake/Ninja/Perl |
| Existing OneOS install | **NONE** | No previous installation found; nothing to overwrite |
| WebView2 runtime | **PASS** | v156.0.4314.58 already installed |

**Bottom line:** the machine is capable of running the planned architecture, but two things must be resolved before any VM work can be real:

1. WHPX features must be enabled (administrator + reboot).
2. Memory pressure must be managed deliberately — 8 GB with a running browser leaves under 1 GB free.

Nothing in the current findings blocks the project.

---

## 2. Verified hardware and OS

| Item | Prompt assumption | Verified value | Match |
|---|---|---|---|
| Host OS | Windows 11 Pro 25H2 | Microsoft Windows 11 Pro, 10.0.26200, UBR 9818 | yes |
| Architecture | 64-bit | 64-bit, UEFI firmware | yes |
| Model | Acer TravelMate P259-MG | Acer TravelMate P259-MG | yes |
| BIOS | not stated | Insyde Corp. V1.18, 2016-10-21 | — |
| CPU | Intel Core i7-6500U | Intel Core i7-6500U @ 2.50 GHz (max 2601 MHz) | yes |
| Cores | 2 physical / 4 logical | 2 cores / 4 logical processors | yes |
| RAM | 8 GB @ 2133 MHz | 8 GB SK Hynix, 2133 MHz, 1 DIMM (ChannelA-DIMM0) | yes |
| Storage | ~238 GB | 256 GB NVMe SSD (`iCoolax M.2 Nvme 3.0 256GB`), Healthy | yes |
| Dedicated GPU | NVIDIA 940MX 2 GB | NVIDIA GeForce 940MX, driver 21.21.13.7654 (2016-12-29) | yes |
| Integrated GPU | Intel HD Graphics 520 | Intel HD Graphics 520, driver 31.0.101.2111 (2022-07-19) | yes |

**Actual memory:** 8,066 MB total / 7.88 GiB, 692–717 MB available at audit time. Page file on `D:\pagefile.sys` (14.8 GB allocated, 2.1 GB in use).

**Uptime at audit:** 4 days 0 hours.

**Note:** `Win32_VideoController` lists a third adapter, `Microsoft Remote Display Adapter` — this is a virtual/remote-session adapter, not physical hardware.

---

## 3. Virtualization assessment

| Check | Result |
|---|---|
| VM Monitor Mode Extensions (VT-x) | **Yes** |
| Virtualization enabled in firmware | **Yes** |
| Second Level Address Translation (EPT) | **Yes** |
| Data Execution Prevention | **Yes** |
| Hypervisor currently running | **No** (`HypervisorPresent = False`) |
| `HypervisorPlatform` (WHPX) feature | **Disabled** (InstallState 2) |
| `VirtualMachinePlatform` feature | **Disabled** (InstallState 2) |
| `Microsoft-Hyper-V-All` | **Disabled** (InstallState 2) |
| `Microsoft-Windows-Subsystem-Linux` | **Disabled** (InstallState 2) |
| `Containers-DisposableClientVM` (Sandbox) | **Disabled** (InstallState 2) |
| `C:\Windows\System32\WinHvPlatform.dll` | present |
| `C:\Windows\System32\WinHvEmulation.dll` | present |
| `C:\Windows\System32\drivers\hvservice.sys` | present |
| `vmms.exe` / `vmcompute.exe` | absent |

### Interpretation

- The hardware and firmware side is **ready**. Nothing needs to change in BIOS/UEFI. **No BIOS modification will be requested.**
- The Windows side is **not ready**. The WHPX API DLLs exist on disk, but the *Windows Hypervisor Platform* optional feature is disabled, so QEMU cannot use `-accel whpx` yet.
- Because no hypervisor is currently running, there is **no Hyper-V conflict** today. Enabling `HypervisorPlatform` will not require enabling full Hyper-V, and full `Microsoft-Hyper-V-All` will **not** be enabled.
- Enabling these two features puts Windows itself under the Hyper-V hypervisor. Side effects to expect: VMware/VirtualBox older versions stop working, some anti-cheat software refuses to run, and Windows boots under the hypervisor permanently until the feature is disabled again. This is reversible by disabling the feature.

### Required action (approval needed)

```
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All
```

- Requires: administrator elevation + one reboot.
- Reversible: `Disable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform`.
- Alternative if the user refuses: run QEMU in pure software emulation (`-accel tcg`). This is functional but roughly 5–10× slower — not acceptable for a Debian XFCE desktop on a 2-core CPU. Therefore WHPX is effectively mandatory for this project to be usable.

**Fallback decision if WHPX cannot be enabled:** ship the platform with TCG as a documented degraded mode, and clearly mark performance limitations.

---

## 4. Storage assessment

| Volume | File system | Size | Free | Role |
|---|---|---|---|---|
| C: | NTFS | 115.5 GB | **15.9 GB** | Windows + installed tools only |
| D: | NTFS | 121.3 GB | **98.9 GB** | OneOS project, Rust target dir, VM disks, ISOs |

**Decision:** the project lives at `D:\OneOS`, not under the XAMPP web root and not on C:.

Reasons:
- Rust `target/` + `node_modules/` + WebView2 build output ≈ 2–4 GB. On a 15.9 GB C: volume that is a meaningful risk to Windows itself.
- A 25 GB QCOW2 disk plus a Debian ISO will not fit comfortably on C:.
- D: is writable and verified.

**Do not** place VM images on a network share, in a temp directory, or inside the installer output.

Storage budget on D: (of 98.9 GB free):

| Item | Estimate |
|---|---|
| Source + `target/` + `node_modules/` | 4 GB |
| QEMU portable runtime + firmware | 1.5 GB |
| Debian 13 netinst ISO | 0.7 GB |
| Guest QCOW2 (dynamic, 25 GB max, realistically 6–8 GB after XFCE install) | 8 GB |
| Snapshots / backups | 10 GB |
| Headroom | ~75 GB |

---

## 5. Memory assessment — the main constraint

8 GB installed, and at audit time only **~0.7 GB was free**, with 1.56 GB in Windows Memory Compression and multiple browsers running (Chrome, Edge, Firefox, plus the OpenCode agent itself).

Planning numbers:

| Consumer | RAM |
|---|---|
| Windows 11 idle-ish baseline | ~3.5–4.0 GB |
| Browser + editor during development | ~1.5–2.5 GB |
| QEMU process overhead | ~0.3–0.5 GB |
| Debian XFCE guest at 2048 MB | 2.0 GB |
| **Total with 2 GB guest** | **~7.8–9.0 GB → will swap** |

**Decision:** initial guest RAM is **1536 MB**, not 2048 MB. This is a deliberate deviation from the prompt's starting value, justified by measured free memory. The value stays configurable in OneOS Settings with a validation guard.

Mitigations to implement:
- Refuse to start the VM if available host RAM < guest RAM + 800 MB, and tell the user exactly how much is needed instead of failing obscurely.
- Guest-side `zram` swap so 1.5 GB feels usable under XFCE.
- No guest compositor effects; XFCE with compositing disabled.
- Warn in the UI when the host is under memory pressure.
- Never launch more than one VM by default (as specified).

**This must be documented honestly:** on this specific laptop, OneOS will be usable but not comfortable while a browser is open. That is a hardware limit, not an implementation gap.

---

## 6. Graphics assessment

| Adapter | Driver | Date | Use in OneOS |
|---|---|---|---|
| NVIDIA GeForce 940MX (2 GB) | 21.21.13.7654 | 2016-12-29 | **unused** — no GPU passthrough planned |
| Intel HD Graphics 520 | 31.0.101.2111 | 2022-07-19 | host rendering only |
| Microsoft Remote Display Adapter | 10.0.26100.9818 | — | virtual, ignore |

- The NVIDIA driver is a decade-old OEM build. It is **not** a blocker because the architecture uses QEMU's emulated VGA + VNC, and Tauri renders through WebView2 on the Intel adapter.
- **No GPU passthrough / vfio / VirGL** will be attempted. On a laptop with Optimus switching, a 2-core CPU and 8 GB RAM, passthrough is neither safe nor useful. Guest graphics stay software-rendered.
- Consequence: the guest desktop will feel smooth for XFCE, but video playback and 3D inside the guest will be poor. Documented as a known limitation.

---

## 7. Development toolchain status

| Tool | Required for | Status |
|---|---|---|
| Git 2.56.0 | source control | **installed** (`C:\Program Files\Git\cmd\git.exe`) |
| GitHub CLI 2.103.3 | optional | installed |
| WebView2 Runtime 156.0.4314.58 | Tauri webview | **installed** |
| Rust (`rustc`, `cargo`) | backend | **missing** |
| Node.js / npm | frontend build | **missing** |
| QEMU for Windows | virtualization | **missing** |
| MSVC C++ Build Tools (`link.exe`) | Rust MSVC target linker | **missing** |
| CMake | some native crates | **missing** |
| Ninja | QEMU-adjacent builds | **missing** |
| Perl | OpenSSL builds if needed | **missing** |
| 7-Zip | archive handling | missing (not required — PowerShell `Expand-Archive` suffices) |
| Python | present via Store alias (3.12 / 3.15 registered), not required |
| Visual Studio (full IDE) | not required | absent — Build Tools are enough |

Also note:
- The current shell is **not elevated** (member of Administrators, running with a filtered token). Anything requiring elevation will need a UAC prompt.
- `setx`/system PATH changes will be **avoided**. Rust and Node will be installed per-user and used through absolute paths or the user PATH entry created by their own installers.

### Toolchain plan

| Step | Method | Elevation | Approval |
|---|---|---|---|
| Rust stable (MSVC target) | `rustup-init.exe` per-user, `-y --default-host x86_64-pc-windows-msvc` | no | not required (project tooling) |
| Node.js LTS | official MSI or portable zip into `D:\OneOS\tools\node` | no (portable) | not required |
| QEMU for Windows | portable ZIP extracted to `D:\OneOS\resources\qemu` | **no** | not required — no system install, no registry, no PATH change |
| MSVC Build Tools | `vs_BuildTools.exe` with `VC.Tools.x86.x64` + Windows SDK | **yes** | **APPROVAL REQUIRED** (system-wide install) |
| WHPX features | DISM / `Enable-WindowsOptionalFeature` | **yes** + reboot | **APPROVAL REQUIRED** |
| Debian ISO (~700 MB) | download from official mirror, verify SHA256 | no | **APPROVAL REQUIRED** (large OS image download) |

MSVC Build Tools is the only unavoidable system-wide installation. There is no per-user alternative that provides `link.exe`.

---

## 8. Network

- `https://download.qemu.org/` → HTTP 200
- `https://cdn.kernel.org/` → HTTP 200
- DNS resolution working, HTTPS working.
- Guest networking will use QEMU user-mode NAT (`-netdev user`), no host firewall rule changes and no bridged adapter. No administrator rights needed for NAT.

---

## 9. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | WHPX disabled → QEMU unusable at speed | **High** | enable `HypervisorPlatform` + reboot (approval), fallback to TCG with documented slowdown |
| R2 | Only ~0.7 GB free RAM at audit | **High** | 1536 MB guest, pre-flight RAM guard, zram in guest, UI pressure warning |
| R3 | C: has 15.9 GB free | Medium | project and all VM data on D: |
| R4 | Enabling WHPX can break other hypervisors / anti-cheat | Medium | document side effects and exact rollback command before doing it |
| R5 | No MSVC linker → Rust MSVC target cannot link | Medium | Build Tools install (approval) |
| R6 | 2016-era NVIDIA driver | Low | not used by this architecture |
| R7 | Guest ISO download integrity | Medium | official Debian mirror + SHA256 verification against published checksums |
| R8 | 2 physical cores; guest gets 2 vCPUs → host contention | Medium | cap guest at 2 vCPU, do not exceed; warn during heavy host load |
| R9 | NVMe + QCOW2 on D: — no TRIM passthrough | Low | document, periodic `qemu-img convert` compaction for backups |

---

## 10. Compatibility decisions (final for Milestone 1)

1. **WHPX is the acceleration backend.** Not available yet; feature enablement requested.
2. **No Hyper-V** and no WSL/Sandbox enablement — only `HypervisorPlatform` and `VirtualMachinePlatform`.
3. **UEFI guest boot via OVMF** (bundled with the QEMU Windows build as `edk2-x86_64-code.fd`). If a QEMU build lacks usable OVMF, fall back to SeaBIOS + legacy Debian install, and record the deviation.
4. **VNC + local WebSocket proxy + noVNC** as specified. Proxy binds to `127.0.0.1` on an ephemeral port with a random per-session VNC password; QMP over a local TCP socket or named pipe, never a public interface.
5. **QEMU portable, version-pinned**, placed under `resources/qemu`, checksum-verified at setup.
6. **Guest RAM 1536 MB, 2 vCPU, 25 GB dynamic QCOW2, 1280×720, NAT.**
7. **Project root `D:\OneOS`.** VM data at `D:\OneOS\data\virtual-machines`, ISOs at `D:\OneOS\data\isos`.
8. **SQLite** for app config only; guest filesystem stays in QCOW2.
9. **No BIOS/UEFI changes, no firewall changes, no PATH hacks, no registry edits, no Defender/Firewall changes.**

---

## 11. Implementation plan (adjusted to the audit)

- **Milestone 1 — Environment (current).** Approvals, then toolchain, then `scripts/setup.ps1` that verifies everything reproducibly.
- **Milestone 2 — Rust + Tauri shell.** Workspace, commands, SQLite migrations, structured logging, capability lockdown. Test: `cargo check`, `npm run build`, `tauri dev` launches.
- **Milestone 3 — QEMU integration.** Detection/version probing, argument builder (no shell string concatenation), process lifecycle, QMP client, whpx capability probe.
- **Milestone 4 — Disk + install flow.** `qemu-img create`, OVMF wiring, Debian ISO selection + SHA256 verify, install boot, post-install verification (never claim installed before a successful boot check).
- **Milestone 5 — Embedded display.** VNC → local WS proxy → noVNC inside the webview, reconnect, error states, keyboard/mouse.
- **Milestone 6 — OneOS shell.** Boot, login, desktop, top bar, dock, launcher, windows (drag/resize/min/max/close), notifications, power menu.
- **Milestone 7 — File management + real guest terminal.** Guest agent channel or 9p/virtiofs with an allowlisted shared directory; terminal executes inside the guest, never PowerShell.
- **Milestone 8 — Settings, monitoring, network status.** Host/guest metrics clearly separated.
- **Milestone 9 — Backup, recovery, optimization.** QCOW2 snapshots via QMP, config backup, crash recovery.
- **Milestone 10 — Testing, packaging, release.** Installer, `OneOS.exe`, reports, known limitations.

Each milestone ends with a written report in `reports/` and real test output. No feature is marked complete on assumption.

---

## 12. What is required from the user now

Three approvals, each with a stated rollback:

**A. Enable WHPX (administrator + reboot)**
Changes: two Windows optional features, `HypervisorPlatform` and `VirtualMachinePlatform`.
Why: without them QEMU has no hardware acceleration and the guest desktop is unusably slow.
Impact: Windows boots under the Hyper-V hypervisor; older VMware/VirtualBox and some anti-cheat titles may stop working.
Rollback: `Disable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All`, then reboot.

**B. Install MSVC Build Tools 2022 (administrator)**
Changes: ~1.5–3 GB install under `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`.
Why: Rust on Windows needs `link.exe` and the Windows SDK.
Rollback: uninstall from Apps & Features.

**C. Download the Debian 13 netinst ISO (~700 MB) to `D:\OneOS\data\isos`**
Why: the guest OS must be a real Debian installation.
Rollback: delete the file.

Not requiring approval, will proceed once tool approvals land: per-user Rust, portable Node, portable QEMU into the project, project scaffolding, source code, builds and tests on D:.

---

## Appendix A — Commands used (read-only)

```powershell
Get-CimInstance Win32_OperatingSystem
Get-CimInstance Win32_ComputerSystem
Get-CimInstance Win32_Processor
Get-CimInstance Win32_PhysicalMemory
Get-CimInstance Win32_VideoController
Get-CimInstance Win32_OptionalFeature -Filter "Name='HypervisorPlatform' OR ..."
Get-PhysicalDisk
Get-Volume
Get-PageFileUsage
systeminfo
whoami /groups
Get-Command rustc, cargo, node, npm, git, qemu-system-x86_64, link.exe, cmake, ninja, perl
vswhere.exe -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
Invoke-WebRequest -Method Head https://download.qemu.org/ , https://cdn.kernel.org/
Test-Path for WinHvPlatform.dll, WinHvEmulation.dll, hvservice.sys, vmms.exe, vmcompute.exe
```

No write operations were performed except creating the empty project directories under `D:\OneOS`.

## Appendix B — Data excluded from this report

No passwords, tokens, private keys, product keys, machine GUIDs, user SIDs, account names or other personal identifiers are included. Memory Speed and DIMM slot labels are hardware descriptors and are retained because they affect VM tuning.
