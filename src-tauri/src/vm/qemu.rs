use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;

use crate::core::OneOsPaths;
use crate::error::{AppError, AppResult};
use crate::vm::config::{AccelMode, VmConfig};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// First TCP port used by QEMU's VNC server (`-vnc :0` == 5900).
pub const VNC_BASE_PORT: u16 = 5900;

/// A resolved, verified QEMU installation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QemuInfo {
    pub exe: String,
    pub qemu_img: String,
    pub version: String,
    pub whpx_supported: bool,
    pub uefi_available: bool,
    pub uefi_code: Option<String>,
}

#[derive(Debug, Clone)]
pub struct QemuRuntime {
    pub exe: PathBuf,
    pub qemu_img: PathBuf,
    pub version: String,
    pub install_dir: PathBuf,
}

impl QemuRuntime {
    /// Locate QEMU. Priority: project resources first, then PATH.
    pub fn detect(paths: &OneOsPaths) -> AppResult<Self> {
        let mut candidates: Vec<PathBuf> = vec![
            paths.qemu_dir().join("qemu-system-x86_64.exe"),
            paths.resources().join("qemu").join("qemu-system-x86_64.exe"),
        ];
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(';') {
                if !dir.trim().is_empty() {
                    candidates.push(Path::new(dir).join("qemu-system-x86_64.exe"));
                }
            }
        }

        let exe = candidates
            .into_iter()
            .find(|p| p.is_file())
            .ok_or_else(|| {
                AppError::QemuMissing(
                    "qemu-system-x86_64.exe was not found in resources/qemu or PATH".to_string(),
                )
            })?;

        let install_dir = exe
            .parent()
            .ok_or_else(|| AppError::QemuMissing("QEMU path has no parent directory".into()))?
            .to_path_buf();

        let qemu_img = install_dir.join("qemu-img.exe");
        if !qemu_img.is_file() {
            return Err(AppError::QemuMissing(format!(
                "qemu-img.exe is missing next to {}",
                exe.display()
            )));
        }

        let version = Self::probe_version(&exe)?;

        Ok(Self { exe, qemu_img, version, install_dir })
    }

    fn probe_version(exe: &Path) -> AppResult<String> {
        let mut cmd = std::process::Command::new(exe);
        cmd.arg("--version").stdin(Stdio::null()).stderr(Stdio::piped()).stdout(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output()?;
        if !out.status.success() {
            return Err(AppError::QemuMissing(format!(
                "{} --version failed with status {}",
                exe.display(),
                out.status
            )));
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let first = text.lines().next().unwrap_or("QEMU").trim().to_string();
        Ok(first)
    }

    /// Which accelerators this build can actually use on this host.
    pub fn available_accels(&self) -> Vec<String> {
        let mut cmd = std::process::Command::new(&self.exe);
        cmd.arg("-accel").arg("help").stdin(Stdio::null()).stderr(Stdio::piped()).stdout(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.output() {
            Ok(out) => String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn whpx_supported(&self) -> bool {
        self.available_accels().iter().any(|a| a.eq_ignore_ascii_case("whpx"))
    }

    fn find_file(&self, paths: &OneOsPaths, names: &[&str]) -> Option<PathBuf> {
        let dirs = [
            paths.firmware_dir(),
            self.install_dir.join("share"),
            self.install_dir.clone(),
        ];
        for dir in dirs {
            for name in names {
                let p = dir.join(name);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        None
    }

    /// Resolve (code, vars) OVMF firmware pair.
    pub fn firmware(&self, paths: &OneOsPaths) -> Option<(PathBuf, PathBuf)> {
        let code = self.find_file(
            paths,
            &["edk2-x86_64-code.fd", "OVMF_CODE.fd", "ovmf-code.fd", "OVMF_CODE_4M.fd"],
        )?;
        let vars = self.find_file(
            paths,
            &["edk2-i386-vars.fd", "OVMF_VARS.fd", "ovmf-vars.fd", "OVMF_VARS_4M.fd"],
        )?;
        Some((code, vars))
    }

    pub fn info(&self, paths: &OneOsPaths) -> QemuInfo {
        let fw = self.firmware(paths);
        QemuInfo {
            exe: self.exe.to_string_lossy().to_string(),
            qemu_img: self.qemu_img.to_string_lossy().to_string(),
            version: self.version.clone(),
            whpx_supported: self.whpx_supported(),
            uefi_available: fw.is_some(),
            uefi_code: fw.map(|(c, _)| c.to_string_lossy().to_string()),
        }
    }

    /// Create a dynamically allocated QCOW2 disk.
    pub fn create_disk(&self, disk_path: &Path, size_gb: u64) -> AppResult<()> {
        if let Some(parent) = disk_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if disk_path.exists() {
            return Err(AppError::validation("virtual disk already exists"));
        }
        let mut cmd = std::process::Command::new(&self.qemu_img);
        cmd.arg("create")
            .arg("-f")
            .arg("qcow2")
            .arg(disk_path)
            .arg(format!("{size_gb}G"))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output()?;
        if !out.status.success() {
            return Err(AppError::internal(format!(
                "qemu-img create failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        if !disk_path.is_file() {
            return Err(AppError::internal("qemu-img reported success but no disk was created"));
        }
        Ok(())
    }

    pub fn disk_info(&self, disk_path: &Path) -> AppResult<DiskInfo> {
        let mut cmd = std::process::Command::new(&self.qemu_img);
        cmd.arg("info")
            .arg("--output=json")
            .arg(disk_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output()?;
        if !out.status.success() {
            return Err(AppError::internal(format!(
                "qemu-img info failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        let value: serde_json::Value = serde_json::from_slice(&out.stdout)?;
        Ok(DiskInfo {
            path: disk_path.to_string_lossy().to_string(),
            virtual_size: value.get("virtual-size").and_then(|v| v.as_u64()).unwrap_or(0),
            actual_size: value.get("actual-size").and_then(|v| v.as_u64()).unwrap_or(0),
            format: value
                .get("format")
                .and_then(|v| v.as_str())
                .unwrap_or("qcow2")
                .to_string(),
        })
    }
}

/// Disk usage information reported by `qemu-img info`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub path: String,
    pub virtual_size: u64,
    pub actual_size: u64,
    pub format: String,
}

/// Ports and paths assigned for one VM run.
#[derive(Debug, Clone)]
pub struct RunPlan {
    pub vnc_port: u16,
    pub qmp_port: u16,
    pub ssh_port: u16,
    /// Loopback TCP port for the QEMU guest agent channel.
    ///
    /// QEMU's chardev socket backend cannot bind a Windows named pipe, so the
    /// guest agent is exposed on 127.0.0.1 only.
    pub guest_agent_port: u16,
    pub serial_log: PathBuf,
    pub efi_vars: Option<PathBuf>,
}

/// Build the full QEMU argument vector.
///
/// Arguments are passed as separate `OsString` items - never concatenated into a
/// shell string - so user-controlled values cannot inject commands.
pub fn build_args(
    qemu: &QemuRuntime,
    paths: &OneOsPaths,
    cfg: &VmConfig,
    plan: &RunPlan,
) -> AppResult<Vec<OsString>> {
    let mut a: Vec<OsString> = Vec::with_capacity(48);
    macro_rules! arg {
        ($s:expr) => {
            a.push(OsString::from($s))
        };
    }

    arg!("-name");
    arg!("oneos");

    match cfg.accel {
        AccelMode::Whpx => {
            arg!("-machine");
            arg!("q35,accel=whpx");
            arg!("-cpu");
            arg!("max");
        }
        AccelMode::Tcg => {
            arg!("-machine");
            arg!("q35");
            arg!("-cpu");
            arg!("max");
        }
    }

    arg!("-smp");
    arg!(cfg.cpu_cores.to_string());
    arg!("-m");
    arg!(cfg.memory_mb.to_string());

    arg!("-display");
    arg!("none");
    arg!("-vga");
    arg!("std");

    // QEMU's -vnc takes a *display number*, and the real TCP port is 5900 + display.
    // We allocate a concrete port, so subtract the VNC base port to keep them equal.
    if plan.vnc_port <= VNC_BASE_PORT {
        return Err(AppError::internal(
            "allocated VNC port is below the VNC base port range",
        ));
    }
    arg!("-vnc");
    arg!(format!(
        "127.0.0.1:{},password=on",
        plan.vnc_port - VNC_BASE_PORT
    ));

    arg!("-qmp");
    arg!(format!("tcp:127.0.0.1:{},server=on,wait=off", plan.qmp_port));
    arg!("-monitor");
    arg!("none");

    // Virtual disk
    arg!("-drive");
    arg!(format!(
        "file={},if=none,id=disk0,format=qcow2,cache=writeback,discard=unmap",
        cfg.disk_path
    ));
    arg!("-device");
    arg!("virtio-blk-pci,drive=disk0");

    // Installation media
    if let Some(iso) = &cfg.iso_path {
        arg!("-drive");
        arg!(format!("file={iso},media=cdrom,readonly=on,if=none,id=cd0"));
        arg!("-device");
        arg!("ide-cd,drive=cd0,bus=ide.0");
    }

    // Boot order: CD first while installing, disk otherwise.
    arg!("-boot");
    arg!(if cfg.install_mode { "order=d,menu=off" } else { "order=c,menu=off" });

    // Optional cloud-init seed (NoCloud). When a `seed.iso` sits next to the
    // disk, it is attached read-only; the guest sees a CIDATA volume and
    // configures itself on first boot. Nothing else changes.
    let seed = std::path::Path::new(&cfg.disk_path)
        .parent()
        .map(|dir| dir.join("seed.iso"));
    if let Some(seed) = seed {
        if seed.is_file() {
            arg!("-drive");
            arg!(format!(
                "file={},if=none,id=seed0,format=raw,readonly=on",
                seed.display()
            ));
            arg!("-device");
            arg!("virtio-blk-pci,drive=seed0");
        }
    }

    // UEFI firmware
    if cfg.uefi {
        if let (Some((code, _)), Some(vars)) = (qemu.firmware(paths), plan.efi_vars.clone()) {
            arg!("-drive");
            arg!(format!(
                "if=pflash,format=raw,unit=0,readonly=on,file={}",
                code.display()
            ));
            arg!("-drive");
            arg!(format!("if=pflash,format=raw,unit=1,file={}", vars.display()));
        }
    }

    // NAT networking with an explicit loopback-only SSH forward.
    arg!("-netdev");
    arg!(format!(
        "user,id=net0,hostfwd=tcp:127.0.0.1:{}-:22",
        plan.ssh_port
    ));
    arg!("-device");
    arg!("virtio-net-pci,netdev=net0");

    // QEMU guest agent on a loopback-only TCP channel.
    arg!("-device");
    arg!("virtio-serial-pci");
    arg!("-chardev");
    arg!(format!(
        "socket,id=qga0,host=127.0.0.1,port={},server=on,wait=off",
        plan.guest_agent_port
    ));
    arg!("-device");
    arg!("virtserialport,chardev=qga0,name=org.qemu.guest_agent.0");

    // Absolute pointer so the VNC cursor maps correctly.
    arg!("-usb");
    arg!("-device");
    arg!("usb-tablet");

    arg!("-rtc");
    arg!("base=localtime,driftfix=slew");

    arg!("-serial");
    arg!(format!("file:{}", plan.serial_log.display()));

    Ok(a)
}
