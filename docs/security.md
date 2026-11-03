# Security

## Trust model

| Asset | Trust |
| --- | --- |
| Windows host | fully trusted, never modified by OneOS beyond its own folder |
| OneOS backend (Rust) | trusted; the only component with filesystem/process access |
| WebView2 renderer | untrusted for privileges; compromised UI cannot escape Tauri IPC |
| Guest (Debian) | untrusted; it is a VM, not a sandbox boundary for the host |
| QEMU | trusted third-party executable with its own attack surface |

The renderer gets no ambient capability. There is no `fs` plugin, no `shell`
plugin, no HTTP plugin, no dialog plugin and no `dangerousRemoteDomainIpcAccess`.
Everything the UI can do is one of the 32 explicit commands.

## Controls that are implemented

1. **Loopback-only network.** VNC, QMP, guest agent and the WebSocket proxy all
   bind `127.0.0.1` with ports allocated by the OS (`bind(…:0)`). No listener is
   created on `0.0.0.0` and the guest uses QEMU user-mode NAT, so nothing is
   exposed to the LAN.
2. **Per-session console token.** Each VM start creates a 40-character random
   token. The WebSocket proxy rejects any handshake whose `token` query parameter
   does not match, with HTTP 401. The token is also set as the VNC password
   through QMP (`set_password`), so connecting to the VNC port directly requires
   the same secret.
3. **No shell strings.** QEMU and `qemu-img` are spawned with argument vectors
   (`std::process::Command::args`). ISO paths, disk paths and VM names are never
   interpolated into a command line.
4. **Path validation.** Guest paths are normalised and rejected when they escape
   the shared root (`validate_guest_path`). Host paths for disks must live under
   `data/virtual-machines` (`VmConfig::validate_static`). Import/export are the
   only file-moving commands and both validate their arguments.
5. **No privilege escalation.** OneOS never requests elevation at runtime, never
   writes HKLM, never edits PATH, never touches Defender, Firewall, BCD or
   firmware settings, and installs no services or drivers.
6. **Serialised diagnostics.** QEMU stdout/stderr and the serial console are
   written to files inside the VM directory, read only through bounded tails.
7. **Bounded IPC.** Commands validate ranges before touching the VM: memory
   512–4096 MB and ≤ 60 % of host RAM, 1–4 vCPU, 8–200 GB disk, display
   800×600–2560×1440.
8. **Graceful teardown.** The application exit hook always terminates QEMU, so a
   crashed UI cannot leave an orphaned VM with a locked disk.
9. **CSP.** The renderer CSP allows only `'self'`, `ipc:`, and loopback
   `http`/`ws` origins; no remote script, no inline script, no eval.

## Known residual risks

* **QEMU is a large native attack surface.** The guest is not a security boundary
  between the guest and Windows: a malicious guest that exploits a QEMU device
  emulation bug could escape. OneOS mitigates exposure (loopback, no host USB
  passthrough, no shared folders, no 9p/virtfs, no SPICE), but cannot remove it.
  Keep QEMU updated.
* **The guest agent channel is loopback TCP without authentication.** Any local
  process that guesses the random port can issue guest-agent commands. The
  window is small and the port only exists while the VM runs, but it is not a
  cryptographic boundary. A future version should use a random handshake and/or
  Windows AF_UNIX sockets.
* **VNC authentication uses a truncated 8-byte password** (a RFB limitation).
  The effective secret is 8 of the token's 40 characters. Access is still
  loopback-only and the token-gated WebSocket proxy is the intended path.
* **The renderer holds the session token in memory** for the lifetime of the
  console connection (standard for noVNC).
* **User-supplied ISO files are mounted read-only** into the guest; they are not
  validated beyond existence. Only use images you trust.

## Deliberate non-goals

* No clipboard sharing between host and guest.
* No host folder sharing / drag-and-drop.
* No USB passthrough.
* No bridged networking.
* No telemetry, no network calls from the app itself.

## Reporting

Security issues in OneOS itself: open an issue in the project repository.
QEMU issues belong upstream (https://www.qemu.org/security/).
