# Installation

## 1. Host prerequisites

Windows 11 (or Windows 10 2004+) with:

* WebView2 runtime – preinstalled on Windows 11.
* Hardware virtualisation enabled in firmware (VT-x / AMD-V). This is a BIOS
  setting; OneOS never changes firmware settings.
* Hypervisor Platform components for WHPX:

```powershell
# elevated PowerShell, once, then reboot
dism /online /enable-feature /featurename:HypervisorPlatform /all /norestart
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

Without these the guest still runs, but on TCG (pure emulation), which is
roughly an order of magnitude slower. OneOS reports the mode it will use in the
first-run wizard.

## 2. Runtime layout

OneOS expects this layout, either in the checkout or next to an installed
`oneos.exe`:

```
OneOS\
  oneos.exe
  resources\qemu\qemu-system-x86_64.exe
  resources\qemu\share\edk2-x86_64-code.fd
  resources\qemu\share\edk2-i386-vars.fd
  data\isos\
```

The QEMU runtime is provisioned from the official Stefan Weil Windows build:

```powershell
.\scripts\install-qemu-portable.ps1   # verifies SHA-512, extracts to resources\qemu
```

The installer normally requires administrator rights only because of its
manifest; the provisioning script uses the Windows `__COMPAT_LAYER=RunAsInvoker`
compatibility shim so the files can be extracted into a user-writable folder
without elevation, without modifying PATH, and without creating uninstall keys.
The QEMU binary is verified by running `qemu-system-x86_64.exe --version`.

## 3. Build from source

```powershell
# toolchain
rustup default stable          # 1.85 or newer
npm install                    # or: npm --prefix frontend install

# UI + app (development)
npm run tauri dev

# production
npm run tauri build
```

Artifacts:

* `src-tauri\target\release\oneos.exe`
* `src-tauri\target\release\bundle\nsis\OneOS_0.1.0_x64-setup.exe`

The NSIS installer is a normal per-machine installer. OneOS is also fully
portable: copy the folder (executable + `resources/` + `data/`) anywhere and it
keeps its state next to the executable. `ONEOS_HOME` overrides the data root, and
a source checkout always keeps its data in the checkout (never in `target/`).

## 4. First run

1. Launch `oneos.exe`.
2. Wizard, step 1 — capability report:
   * QEMU runtime found and executable
   * OVMF firmware found
   * free disk space on the data volume
   * free host memory against the requested guest size
3. Wizard, step 2 — resources:
   * guest memory (512 MB – 60 % of host RAM, 256 MB steps)
   * vCPU count (1 – 4)
   * disk size (8 – 200 GB, dynamic QCOW2)
   * WHPX on/off
   * UEFI on/off (requires OVMF)
4. Wizard, step 3 — installer:
   * pick an ISO from `data\isos`, or type an absolute path
   * recommended: `debian-13.7.0-amd64-netinst.iso`
5. `Start installation` creates the disk and boots the ISO in the console.

### Installing Debian inside the console

The guest boots the Debian installer with a serial log and a graphical console.
Recommended choices:

* Language/locale as needed, hostname `oneos`
* Root password + one normal user
* Guided partitioning – entire disk (the disk is a private QCOW2 file)
* Software selection: **Debian desktop environment + XFCE**; add *SSH server*
  if you want the forwarded port to work
* GRUB to the virtual disk

The installer takes 20–60 minutes on this class of hardware (and considerably
longer on TCG).

### After the guest is installed

```bash
sudo apt update
sudo apt install -y qemu-guest-agent
sudo systemctl enable --now qemu-guest-agent
```

Then in OneOS make sure *Install mode* is off (Settings → Machine) and start the
VM. The console attaches automatically; the terminal, file manager and monitor
unlock once the guest agent answers.

### Automated alternative: Debian cloud image (no installer)

The distro cloud image boots already installed and configures itself from a
cloud-init seed, which removes the interactive step:

```powershell
# 1. download once (~325 MiB) into the data root
curl.exe -L -o <data root>\data\isos\debian-13-genericcloud-amd64.qcow2 `
  https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2

# 2. stop the Linux machine in OneOS, then:
powershell -File scripts\setup-cloud-guest.ps1 `
  -VmDir "<data root>\data\virtual-machines\<id>"
```

`setup-cloud-guest.ps1` archives the previous disk as `disk.qcow2.before-cloud`
(unless it is the empty placeholder), copies the image, grows it, resets the UEFI
variable store and writes `seed.iso` (volume label `CIDATA`). The seed creates
user `oneos` (password `oneos`, sudo without password), installs
`qemu-guest-agent` first, then `xfce4` + `lightdm` + `lightdm-gtk-greeter` +
`xserver-xorg`, and finally the full `linux-image-amd64` kernel with autologin
and `graphical.target`.

The full kernel matters: the cloud kernel ships without DRM drivers, so the QEMU
display never learns the guest resolution and the console stays black. The seed
also adds `video=efifb:off` to the kernel command line, removes the cloud kernel
meta-package so the full kernel boots first, and sets
`logind-check-graphical=false` so lightdm starts a seat even when logind does not
mark it graphical.

On the first boot cloud-init runs those steps under TCG in 25-60 minutes (the
kernel and XFCE download is the slow part); the console shows apt output.
`seed.iso` is read-only and harmless afterwards, but it contains the initial
password - delete it once the desktop is up, or regenerate it with a different
password.

The seed is regenerated with:

```powershell
powershell -File scripts\build-cloud-seed.ps1 -VmDir "<vm dir>" `
  -UserName oneos -Password "your-password"
```

QEMU attaches it automatically whenever `<vm dir>\seed.iso` exists
(`vm\qemu.rs`, read-only virtio disk).

## 5. Uninstall

* Stop the VM.
* Delete the OneOS folder (portable) or the entry created by the NSIS installer.
* Guest data lives only in `data\virtual-machines`; delete that folder to reclaim
  the disk space. Nothing is written to the registry by the portable layout and
  no system PATH entry is created.

## 6. Verification against the original spec

| Spec requirement | Implementation |
| --- | --- |
| Real Linux computer in one window | Debian 13 + XFCE guest, embedded noVNC console |
| Persistent disk | QCOW2 in `data/virtual-machines/<id>/disk.qcow2` |
| Rust backend | 100 % of privileged logic in Rust (32 Tauri commands) |
| No Electron/Node backend | React is presentation only; no Node in the shipped app |
| Embedded console, no external browser | noVNC inside the app WebView over a loopback WS proxy |
| Loopback only | every socket binds `127.0.0.1`, random ports, VNC password |
| No Defender/Firewall/registry/BIOS/PATH changes | verified: portable install, PATH unchanged, no uninstall keys |
