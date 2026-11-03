use std::path::{Path, PathBuf};

/// Resolved locations used by the application.
///
/// Layout (all outside the build output):
///   <root>/resources/qemu        bundled/portable QEMU runtime
///   <root>/resources/firmware    OVMF firmware files
///   <root>/data/virtual-machines VM directories and QCOW2 disks
///   <root>/data/isos             guest installation media
///   <root>/logs                  application logs
#[derive(Debug, Clone)]
pub struct OneOsPaths {
    pub root: PathBuf,
}

impl OneOsPaths {
    pub fn resolve() -> Self {
        // Explicit override wins, which keeps tests and portable installs predictable.
        if let Ok(home) = std::env::var("ONEOS_HOME") {
            if !home.trim().is_empty() {
                return Self { root: PathBuf::from(home) };
            }
        }
        // Installed layout: OneOS.exe sits next to `resources/` and `data/`.
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if dir.join("resources").is_dir() || dir.join("data").is_dir() {
                    return Self { root: dir.to_path_buf() };
                }
            }
        }
        // Source checkout (dev run or `cargo build` inside the repo): keep the
        // VM, ISOs and logs with the checkout instead of inside `target/`.
        if let Ok(exe) = std::env::current_exe() {
            let mut dir = exe.parent();
            while let Some(d) = dir {
                if d.join("package.json").is_file() && d.join("scripts").is_dir() {
                    return Self {
                        root: d.to_path_buf(),
                    };
                }
                dir = d.parent();
            }
        }
        // Portable: everything lives next to the executable.
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                return Self { root: dir.to_path_buf() };
            }
        }
        // Last resort: per-user application data.
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        Self {
            root: base.join("OneOS"),
        }
    }

    pub fn resources(&self) -> PathBuf {
        self.root.join("resources")
    }

    pub fn qemu_dir(&self) -> PathBuf {
        self.resources().join("qemu")
    }

    pub fn firmware_dir(&self) -> PathBuf {
        self.resources().join("firmware")
    }

    pub fn data(&self) -> PathBuf {
        self.root.join("data")
    }

    pub fn vms_dir(&self) -> PathBuf {
        self.data().join("virtual-machines")
    }

    pub fn isos_dir(&self) -> PathBuf {
        self.data().join("isos")
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.root.join("logs")
    }

    /// WebView2 profile. Kept next to the rest of the data so the user's system
    /// drive never grows because of OneOS.
    pub fn webview_dir(&self) -> PathBuf {
        self.data().join("webview")
    }

    pub fn db_path(&self) -> PathBuf {
        self.data().join("oneos.db")
    }

    pub fn vm_dir(&self, vm_id: &str) -> PathBuf {
        self.vms_dir().join(vm_id)
    }

    pub fn disk_path(&self, vm_id: &str) -> PathBuf {
        self.vm_dir(vm_id).join("disk.qcow2")
    }

    pub fn ensure_all(&self) -> std::io::Result<()> {
        for dir in [
            self.resources(),
            self.qemu_dir(),
            self.firmware_dir(),
            self.data(),
            self.vms_dir(),
            self.isos_dir(),
            self.logs_dir(),
            self.webview_dir(),
        ] {
            std::fs::create_dir_all(&dir)?;
        }
        Ok(())
    }
}

/// Reject paths that escape a permitted directory.
///
/// Used for every guest path and every user-supplied host path. It never trusts
/// the string coming from the frontend.
pub fn ensure_within(base: &Path, candidate: &Path) -> bool {
    let base = match base.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    match candidate.canonicalize() {
        Ok(c) => c.starts_with(&base),
        Err(_) => false,
    }
}

/// Guest paths are absolute inside the guest; reject traversal and control chars.
pub fn validate_guest_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 4096 {
        return Err("path length is invalid".into());
    }
    if !path.starts_with('/') {
        return Err("guest path must be absolute".into());
    }
    if path.split('/').any(|seg| seg == "..") {
        return Err("guest path must not contain '..'".into());
    }
    if path.chars().any(|c| c.is_control()) {
        return Err("guest path must not contain control characters".into());
    }
    Ok(())
}
