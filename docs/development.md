# Development

## Layout

```
D:\OneOS
├── frontend\                 React 19 + TypeScript + Vite 7 + Tailwind 3
│   ├── src\                  UI (no privileged code)
│   └── dist\                 production bundle consumed by Tauri
├── src-tauri\                Rust backend (Tauri 2)
│   ├── src\                  modules described in docs/architecture.md
│   ├── icons\                generated from icon-source.png
│   ├── capabilities\         Tauri capability set (core only)
│   └── tauri.conf.json       window, CSP, bundle config
├── resources\qemu\           portable QEMU runtime
├── data\                     SQLite, ISOs, VM disks
├── scripts\                  provisioning + test helpers
├── docs\                     documentation
└── reports\                  audit + test evidence
```

## Commands

```powershell
npm run dev              # vite only (frontend on :1420)
npm run build            # tsc --noEmit && vite build
npm run typecheck        # tsc --noEmit
npm run tauri dev        # full app, debug build, hot reload UI
npm run tauri build      # release exe + NSIS installer
```

From `src-tauri`:

```powershell
cargo check              # fast feedback
cargo clippy --all-targets
cargo fmt
```

## Conventions

* **Rust owns privilege.** New functionality goes through a `#[tauri::command]`
  with a typed payload; the renderer never sees a handle.
* **No shell strings.** Use `Command::args`, never `cmd /c` with interpolation.
* **Validation before action.** Static range checks live in `VmConfig`, runtime
  checks in `validate_for_start`, path checks in `core::paths`.
* **Errors are data.** Return `AppError`; the UI shows `message` verbatim.
* **No `unwrap` in command paths.** `AppResult` all the way to the IPC boundary.
* **The UI stays thin.** A component may poll, format and prompt; it must not
  reimplement a rule the backend already enforces.

## Adding a command

1. Implement the logic in the owning module (e.g. `vm/manager.rs`).
2. Add a thin `#[tauri::command]` in `commands/mod.rs`.
3. Register it in `lib.rs` (`generate_handler!`).
4. Add a typed wrapper in `frontend/src/lib/api.ts`.
5. Extend `docs/architecture.md` if the command changes the trust surface.

## Test helpers

`scripts/` contains the tooling used to produce `reports/test-report.md`:

| Script | Purpose |
| --- | --- |
| `install-qemu-portable.ps1` | verify + extract the QEMU runtime into `resources/qemu` |
| `enable-whpx.ps1` | enable the Windows hypervisor features and report reboot state |
| `screenshot.ps1` | capture the app window from the desktop |
| `window-info.ps1` | move/resize the window and report geometry |
| `cdp.mjs` | drive the WebView2 through the DevTools protocol (eval/screenshot) |

The WebView2 DevTools endpoint is opt-in and only for development:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
.\src-tauri\target\release\oneos.exe
node scripts\cdp.mjs eval "innerWidth"
```

## Debugging the guest

| Symptom | Where to look |
| --- | --- |
| QEMU exits immediately | `data/virtual-machines/<id>/qemu-stderr.log` |
| Guest boots but no console | `data/virtual-machines/<id>/console.log`, then `display_session` |
| Guest agent unreachable | is `qemu-guest-agent` running inside the guest? `systemctl status qemu-guest-agent` |
| Disk locked after a crash | stop the process, then `qemu-img check` on `disk.qcow2` |

## Release checklist

1. `npm run typecheck && cargo clippy -- -D warnings`
2. `npm run tauri build`
3. Launch the release binary, walk the wizard, start/stop the VM twice.
4. Confirm `resources/qemu` version and `data/oneos.db` creation.
5. Update `reports/test-report.md` with what was actually observed.
