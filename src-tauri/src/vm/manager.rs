use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};

use crate::core::OneOsPaths;
use crate::db::{now_ts, Store};
use crate::error::{AppError, AppResult};
use crate::network::ws;
use crate::system::HostMonitor;
use crate::vm::config::{AccelMode, VmConfig, VmState, VmStatus};
use crate::vm::qemu::{build_args, QemuRuntime, RunPlan};
use crate::vm::qmp::QmpClient;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const EVENT_VM_STATUS: &str = "oneos://vm-status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySession {
    pub ws_url: String,
    pub vnc_port: u16,
    pub ws_port: u16,
    pub token: String,
}

struct Inner {
    child: Option<Child>,
    state: VmState,
    pid: Option<u32>,
    vnc_port: Option<u16>,
    qmp_port: Option<u16>,
    ws_port: Option<u16>,
    guest_agent_port: Option<u16>,
    token: Option<String>,
    started_at: Option<i64>,
    install_mode: bool,
    message: String,
    efi_vars: Option<PathBuf>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            child: None,
            state: VmState::Stopped,
            pid: None,
            vnc_port: None,
            qmp_port: None,
            ws_port: None,
            guest_agent_port: None,
            token: None,
            started_at: None,
            install_mode: false,
            message: String::new(),
            efi_vars: None,
        }
    }
}

pub struct VmManager {
    paths: OneOsPaths,
    store: Arc<Store>,
    host: HostMonitor,
    inner: tokio::sync::Mutex<Inner>,
    app: AppHandle,
}

impl VmManager {
    pub fn new(app: AppHandle, paths: OneOsPaths, store: Arc<Store>) -> Self {
        Self {
            paths,
            store,
            host: HostMonitor::default(),
            inner: tokio::sync::Mutex::new(Inner::default()),
            app,
        }
    }

    pub fn paths(&self) -> &OneOsPaths {
        &self.paths
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }

    async fn emit_status(&self, status: &VmStatus) {
        let _ = self.app.emit(EVENT_VM_STATUS, status);
    }

    fn refresh_state(inner: &mut Inner) {
        if let Some(child) = inner.child.as_mut() {
            match child.try_wait() {
                Ok(None) => {}
                Ok(Some(exit)) => {
                    inner.child = None;
                    inner.pid = None;
                    if inner.state != VmState::Stopping && inner.state != VmState::Stopped {
                        inner.state = VmState::Crashed;
                        inner.message = format!("QEMU exited unexpectedly ({exit})");
                    }
                }
                Err(_) => {}
            }
        }
    }

    fn status_of(inner: &Inner) -> VmStatus {
        VmStatus {
            state: inner.state.clone(),
            pid: inner.pid,
            vnc_port: inner.vnc_port,
            ws_port: inner.ws_port,
            started_at: inner.started_at,
            install_mode: inner.install_mode,
            message: inner.message.clone(),
        }
    }

    pub async fn status(&self) -> VmStatus {
        let mut inner = self.inner.lock().await;
        Self::refresh_state(&mut inner);
        Self::status_of(&inner)
    }

    /// Loopback port of the guest-agent channel, available while a VM is running.
    pub async fn guest_agent_port(&self) -> Option<u16> {
        let inner = self.inner.lock().await;
        if matches!(inner.state, VmState::Running) {
            inner.guest_agent_port
        } else {
            None
        }
    }

    pub async fn display_session(&self) -> AppResult<DisplaySession> {        let inner = self.inner.lock().await;
        match (inner.ws_port, inner.vnc_port, inner.token.clone(), &inner.state) {
            (Some(ws_port), Some(vnc_port), Some(token), VmState::Running) => Ok(DisplaySession {
                ws_url: format!("ws://127.0.0.1:{ws_port}/websocket?token={token}"),
                vnc_port,
                ws_port,
                token,
            }),
            _ => Err(AppError::validation("the virtual machine is not running")),
        }
    }

    pub async fn start(&self, cfg: &VmConfig, install_mode: bool, force: bool) -> AppResult<VmStatus> {
        let mut inner = self.inner.lock().await;
        Self::refresh_state(&mut inner);
        if inner.child.is_some() && matches!(inner.state, VmState::Running | VmState::Starting) {
            return Err(AppError::validation("the virtual machine is already running"));
        }

        let available = self.host.available_memory_mb();
        cfg.validate_for_start(available, force)?;

        let qemu = QemuRuntime::detect(&self.paths)?;
        if cfg.accel == AccelMode::Whpx && !qemu.whpx_supported() {
            return Err(AppError::validation(
                "this QEMU build does not support WHPX acceleration",
            ));
        }

        let vm_dir = self.paths.vm_dir(&cfg.id);
        std::fs::create_dir_all(&vm_dir)?;

        // First install: create the disk on demand, but never overwrite one.
        let disk = PathBuf::from(&cfg.disk_path);
        if !disk.is_file() {
            if cfg.iso_path.is_none() {
                return Err(AppError::validation(
                    "no virtual disk and no installation ISO selected",
                ));
            }
            qemu.create_disk(&disk, cfg.disk_size_gb)?;
        }

        let efi_vars = if cfg.uefi {
            match qemu.firmware(&self.paths) {
                Some((_, template)) => {
                    let dest = vm_dir.join("efi-vars.fd");
                    if !dest.exists() {
                        std::fs::copy(&template, &dest).map_err(|e| {
                            AppError::internal(format!("could not prepare UEFI variables: {e}"))
                        })?;
                    }
                    Some(dest)
                }
                None => {
                    return Err(AppError::validation(
                        "UEFI boot requested but no OVMF firmware was found",
                    ))
                }
            }
        } else {
            None
        };

        let vnc_port = free_loopback_port()?;
        let qmp_port = free_loopback_port()?;
        let ssh_port = if cfg.ssh_port != 0 && port_is_free(cfg.ssh_port) {
            cfg.ssh_port
        } else {
            free_loopback_port()?
        };

        let plan = RunPlan {
            vnc_port,
            qmp_port,
            ssh_port,
            guest_agent_port: free_loopback_port()?,
            serial_log: vm_dir.join("console.log"),
            efi_vars: efi_vars.clone(),
        };

        // The install flag can be overridden per start (the wizard boots the ISO
        // once) without rewriting the stored configuration.
        let mut effective = cfg.clone();
        effective.install_mode = install_mode;
        let args = build_args(&qemu, &self.paths, &effective, &plan)?;

        inner.state = VmState::Starting;
        inner.message = "starting QEMU".into();
        inner.install_mode = install_mode;
        inner.vnc_port = Some(vnc_port);
        inner.qmp_port = Some(qmp_port);
        inner.ws_port = None;
        inner.guest_agent_port = Some(plan.guest_agent_port);
        inner.token = None;
        inner.started_at = Some(now_ts());
        self.emit_status(&Self::status_of(&inner)).await;

        let stderr_path = vm_dir.join("qemu-stderr.log");
        let stderr_file = std::fs::File::create(&stderr_path)?;

        // QEMU searches for its keymap files relative to the working directory.
        // When the app is itself started from C:\Windows\System32 (for example
        // by a scheduled task or a WMI launch) QEMU finds that directory's
        // `en-us` MUI *folder*, fails to open it as a file and aborts with
        // "Could not open 'en-us': Permission denied". Run QEMU from the VM
        // directory, which only ever contains files we created.
        let _ = std::fs::write(
            vm_dir.join("qemu-args.log"),
            args.iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("\n"),
        );

        let mut command = Command::new(&qemu.exe);
        command
            .args(&args)
            .current_dir(&vm_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(stderr_file))
            .kill_on_drop(false);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let child = command.spawn().map_err(|e| {
            AppError::internal(format!("could not start QEMU ({}): {e}", qemu.exe.display()))
        })?;

        let pid = child.id();
        inner.child = Some(child);
        inner.pid = pid;

        // Give QEMU a moment to fail fast on invalid arguments.
        tokio::time::sleep(Duration::from_millis(900)).await;
        Self::refresh_state(&mut inner);
        if matches!(inner.state, VmState::Crashed) {
            let tail = read_tail(&stderr_path, 4000);
            inner.message = if tail.trim().is_empty() {
                "QEMU exited during startup".to_string()
            } else {
                format!("QEMU failed to start: {}", tail.trim())
            };
            let status = Self::status_of(&inner);
            self.emit_status(&status).await;
            return Err(AppError::internal(inner.message.clone()));
        }

        // Handshake and lock the VNC console with a session password. If this
        // fails the console would stay unusable, so the start is aborted instead
        // of reporting a "running" VM nobody can reach.
        let token: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(40)
            .map(char::from)
            .collect();

        let mut failure: Option<String> = None;
        match QmpClient::connect(qmp_port, Duration::from_secs(15)).await {
            Ok(mut qmp) => {
                if let Err(e) = qmp.handshake().await {
                    failure = Some(format!("QMP handshake failed: {e}"));
                } else if let Err(e) = qmp.set_vnc_password(&token).await {
                    failure = Some(format!("could not secure the console: {e}"));
                }
            }
            Err(e) => failure = Some(e.to_string()),
        }
        if let Some(message) = failure {
            if let Some(child) = inner.child.as_mut() {
                let _ = child.kill();
            }
            inner.child = None;
            inner.pid = None;
            inner.state = VmState::Crashed;
            inner.message = message.clone();
            let status = Self::status_of(&inner);
            self.emit_status(&status).await;
            return Err(AppError::internal(message));
        }

        let ws_port = ws::start_proxy(vnc_port, token.clone()).await?;

        inner.ws_port = Some(ws_port);
        inner.token = Some(token);
        inner.state = VmState::Running;
        inner.message = if inner.message.is_empty() {
            "running".to_string()
        } else {
            format!("running ({})", inner.message)
        };

        let status = Self::status_of(&inner);
        drop(inner);
        let _ = self.store.log_event("info", "vm", "virtual machine started");
        self.emit_status(&status).await;
        Ok(status)
    }

    pub async fn stop(&self) -> AppResult<VmStatus> {
        let mut inner = self.inner.lock().await;
        if inner.child.is_none() {
            inner.state = VmState::Stopped;
            inner.message = "not running".into();
            return Ok(Self::status_of(&inner));
        }

        inner.state = VmState::Stopping;
        inner.message = "requesting graceful shutdown".into();
        self.emit_status(&Self::status_of(&inner)).await;

        if let Some(qmp_port) = inner.qmp_port {
            if let Ok(mut qmp) = QmpClient::connect(qmp_port, Duration::from_secs(3)).await {
                if qmp.handshake().await.is_ok() {
                    let _ = qmp.powerdown().await;
                }
            }
        }

        // Wait up to 30 seconds for the guest to shut down cleanly.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        loop {
            Self::refresh_state(&mut inner);
            if inner.child.is_none() {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }

        if inner.child.is_some() {
            inner.message = "graceful shutdown timed out, forcing quit".into();
            if let Some(qmp_port) = inner.qmp_port {
                if let Ok(mut qmp) = QmpClient::connect(qmp_port, Duration::from_secs(3)).await {
                    if qmp.handshake().await.is_ok() {
                        let _ = qmp.quit().await;
                    }
                }
            }
            let quit_deadline = tokio::time::Instant::now() + Duration::from_secs(8);
            while tokio::time::Instant::now() < quit_deadline {
                Self::refresh_state(&mut inner);
                if inner.child.is_none() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }

        if let Some(child) = inner.child.as_mut() {
            let _ = child.kill().await;
            let _ = child.wait().await;
            inner.child = None;
        }

        inner.state = VmState::Stopped;
        inner.pid = None;
        inner.message = "stopped".into();
        inner.vnc_port = None;
        inner.qmp_port = None;
        inner.ws_port = None;
        inner.guest_agent_port = None;
        inner.token = None;
        inner.started_at = None;

        let status = Self::status_of(&inner);
        drop(inner);
        let _ = self.store.log_event("info", "vm", "virtual machine stopped");
        self.emit_status(&status).await;
        Ok(status)
    }

    pub async fn restart(&self, cfg: &VmConfig) -> AppResult<VmStatus> {
        let install = { self.inner.lock().await.install_mode };
        self.stop().await?;
        tokio::time::sleep(Duration::from_millis(700)).await;
        self.start(cfg, install, true).await
    }

    /// Force-stop without waiting, used on application exit.
    pub async fn shutdown_blocking(&self) {
        let mut inner = self.inner.lock().await;
        if let Some(child) = inner.child.as_mut() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        inner.child = None;
        inner.state = VmState::Stopped;
        inner.pid = None;
    }
}

fn free_loopback_port() -> AppResult<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn port_is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn read_tail(path: &std::path::Path, max_bytes: usize) -> String {
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(_) => return String::new(),
    };
    let start = data.len().saturating_sub(max_bytes);
    String::from_utf8_lossy(&data[start..]).to_string()
}
