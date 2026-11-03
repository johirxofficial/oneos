use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::core::{session, validate_guest_path, OneOsPaths};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::system::{self, AccelerationProbe, HostInfo, HostMetrics, PrereqItem};
use crate::vm::config::{VmConfig, VmStatus};
use crate::vm::qemu::{DiskInfo, QemuInfo, QemuRuntime};
use crate::vm::qmp::{ExecResult, GuestAgent};

// ---------------------------------------------------------------------------
// Host / system
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn host_info(state: State<'_, AppState>) -> HostInfo {
    state.host_info.clone()
}

#[tauri::command]
pub async fn host_metrics(state: State<'_, AppState>) -> AppResult<HostMetrics> {
    let status = state.manager.status().await;
    Ok(state.host.snapshot(status.pid))
}

#[tauri::command]
pub fn check_prerequisites(state: State<'_, AppState>) -> Vec<PrereqItem> {
    let qemu = QemuRuntime::detect(&state.paths).ok().map(|q| q.exe);
    system::prereq_report(&state.paths, qemu.as_ref())
}

#[tauri::command]
pub fn qemu_info(state: State<'_, AppState>) -> AppResult<QemuInfo> {
    let qemu = QemuRuntime::detect(&state.paths)?;
    Ok(qemu.info(&state.paths))
}

#[tauri::command]
pub fn probe_acceleration(state: State<'_, AppState>) -> AppResult<AccelerationProbe> {
    let qemu = QemuRuntime::detect(&state.paths)?;
    Ok(system::probe_whpx(&qemu.exe))
}

// ---------------------------------------------------------------------------
// VM definition and lifecycle
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn vm_config_get(state: State<'_, AppState>) -> AppResult<Option<VmConfig>> {
    state.store.load_vm()
}

/// A fresh, unsaved VM definition with sane defaults for this host.
#[tauri::command]
pub fn vm_config_new(state: State<'_, AppState>) -> VmConfig {
    VmConfig::new(&state.paths)
}

#[tauri::command]
pub async fn vm_config_save(
    state: State<'_, AppState>,
    config: VmConfig,
) -> AppResult<VmConfig> {
    let status = state.manager.status().await;
    if matches!(status.state, crate::vm::config::VmState::Running) {
        return Err(AppError::validation(
            "stop the virtual machine before changing its configuration",
        ));
    }
    config.validate_static(&state.paths, state.host_info.total_memory_mb)?;
    state.store.save_vm(&config)?;
    Ok(config)
}

#[tauri::command]
pub async fn vm_status(state: State<'_, AppState>) -> AppResult<VmStatus> {
    Ok(state.manager.status().await)
}

#[tauri::command]
pub async fn vm_start(
    state: State<'_, AppState>,
    install: Option<bool>,
    force: Option<bool>,
) -> AppResult<VmStatus> {
    let cfg = current_vm(&state)?;
    let status = state.manager.status().await;
    if matches!(status.state, crate::vm::config::VmState::Running) {
        return Err(AppError::validation("the virtual machine is already running"));
    }
    // A previous guest-agent connection belongs to the previous QEMU process.
    *state.guest.lock().await = None;
    state
        .manager
        .start(&cfg, install.unwrap_or(cfg.install_mode), force.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn vm_stop(state: State<'_, AppState>) -> AppResult<VmStatus> {
    *state.guest.lock().await = None;
    state.manager.stop().await
}

#[tauri::command]
pub async fn vm_restart(state: State<'_, AppState>) -> AppResult<VmStatus> {
    let cfg = current_vm(&state)?;
    state.manager.restart(&cfg).await
}

#[tauri::command]
pub async fn vm_disk_create(state: State<'_, AppState>) -> AppResult<DiskInfo> {
    let cfg = current_vm(&state)?;
    let qemu = QemuRuntime::detect(&state.paths)?;
    let disk = PathBuf::from(&cfg.disk_path);
    if !disk.is_file() {
        qemu.create_disk(&disk, cfg.disk_size_gb)?;
    }
    qemu.disk_info(&disk)
}

#[tauri::command]
pub async fn vm_disk_info(state: State<'_, AppState>) -> AppResult<DiskInfo> {
    let cfg = current_vm(&state)?;
    let qemu = QemuRuntime::detect(&state.paths)?;
    qemu.disk_info(&PathBuf::from(&cfg.disk_path))
}

#[tauri::command]
pub async fn display_session(
    state: State<'_, AppState>,
) -> AppResult<crate::vm::manager::DisplaySession> {
    state.manager.display_session().await
}

// ---------------------------------------------------------------------------
// Guest agent: real commands and real files inside the Linux guest
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestStatus {
    pub connected: bool,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub kernel: Option<String>,
    pub hostname: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64,
}

#[tauri::command]
pub async fn guest_status(state: State<'_, AppState>) -> AppResult<GuestStatus> {
    let cfg = match current_vm(&state) {
        Ok(c) => c,
        Err(e) => {
            return Ok(GuestStatus {
                connected: false,
                os_name: None,
                os_version: None,
                kernel: None,
                hostname: None,
                message: e.to_string(),
            })
        }
    };

    let mut guard = match connect_guest(&state, &cfg.id).await {
        Ok(g) => g,
        Err(e) => {
            return Ok(GuestStatus {
                connected: false,
                os_name: None,
                os_version: None,
                kernel: None,
                hostname: None,
                message: e.to_string(),
            })
        }
    };

    let agent = guard.as_mut().expect("guest agent present");
    match agent.call("guest-get-osinfo", None).await {
        Ok(v) => {
            let get = |k: &str| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string());
            Ok(GuestStatus {
                connected: true,
                os_name: get("name"),
                os_version: get("pretty-name").or_else(|| get("version")),
                kernel: get("kernel-release"),
                hostname: get("hostname"),
                message: "guest agent connected".into(),
            })
        }
        Err(e) => {
            *guard = None;
            Ok(GuestStatus {
                connected: false,
                os_name: None,
                os_version: None,
                kernel: None,
                hostname: None,
                message: e.to_string(),
            })
        }
    }
}

#[tauri::command]
pub async fn guest_exec(
    state: State<'_, AppState>,
    command: String,
    cwd: Option<String>,
) -> AppResult<ExecResult> {
    if command.trim().is_empty() {
        return Err(AppError::validation("command must not be empty"));
    }
    if command.len() > 8000 {
        return Err(AppError::validation("command is too long"));
    }
    let cfg = current_vm(&state)?;
    let dir = cwd.unwrap_or_else(|| "/root".to_string());
    validate_guest_path(&dir)?;

    let script = format!(
        "cd {} 2>/dev/null || cd /; {}",
        sh_quote(&dir),
        command
    );

    let mut guard = connect_guest(&state, &cfg.id).await?;
    let first = {
        let agent = guard.as_mut().expect("guest agent present");
        agent.exec(&script, Duration::from_secs(120)).await
    };
    if first.is_ok() {
        return first;
    }
    // A call that timed out leaves its reply queued; guest-sync flushes it so
    // the retry reads its own answer instead of the stale one.
    let resynced = {
        let agent = guard.as_mut().expect("guest agent present");
        agent
            .resync(rand::random::<u64>() % 1_000_000)
            .await
            .is_ok()
    };
    let second = if resynced {
        let agent = guard.as_mut().expect("guest agent present");
        agent.exec(&script, Duration::from_secs(120)).await
    } else {
        *guard = None;
        drop(guard);
        let mut fresh = connect_guest(&state, &cfg.id).await?;
        let retry = {
            let agent = fresh.as_mut().expect("guest agent present");
            agent.exec(&script, Duration::from_secs(120)).await
        };
        if retry.is_err() {
            *fresh = None;
        }
        return retry;
    };
    if second.is_err() {
        *guard = None;
    }
    second
}

#[tauri::command]
pub async fn guest_list_dir(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    validate_guest_path(&path)?;
    let cfg = current_vm(&state)?;
    let script = format!(
        "find {} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null",
        sh_quote(&path)
    );
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let out = match agent.exec(&script, Duration::from_secs(30)).await {
        Ok(o) => o,
        Err(e) => {
            *guard = None;
            return Err(e);
        }
    };
    if out.exit_code != 0 && out.stdout.trim().is_empty() {
        return Err(AppError::guest(if out.stderr.trim().is_empty() {
            "could not list the directory".to_string()
        } else {
            out.stderr.trim().to_string()
        }));
    }

    let mut entries = Vec::new();
    for line in out.stdout.lines() {
        let mut parts = line.splitn(4, '\t');
        let kind = parts.next().unwrap_or("");
        let size = parts.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        let modified = parts
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .map(|f| f as i64)
            .unwrap_or(0);
        let name = parts.next().unwrap_or("").to_string();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let full = if path == "/" {
            format!("/{name}")
        } else {
            format!("{}/{}", path.trim_end_matches('/'), name)
        };
        entries.push(FileEntry {
            name,
            path: full,
            is_dir: kind == "d",
            size,
            modified,
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[tauri::command]
pub async fn guest_mkdir(state: State<'_, AppState>, path: String) -> AppResult<()> {
    validate_guest_path(&path)?;
    let cfg = current_vm(&state)?;
    let script = format!("mkdir -p {}", sh_quote(&path));
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let out = agent.exec(&script, Duration::from_secs(30)).await?;
    if out.exit_code != 0 {
        return Err(AppError::guest(trim_err(&out)));
    }
    Ok(())
}

#[tauri::command]
pub async fn guest_rename(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> AppResult<()> {
    validate_guest_path(&from)?;
    validate_guest_path(&to)?;
    let cfg = current_vm(&state)?;
    let script = format!("mv -n {} {}", sh_quote(&from), sh_quote(&to));
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let out = agent.exec(&script, Duration::from_secs(30)).await?;
    if out.exit_code != 0 {
        return Err(AppError::guest(trim_err(&out)));
    }
    Ok(())
}

#[tauri::command]
pub async fn guest_remove(state: State<'_, AppState>, path: String) -> AppResult<()> {
    validate_guest_path(&path)?;
    if path == "/" || path == "/root" || path == "/home" {
        return Err(AppError::validation("refusing to delete a protected directory"));
    }
    if path.matches('/').count() < 2 {
        return Err(AppError::validation("refusing to delete a top-level directory"));
    }
    let cfg = current_vm(&state)?;
    let script = format!("rm -rf -- {}", sh_quote(&path));
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let out = agent.exec(&script, Duration::from_secs(30)).await?;
    if out.exit_code != 0 {
        return Err(AppError::guest(trim_err(&out)));
    }
    Ok(())
}

#[tauri::command]
pub async fn guest_read_text(
    state: State<'_, AppState>,
    path: String,
    max_bytes: Option<usize>,
) -> AppResult<String> {
    validate_guest_path(&path)?;
    let limit = max_bytes.unwrap_or(512 * 1024).clamp(1, 8 * 1024 * 1024);
    let cfg = current_vm(&state)?;
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let result = read_guest_bytes(agent, &path, limit).await;
    if result.is_err() {
        *guard = None;
    }
    let bytes = result?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub async fn guest_write_text(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> AppResult<()> {
    validate_guest_path(&path)?;
    if content.len() > 8 * 1024 * 1024 {
        return Err(AppError::validation("file is too large for the text editor"));
    }
    let cfg = current_vm(&state)?;
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let result = write_guest_bytes(agent, &path, content.as_bytes()).await;
    if result.is_err() {
        *guard = None;
    }
    result
}

/// Copy a Windows file into the guest. The host side is read-only.
#[tauri::command]
pub async fn guest_import_file(
    state: State<'_, AppState>,
    host_path: String,
    guest_path: String,
) -> AppResult<u64> {
    validate_guest_path(&guest_path)?;
    let host = std::path::Path::new(&host_path);
    if !host.is_file() {
        return Err(AppError::validation("host file does not exist"));
    }
    let meta = std::fs::metadata(host)?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err(AppError::validation("file is larger than the 64 MB import limit"));
    }
    let bytes = std::fs::read(host)?;
    let cfg = current_vm(&state)?;
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let result = write_guest_bytes(agent, &guest_path, &bytes).await;
    if result.is_err() {
        *guard = None;
    }
    result?;
    Ok(meta.len())
}

/// Copy a guest file out to the OneOS exports directory (never arbitrary host paths).
#[tauri::command]
pub async fn guest_export_file(
    state: State<'_, AppState>,
    guest_path: String,
    file_name: String,
) -> AppResult<String> {
    validate_guest_path(&guest_path)?;
    let safe_name: String = file_name
        .chars()
        .map(|c| if c.is_alphanumeric() || "._- ".contains(c) { c } else { '_' })
        .collect();
    if safe_name.trim().is_empty() {
        return Err(AppError::validation("invalid file name"));
    }
    let exports = state.paths.data().join("exports");
    std::fs::create_dir_all(&exports)?;
    let dest = exports.join(&safe_name);

    let cfg = current_vm(&state)?;
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let result = read_guest_bytes(agent, &guest_path, 64 * 1024 * 1024).await;
    if result.is_err() {
        *guard = None;
    }
    let bytes = result?;
    std::fs::write(&dest, bytes)?;
    Ok(dest.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Settings and logs
// ---------------------------------------------------------------------------

const SETTING_KEYS: [&str; 10] = [
    "theme",
    "wallpaper",
    "accent",
    "startup.behavior",
    "shutdown.behavior",
    "boot.splash",
    "display.width",
    "display.height",
    "vm.memory_mb",
    "vm.cpu_cores",
];

#[tauri::command]
pub async fn settings_all(
    state: State<'_, AppState>,
) -> AppResult<std::collections::BTreeMap<String, String>> {
    state.store.settings_all()
}

#[tauri::command]
pub async fn settings_set(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err(AppError::validation(format!("unknown setting: {key}")));
    }
    if value.len() > 512 {
        return Err(AppError::validation("setting value is too long"));
    }
    state.store.setting_set(&key, &value)
}

#[tauri::command]
pub fn logs_tail(state: State<'_, AppState>, vm_id: String, lines: Option<usize>) -> AppResult<String> {
    let n = lines.unwrap_or(200).clamp(1, 2000);
    let path = state.paths.vm_dir(&vm_id).join("console.log");
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    let collected: Vec<&str> = data.lines().rev().take(n).collect();
    let mut out: Vec<&str> = collected.into_iter().collect();
    out.reverse();
    Ok(out.join("\n"))
}

#[tauri::command]
pub fn app_paths(state: State<'_, AppState>) -> OneOsPathsView {
    OneOsPathsView {
        root: state.paths.root.to_string_lossy().to_string(),
        vms: state.paths.vms_dir().to_string_lossy().to_string(),
        isos: state.paths.isos_dir().to_string_lossy().to_string(),
        exports: state.paths.data().join("exports").to_string_lossy().to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneOsPathsView {
    pub root: String,
    pub vms: String,
    pub isos: String,
    pub exports: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn current_vm(state: &State<'_, AppState>) -> AppResult<VmConfig> {
    state
        .store
        .load_vm()?
        .ok_or_else(|| AppError::NotFound("no virtual machine has been configured yet".into()))
}

async fn connect_guest<'a>(
    state: &'a State<'_, AppState>,
    _vm_id: &str,
) -> AppResult<tokio::sync::MutexGuard<'a, Option<GuestAgent>>> {
    let mut guard = state.guest.lock().await;
    if guard.is_none() {
        let port = state
            .manager
            .guest_agent_port()
            .await
            .ok_or_else(|| AppError::guest("the guest agent is only reachable while the VM runs"))?;
        *guard = Some(GuestAgent::connect(port, Duration::from_secs(4)).await?);
    }
    Ok(guard)
}

async fn read_guest_bytes(agent: &mut GuestAgent, path: &str, limit: usize) -> AppResult<Vec<u8>> {
    let handle = agent.file_open(path, "rb").await?;
    let mut out = Vec::new();
    loop {
        let (chunk, eof) = match agent.file_read(handle, 512 * 1024).await {
            Ok(v) => v,
            Err(e) => {
                let _ = agent.file_close(handle).await;
                return Err(e);
            }
        };
        out.extend_from_slice(&chunk);
        if eof || out.len() >= limit {
            break;
        }
    }
    let _ = agent.file_close(handle).await;
    out.truncate(limit);
    Ok(out)
}

async fn write_guest_bytes(agent: &mut GuestAgent, path: &str, bytes: &[u8]) -> AppResult<()> {
    let handle = agent.file_open(path, "wb").await?;
    let mut written = 0usize;
    while written < bytes.len() {
        let end = (written + 512 * 1024).min(bytes.len());
        match agent.file_write(handle, &bytes[written..end]).await {
            Ok(n) if n > 0 => written += n,
            Ok(_) => {
                let _ = agent.file_close(handle).await;
                return Err(AppError::guest("guest file write made no progress"));
            }
            Err(e) => {
                let _ = agent.file_close(handle).await;
                return Err(e);
            }
        }
    }
    agent.file_close(handle).await?;
    Ok(())
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn trim_err(out: &ExecResult) -> String {
    let msg = if out.stderr.trim().is_empty() {
        out.stdout.trim().to_string()
    } else {
        out.stderr.trim().to_string()
    };
    if msg.is_empty() {
        format!("command failed with exit code {}", out.exit_code)
    } else {
        msg
    }
}

/// Helper used by the setup wizard to point at the default ISO folder.
#[tauri::command]
pub fn default_iso_dir(state: State<'_, AppState>) -> String {
    let _ = OneOsPaths::resolve();
    state.paths.isos_dir().to_string_lossy().to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsoFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/// List installation images already placed in the OneOS ISO folder.
#[tauri::command]
pub fn list_isos(state: State<'_, AppState>) -> Vec<IsoFile> {
    let dir = state.paths.isos_dir();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_iso = path
                .extension()
                .map(|ext| ext.eq_ignore_ascii_case("iso"))
                .unwrap_or(false);
            if !is_iso {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                out.push(IsoFile {
                    name: path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    path: path.to_string_lossy().to_string(),
                    size: meta.len(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Write raw bytes (base64 encoded by the webview) into the guest.
#[tauri::command]
pub async fn guest_write_base64(
    state: State<'_, AppState>,
    path: String,
    data: String,
) -> AppResult<u64> {
    validate_guest_path(&path)?;
    let bytes = crate::vm::qmp::base64_decode(&data)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(AppError::validation("file is larger than the 64 MB import limit"));
    }
    let cfg = current_vm(&state)?;
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let agent = guard.as_mut().expect("guest agent present");
    let result = write_guest_bytes(agent, &path, &bytes).await;
    if result.is_err() {
        *guard = None;
    }
    result?;
    Ok(bytes.len() as u64)
}

// ---------------------------------------------------------------------------
// Session identity, screen lock and app installation
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn session_info(state: State<'_, AppState>) -> AppResult<session::SessionInfo> {
    session::info(&state.store)
}

#[tauri::command]
pub fn session_set_user(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<session::SessionInfo> {
    session::set_user(&state.store, &name)
}

#[tauri::command]
pub fn session_set_pin(
    state: State<'_, AppState>,
    current: Option<String>,
    pin: Option<String>,
) -> AppResult<session::SessionInfo> {
    session::set_pin(&state.store, current.as_deref(), pin.as_deref())
}

#[tauri::command]
pub fn session_set_lock_on_start(
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<session::SessionInfo> {
    session::set_lock_on_start(&state.store, enabled)
}

#[tauri::command]
pub fn session_unlock(state: State<'_, AppState>, pin: String) -> AppResult<bool> {
    session::verify(&state.store, &pin)
}

/// One fixed command per catalogue entry: the webview can only ask for an id,
/// never for a shell string, so nothing user controlled reaches the guest shell.
const LINUX_APPS: &[(&str, &str)] = &[
    (
        "chrome",
        "set -e\n\
         export DEBIAN_FRONTEND=noninteractive\n\
         apt-get update\n\
         apt-get install -y wget gnupg ca-certificates\n\
         install -d -m 0755 /etc/apt/keyrings\n\
         wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/keyrings/google-chrome.gpg\n\
         echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list\n\
         apt-get update\n\
         apt-get install -y google-chrome-stable",
    ),
    ("firefox", "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y firefox-esr"),
    ("chromium", "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y chromium"),
    ("vlc", "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y vlc"),
    ("libreoffice", "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y libreoffice"),
    ("gimp", "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y gimp"),
    ("flatpak", "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y flatpak && flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo"),
];

#[tauri::command]
pub async fn linux_app_install(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<ExecResult> {
    let script = LINUX_APPS
        .iter()
        .find(|(app, _)| *app == id)
        .map(|(_, cmd)| *cmd)
        .ok_or_else(|| AppError::validation("unknown application id"))?;
    let cfg = current_vm(&state)?;
    let mut guard = connect_guest(&state, &cfg.id).await?;
    let first = {
        let agent = guard.as_mut().expect("guest agent present");
        agent.exec(script, Duration::from_secs(1800)).await
    };
    if first.is_ok() {
        return first;
    }
    // guest-sync flushes the reply a timed-out call left queued.
    let resynced = {
        let agent = guard.as_mut().expect("guest agent present");
        agent
            .resync(rand::random::<u64>() % 1_000_000)
            .await
            .is_ok()
    };
    let second = if resynced {
        let agent = guard.as_mut().expect("guest agent present");
        agent.exec(script, Duration::from_secs(1800)).await
    } else {
        *guard = None;
        drop(guard);
        let mut fresh = connect_guest(&state, &cfg.id).await?;
        let retry = {
            let agent = fresh.as_mut().expect("guest agent present");
            agent.exec(script, Duration::from_secs(1800)).await
        };
        if retry.is_err() {
            *fresh = None;
        }
        return retry;
    };
    if second.is_err() {
        *guard = None;
    }
    second
}

/// Open a download page in the host browser. Only http(s) URLs are accepted and
/// the URL is passed as a separate argument, never through a shell.
#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::validation("only http and https links can be opened"));
    }
    if url.len() > 2048 || url.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'') {
        return Err(AppError::validation("the link contains unsupported characters"));
    }
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("could not open the browser: {e}")))?;
    }
    Ok(())
}
