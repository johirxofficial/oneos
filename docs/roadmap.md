# Roadmap

Ordered by user value against effort on this hardware.

## Next (small, high value)

1. **Automated Debian install.** Drive the installer with a preseed file on a
   second virtual CD, or ship a prebuilt `debian-xfce.qcow2` and skip the
   interactive install entirely. This is the single biggest usability gap.
2. **Boot-from-disk toggle in the console toolbar.** Install mode is currently a
   settings detour.
3. **Console clipboard bridge.** Host→guest via QMP `send-key` for short strings,
   guest→host via the guest agent. Avoids a SPICE dependency.
4. **Snapshot support.** QCOW2 internal snapshots through `qemu-img` plus a QMP
   `savevm`-free design (offline snapshots only, so a crash cannot corrupt one).
5. **Guest agent hardening.** Replace loopback TCP with an AF_UNIX socket or a
   random handshake line, and use a constant-time token comparison.

## Medium

6. **Multi-VM.** The schema already keys on `id`; needs a list UI, per-VM ports
   and a manager map instead of a single `Inner`.
7. **Dynamic guest resolution.** Use the VNC `SetDesktopSize` path or
   `xrandr` through the guest agent when the window resizes.
8. **Audio.** Add `-audiodev dsound` (or WASAPI) and a guest PulseAudio sink.
9. **Display scaling presets + fullscreen console.**
10. **Installer packaging.** Ship the QEMU runtime inside the NSIS bundle
    (≈1.2 GB) with a component selector so the base install stays small.
11. **Auto-download ISOs** with SHA-256 verification against `SHA256SUMS`.

## Later

12. **Snapshot/rollback UI** with disk deltas.
13. **Shared folder via virtiofs** (needs a Windows virtiofsd — currently hard).
14. **USB passthrough** with explicit per-device consent.
15. **Guest-side OneOS agent** to replace generic `guest-exec` with a typed API
    (open file, tail logs, list processes) and avoid shell entirely.
16. **Whisper-quiet TCG profiles** for older hosts: `-cpu qemu64`, smaller
    framebuffer, `-M pc` instead of `q35`.

## Explicitly not planned

* Bridged networking (LAN exposure).
* Host disk passthrough.
* Running as a Windows service.
* Telemetry or cloud accounts.
