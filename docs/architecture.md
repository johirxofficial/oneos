# Architecture

## Trust boundaries

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ WebView2 (renderer)     │  IPC   │ Rust backend (main process)   │
│ React UI, noVNC         │ ─────► │ tokio, tauri, rusqlite        │
│ no filesystem access    │        │ owns QEMU child processes     │
└───────────┬─────────────┘        └──────────────┬───────────────┘
            │ ws://127.0.0.1:<ws_port>?token=…     │ argv (no shell)
            ▼                                     ▼
┌─────────────────────────┐        ┌──────────────────────────────┐
│ WebSocket ↔ VNC proxy   │◄──────►│ qemu-system-x86_64.exe        │
│ loopback, token check   │  TCP   │ VNC 127.0.0.1:<vnc_port>      │
└─────────────────────────┘        │ QMP 127.0.0.1:<qmp_port>      │
                                   │ QGA 127.0.0.1:<qga_port>      │
                                   └──────────────┬───────────────┘
                                                  │ virtio
                                   ┌──────────────▼───────────────┐
                                   │ Debian guest (XFCE)           │
                                   │ qemu-guest-agent inside       │
                                   └──────────────────────────────┘
```

The renderer never receives a filesystem handle, a process handle or a capability
token for anything except the console WebSocket. Every privileged action is a
typed Tauri command with validated arguments.

## Backend modules

| Module | Responsibility |
| --- | --- |
| `src/main.rs` | Windows subsystem entry point |
| `src/lib.rs` | Tauri builder, state, command registration, exit hook |
| `src/state.rs` | `AppState`: paths, store, host monitor, VM manager, guest agent cache |
| `src/error.rs` | `AppError` with stable categories, serialised to the UI |
| `src/db.rs` | SQLite: VM config row, settings key/value, event log |
| `src/core/paths.rs` | Data root resolution, directory layout, guest path validation |
| `src/system/mod.rs` | Host info, live metrics, WHPX probe, prerequisite report |
| `src/vm/config.rs` | `VmConfig`, static + pre-start validation |
| `src/vm/qemu.rs` | QEMU discovery, OVMF resolution, `qemu-img`, argument builder |
| `src/vm/qmp.rs` | QMP client (JSON over TCP), guest-agent client |
| `src/vm/manager.rs` | Lifecycle, port allocation, handshake, proxy start, state machine |
| `src/network/ws.rs` | Loopback WebSocket↔VNC relay with token authentication |
| `src/commands/mod.rs` | 32 IPC commands |

## Frontend modules

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Phase machine: boot → setup / login → desktop |
| `src/lib/shell.tsx` | Global state: host, settings, VM status, toasts, notifications |
| `src/lib/api.ts` | Typed wrappers for every Tauri command |
| `src/vm/DisplaySession.tsx` | noVNC attach/detach, scaling, Ctrl+Alt+Del, stop |
| `src/windows/*` | Window manager and window chrome |
| `src/desktop/*` | Taskbar, launcher, power menu, notification centre |
| `src/pages/Setup.tsx` | First-run wizard (capability, resources, ISO) |
| `src/terminal/TerminalApp.tsx` | Shell over the guest agent |
| `src/components/FileManager.tsx` | Guest filesystem browser |
| `src/vm/MonitorApp.tsx` | Host + guest telemetry |
| `src/settings/SettingsApp.tsx` | Guest tunables, appearance, logs |

## VM lifecycle

```
stopped ──start()──► starting ──QMP ok──► running
   ▲                    │                  │
   │                    └─QEMU exit─► crashed
   └────────stop()──────────────────────◄──┘
```

`start()`:

1. Validate config statically and against free host memory (operator can force).
2. Resolve QEMU and, when UEFI is on, copy the OVMF vars template into
   `data/virtual-machines/<id>/efi-vars.fd` (once per VM).
3. Create the QCOW2 disk on first start, never overwriting an existing one.
4. Allocate four loopback ports: VNC, QMP, guest agent, SSH forward.
5. Spawn QEMU with an argument vector (`-accel whpx` or TCG, `-machine q35`).
6. Wait 900 ms and detect an immediate crash by reading `qemu-stderr.log`.
7. Connect to QMP, negotiate capabilities, set a 40-character VNC password.
8. Start the WebSocket proxy bound to 127.0.0.1 with that token.
9. Publish `running` plus the console endpoint to the UI via an event.

`stop()` uses QMP `system_powerdown`, waits up to 30 s, then QMP `quit`, waits
up to 8 s, then kills the process. The application exit hook forces a kill so
the QCOW2 image is never left locked.

## Ports and endpoints

| Endpoint | Binding | Protection |
| --- | --- | --- |
| VNC | `127.0.0.1:<random>` | VNC password (QMP `set_password`, 40 chars, 8 used by RFB) |
| QMP | `127.0.0.1:<random>` | loopback + random port |
| Guest agent | `127.0.0.1:<random>` | loopback + random port |
| WebSocket proxy | `127.0.0.1:<random>` | `?token=` per session, `Sec-WebSocket-Protocol: binary` |
| SSH forward | `127.0.0.1:2222` (configurable) | guest sshd credentials |

Ports are allocated with `bind(127.0.0.1:0)` and released immediately before use,
so they never collide with a running QEMU instance and never bind to `0.0.0.0`.

## QEMU argument vector

Built in `vm/qemu.rs` with `OsString` items; nothing is concatenated into a shell
string and no user value is interpreted by `cmd.exe`.

```
-name oneos
-machine q35[,accel=whpx] -cpu max -smp N -m M
-display none -vga std
-vnc 127.0.0.1:<port-5900>,password=on
-qmp tcp:127.0.0.1:<qmp>,server=on,wait=off -monitor none
-drive file=<disk.qcow2>,if=none,id=disk0,format=qcow2,cache=writeback,discard=unmap
-device virtio-blk-pci,drive=disk0
[-drive file=<iso>,media=cdrom,readonly=on,if=none,id=cd0 -device ide-cd,drive=cd0,bus=ide.0]
-boot order=d|c,menu=off
[-drive if=pflash,format=raw,unit=0,readonly=on,file=edk2-x86_64-code.fd
 -drive if=pflash,format=raw,unit=1,file=<vm>/efi-vars.fd]
-netdev user,id=net0,hostfwd=tcp:127.0.0.1:<ssh>-:22
-device virtio-net-pci,netdev=net0
-device virtio-serial-pci
-chardev socket,id=qga0,host=127.0.0.1,port=<qga>,server=on,wait=off
-device virtserialport,chardev=qga0,name=org.qemu.guest_agent.0
-usb -device usb-tablet
-rtc base=localtime,driftfix=slew
-serial file:<vm>/console.log
```

Note: QEMU's `-vnc` argument takes a *display number*, not a port; the real port
is `5900 + display`. The builder subtracts 5900 so the allocated port and the
listening port are identical.

## Data layout

```
<data root>
├── resources\qemu\             portable QEMU 11.1 runtime (578 files)
├── resources\installers\       verified installers used to provision the runtime
├── data\oneos.db               SQLite: config, settings, events
├── data\isos\                  installation media
├── data\virtual-machines\<id>\
│   ├── disk.qcow2              guest disk (dynamic)
│   ├── efi-vars.fd             per-VM UEFI variable store
│   ├── console.log             serial console capture
│   └── qemu-stderr.log         QEMU diagnostics
├── logs\                       application logs
├── docs\ reports\              documentation
└── src-tauri\ frontend\        source
```

`ONEOS_HOME` overrides the root. Otherwise: a folder that contains
`resources/` or `data/` next to the executable (installed layout); the source
checkout that contains `package.json` + `scripts/` (dev runs keep the VM in the
checkout, not in `target/`); the executable's own folder (portable); and finally
`%LOCALAPPDATA%\OneOS`.

## Persistence

SQLite (`rusqlite`, bundled) stores:

* `vm_config` – single row JSON document
* `settings` – key/value pairs (`vm.*`, `ui.*`, `boot.splash`, …)
* `events` – append-only log of lifecycle events

The UI reads it through `settings_all` / `vm_config_get` and writes through
`settings_set` / `vm_config_save`. There is no direct database access from the
renderer.
