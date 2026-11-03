use serde::{Deserialize, Serialize};

use crate::core::OneOsPaths;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccelMode {
    Whpx,
    Tcg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkMode {
    Nat,
}

/// Everything that defines one virtual machine. Persisted as JSON in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmConfig {
    pub id: String,
    pub name: String,
    pub memory_mb: u64,
    pub cpu_cores: u16,
    pub disk_size_gb: u64,
    pub disk_path: String,
    #[serde(default)]
    pub iso_path: Option<String>,
    pub uefi: bool,
    pub accel: AccelMode,
    pub display_width: u32,
    pub display_height: u32,
    pub network: NetworkMode,
    pub ssh_port: u16,
    #[serde(default)]
    pub install_mode: bool,
}

impl VmConfig {
    pub fn new(paths: &OneOsPaths) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        let disk_path = paths.disk_path(&id).to_string_lossy().to_string();
        Self {
            id,
            name: "OneOS Guest".to_string(),
            memory_mb: 1536,
            cpu_cores: 2,
            disk_size_gb: 25,
            disk_path,
            iso_path: None,
            uefi: true,
            accel: AccelMode::Whpx,
            display_width: 1280,
            display_height: 720,
            network: NetworkMode::Nat,
            ssh_port: 2222,
            install_mode: false,
        }
    }

    /// Static validation that does not depend on the momentary host state.
    pub fn validate_static(&self, paths: &OneOsPaths, host_total_mb: u64) -> AppResult<()> {
        if self.name.trim().is_empty() || self.name.len() > 64 {
            return Err(AppError::validation("VM name must be 1-64 characters"));
        }
        if self.name.chars().any(|c| c.is_control()) {
            return Err(AppError::validation("VM name must not contain control characters"));
        }
        if self.memory_mb < 512 || self.memory_mb > 4096 {
            return Err(AppError::validation("guest memory must be between 512 MB and 4096 MB"));
        }
        let ceiling = (host_total_mb as f64 * 0.6) as u64;
        if self.memory_mb > ceiling {
            return Err(AppError::validation(format!(
                "guest memory {} MB is too high for this host (limit {} MB)",
                self.memory_mb, ceiling
            )));
        }
        if self.cpu_cores == 0 || self.cpu_cores > 4 {
            return Err(AppError::validation("virtual CPU count must be between 1 and 4"));
        }
        if self.disk_size_gb < 8 || self.disk_size_gb > 200 {
            return Err(AppError::validation("virtual disk must be between 8 GB and 200 GB"));
        }
        let disk = std::path::Path::new(&self.disk_path);
        if !disk.starts_with(paths.vms_dir()) {
            return Err(AppError::validation("virtual disk must live inside the OneOS data directory"));
        }
        if self.display_width < 800
            || self.display_width > 2560
            || self.display_height < 600
            || self.display_height > 1440
        {
            return Err(AppError::validation("display size is outside the supported range"));
        }
        if let Some(iso) = &self.iso_path {
            let p = std::path::Path::new(iso);
            if !p.is_file() {
                return Err(AppError::validation(format!("ISO image not found: {iso}")));
            }
        }
        Ok(())
    }

    /// Runtime validation performed immediately before the VM starts.
    ///
    /// `force` is set when the operator explicitly chooses to start anyway after
    /// seeing the memory warning; the disk check always applies.
    pub fn validate_for_start(&self, available_host_mb: u64, force: bool) -> AppResult<()> {
        let reserve = 800;
        let needed = self.memory_mb + reserve;
        if !force && available_host_mb < needed {
            return Err(AppError::validation(format!(
                "not enough free host memory: {} MB available, {} MB required \
                 ({} MB guest + {} MB reserve). Close applications and retry.",
                available_host_mb, needed, self.memory_mb, reserve
            )));
        }
        if !std::path::Path::new(&self.disk_path).is_file() {
            return Err(AppError::validation(
                "virtual disk does not exist yet - run the disk creation step first",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VmState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Crashed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmStatus {
    pub state: VmState,
    pub pid: Option<u32>,
    pub vnc_port: Option<u16>,
    pub ws_port: Option<u16>,
    pub started_at: Option<i64>,
    pub install_mode: bool,
    pub message: String,
}
