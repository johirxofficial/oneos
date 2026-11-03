# Dependency report

Versions are the ones actually resolved in this build (`Cargo.lock`,
`frontend/package-lock.json`) on 2026-11-03.

## Application runtime

| Component | Version | Licence | Role |
| --- | --- | --- | --- |
| Rust toolchain | 1.99.1 (MSVC) | MIT/Apache-2.0 | compiler |
| Tauri | 2.12.5 | MIT/Apache-2.0 | window, IPC, bundler |
| WRY / TAO | 0.57.1 / 0.37.2 | MIT/Apache-2.0 | WebView2 host, windowing |
| tokio | 1.54.1 | MIT | async runtime |
| tokio-tungstenite | 0.24 | MIT | WebSocket proxy |
| tungstenite | 0.24 | MIT/Apache-2.0 | WS framing |
| rusqlite | 0.32.1 (bundled SQLite 3.x) | MIT / public domain | persistence |
| serde / serde_json | 1.0.229 / 1.0.154 | MIT/Apache-2.0 | IPC and DB payloads |
| sysinfo | 0.33.1 | MIT | host telemetry |
| thiserror | 2.0.21 | MIT/Apache-2.0 | error types |
| tracing + tracing-subscriber + tracing-appender | 0.1.44 / 0.3.23 / 0.2.5 | MIT | logging |
| uuid | 1.29.0 | Apache-2.0/MIT | VM ids |
| rand | 0.8.8 | MIT/Apache-2.0 | session tokens |
| futures-util | 0.3.34 | MIT/Apache-2.0 | stream adapters |

## Frontend (presentation only, bundled into the executable)

| Component | Version | Licence | Role |
| --- | --- | --- | --- |
| React / React DOM | 19.2 | MIT | UI |
| Vite | 7.3.7 | MIT | bundler (build-time) |
| TypeScript | 5.9 | Apache-2.0 | type checking (build-time) |
| Tailwind CSS | 3.4.17 | MIT | styling (build-time) |
| lucide-react | 0.545 | ISC | icons |
| @novnc/novnc | 1.7.0 | MPL-2.0 | RFB client rendered in the WebView |
| @tauri-apps/api | 2.9 | MIT/Apache-2.0 | IPC bindings |
| @tauri-apps/cli | 2.9 | MIT/Apache-2.0 | build tooling (dev only) |

## External runtime components (not bundled into the installer)

| Component | Version | Licence | Notes |
| --- | --- | --- | --- |
| QEMU for Windows (Stefan Weil build) | 11.1.0 (2026-08-11) | GPL-2.0 | separate executable in `resources/qemu`, SHA-512 verified |
| OVMF / EDK2 firmware | shipped with QEMU (`edk2-x86_64-code.fd`, `edk2-i386-vars.fd`) | BSD-2-Clause | UEFI boot |
| Debian GNU/Linux | 13.7 (trixie) netinst | DFSG-free | guest OS, user supplied |
| WebView2 Runtime | 156.0.4314.58 | proprietary (Microsoft) | preinstalled on Windows 11 |

## Build-only tooling installed on this host

| Tool | Version | Purpose |
| --- | --- | --- |
| MSVC Build Tools 2022 | 14.44.35207 | linker, `mt.exe` |
| Windows SDK | 10.0.26100 | headers, libs, `mt.exe` |
| Node.js | 26.13.0 (portable) | frontend build |
| npm | 11.20.0 | package manager |
| 7-Zip | 26.05 / 23.01 (portable) | archive handling |

## Licence obligations

* **QEMU is GPL-2.0.** It is distributed as a separate executable, invoked as a
  child process, and its source is available from qemu.org. OneOS does not link
  against QEMU libraries.
* **noVNC is MPL-2.0.** It is bundled into the frontend; modifications to its
  files must be published under MPL-2.0 (none were made).
* **WebView2** is redistributed by Microsoft under its own terms.
* **Debian** is not redistributed by OneOS; the user supplies the ISO.

## Supply-chain notes

* QEMU installer: SHA-512 verified against the upstream `.sha512` file before
  extraction.
* Node dependencies: installed from the npm registry with a lockfile; npm 11
  blocks lifecycle scripts by default, `esbuild` was rebuilt explicitly.
* Rust dependencies: `Cargo.lock` is committed; no git dependencies.
