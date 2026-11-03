use std::sync::Arc;

use crate::core::OneOsPaths;
use crate::db::Store;
use crate::system::{HostInfo, HostMonitor};
use crate::vm::manager::VmManager;
use crate::vm::qmp::GuestAgent;

/// Shared application state injected into every Tauri command.
pub struct AppState {
    pub paths: OneOsPaths,
    pub store: Arc<Store>,
    pub manager: Arc<VmManager>,
    pub host: HostMonitor,
    pub host_info: HostInfo,
    /// Lazily connected guest agent. `None` means "not connected yet".
    pub guest: tokio::sync::Mutex<Option<GuestAgent>>,
}
