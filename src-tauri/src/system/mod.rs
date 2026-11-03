use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Disks, Pid, System};

use crate::core::OneOsPaths;
use crate::error::AppResult;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub name: String,
    pub mount: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// Static description of the host, gathered once at startup.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub host_name: String,
    pub cpu_brand: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub total_memory_mb: u64,
    pub total_swap_mb: u64,
    pub uptime_secs: u64,
    pub disks: Vec<DiskUsage>,
    pub oneos_root: String,
}

impl HostInfo {
    pub fn collect(paths: &OneOsPaths) -> Self {
        let sys = System::new_all();
        let disks = Disks::new_with_refreshed_list();
        let cpu_brand = sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "Unknown CPU".to_string());
        let physical = sys.physical_core_count().unwrap_or(0);

        Self {
            os_name: System::name().unwrap_or_else(|| "Windows".into()),
            os_version: System::os_version().unwrap_or_else(|| "unknown".into()),
            kernel_version: System::kernel_version().unwrap_or_else(|| "unknown".into()),
            host_name: System::host_name().unwrap_or_else(|| "host".into()),
            cpu_brand,
            physical_cores: physical,
            logical_cores: sys.cpus().len(),
            total_memory_mb: sys.total_memory() / (1024 * 1024),
            total_swap_mb: sys.total_swap() / (1024 * 1024),
            uptime_secs: System::uptime(),
            disks: disks
                .iter()
                .map(|d| DiskUsage {
                    name: d.name().to_string_lossy().to_string(),
                    mount: d.mount_point().to_string_lossy().to_string(),
                    total_bytes: d.total_space(),
                    free_bytes: d.available_space(),
                })
                .collect(),
            oneos_root: paths.root.to_string_lossy().to_string(),
        }
    }
}

/// Live host metrics. The `System` handle is reused so CPU deltas are meaningful.
pub struct HostMonitor {
    sys: Mutex<System>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMetrics {
    pub cpu_usage: f32,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub available_memory_mb: u64,
    pub process_cpu: Option<f32>,
    pub process_memory_mb: Option<u64>,
    pub uptime_secs: u64,
}

impl Default for HostMonitor {
    fn default() -> Self {
        let mut sys = System::new_all();
        sys.refresh_cpu_usage();
        Self { sys: Mutex::new(sys) }
    }
}

impl HostMonitor {
    pub fn available_memory_mb(&self) -> u64 {
        let mut sys = match self.sys.lock() {
            Ok(s) => s,
            Err(_) => return 0,
        };
        sys.refresh_memory();
        sys.available_memory() / (1024 * 1024)
    }

    pub fn snapshot(&self, pid: Option<u32>) -> HostMetrics {
        let mut sys = match self.sys.lock() {
            Ok(s) => s,
            Err(_) => {
                return HostMetrics {
                    cpu_usage: 0.0,
                    total_memory_mb: 0,
                    used_memory_mb: 0,
                    available_memory_mb: 0,
                    process_cpu: None,
                    process_memory_mb: None,
                    uptime_secs: System::uptime(),
                }
            }
        };
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let process = pid.and_then(|p| {
            sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(p)]), true);
            sys.process(Pid::from_u32(p)).map(|proc_| {
                (proc_.cpu_usage(), proc_.memory() / (1024 * 1024))
            })
        });
        HostMetrics {
            cpu_usage: sys.global_cpu_usage(),
            total_memory_mb: sys.total_memory() / (1024 * 1024),
            used_memory_mb: sys.used_memory() / (1024 * 1024),
            available_memory_mb: sys.available_memory() / (1024 * 1024),
            process_cpu: process.map(|p| p.0),
            process_memory_mb: process.map(|p| p.1),
            uptime_secs: System::uptime(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccelerationProbe {
    pub whpx_available: bool,
    pub message: String,
}

/// Ask QEMU itself whether WHPX can start a VM. This is the only check that
/// matters: it tests the real code path instead of guessing from a feature flag.
pub fn probe_whpx(exe: &PathBuf) -> AccelerationProbe {
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "-accel",
        "whpx",
        "-machine",
        "q35",
        "-m",
        "64",
        "-display",
        "none",
        "-vga",
        "none",
        "-nodefaults",
        "-S",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(mut child) => {
            std::thread::sleep(Duration::from_millis(1200));
            match child.try_wait() {
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    AccelerationProbe {
                        whpx_available: true,
                        message: "WHPX is available and accepted by QEMU".into(),
                    }
                }
                Ok(Some(status)) => {
                    let mut err = String::new();
                    if let Some(mut stderr) = child.stderr.take() {
                        use std::io::Read;
                        let _ = stderr.read_to_string(&mut err);
                    }
                    AccelerationProbe {
                        whpx_available: false,
                        message: if err.trim().is_empty() {
                            format!("QEMU exited immediately with {status}")
                        } else {
                            err.trim().lines().last().unwrap_or("WHPX unavailable").to_string()
                        },
                    }
                }
                Err(e) => AccelerationProbe {
                    whpx_available: false,
                    message: format!("could not query QEMU process: {e}"),
                },
            }
        }
        Err(e) => AccelerationProbe {
            whpx_available: false,
            message: format!("could not start QEMU: {e}"),
        },
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrereqItem {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub detail: String,
    pub required: bool,
}

/// Everything OneOS needs before it can boot a guest, as a checklist for the UI.
pub fn prereq_report(paths: &OneOsPaths, qemu_exe: Option<&PathBuf>) -> Vec<PrereqItem> {
    let mut items = Vec::new();

    let qemu_ok = qemu_exe.map(|p| p.is_file()).unwrap_or(false);
    items.push(PrereqItem {
        id: "qemu".into(),
        label: "QEMU runtime".into(),
        ok: qemu_ok,
        detail: match qemu_exe {
            Some(p) if qemu_ok => p.to_string_lossy().to_string(),
            _ => "Place a QEMU build in resources/qemu".into(),
        },
        required: true,
    });

    let disk_free = disk_free_gb(&paths.data());
    items.push(PrereqItem {
        id: "storage".into(),
        label: "Free storage for VM data".into(),
        ok: disk_free >= 30.0,
        detail: format!("{disk_free:.1} GB available on the OneOS data volume (30 GB recommended)"),
        required: true,
    });

    let mem = crate::system::HostMonitor::default().available_memory_mb();
    items.push(PrereqItem {
        id: "memory".into(),
        label: "Free host memory".into(),
        ok: mem >= 2300,
        detail: format!("{mem} MB free (2300 MB recommended while Linux runs)"),
        required: true,
    });

    items
}

fn disk_free_gb(path: &std::path::Path) -> f64 {
    let disks = Disks::new_with_refreshed_list();
    let mut best: f64 = 0.0;
    for d in disks.iter() {
        if path.starts_with(d.mount_point()) {
            best = d.available_space() as f64 / 1_073_741_824.0;
        }
    }
    best
}

pub fn vm_console_log(paths: &OneOsPaths, vm_id: &str) -> PathBuf {
    paths.vm_dir(vm_id).join("console.log")
}

/// Fail fast with a clear message instead of letting QEMU print into the void.
pub fn ensure_dir_writable(dir: &std::path::Path) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    let probe = dir.join(".oneos-write-test");
    std::fs::write(&probe, b"ok")?;
    let _ = std::fs::remove_file(probe);
    Ok(())
}
