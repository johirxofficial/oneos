mod commands;
mod core;
mod db;
mod error;
mod network;
mod state;
mod system;
mod vm;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::core::OneOsPaths;
use crate::db::Store;
use crate::state::AppState;
use crate::system::{HostInfo, HostMonitor};
use crate::vm::manager::VmManager;

fn init_logging(paths: &OneOsPaths) {
    let appender = tracing_appender::rolling::daily(paths.logs_dir(), "oneos.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    // The guard must outlive the process; leaking it is intentional.
    std::mem::forget(guard);
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("oneos_lib=info,tauri=warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_ansi(false)
        .try_init();
}

pub fn run() {
    let paths = OneOsPaths::resolve();
    let _ = paths.ensure_all();
    init_logging(&paths);
    tracing::info!(root = %paths.root.display(), "OneOS starting");

    // Keep the WebView2 profile on the OneOS data drive. Without this WebView2
    // writes ~100 MB into %LOCALAPPDATA% on C: and keeps growing there.
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", paths.webview_dir());
    }

    tauri::Builder::default()
        .setup(move |app| {
            let paths = OneOsPaths::resolve();
            paths.ensure_all()?;

            let store = Arc::new(Store::open(&paths.db_path())?);
            let host_info = HostInfo::collect(&paths);
            let manager = Arc::new(VmManager::new(
                app.handle().clone(),
                paths.clone(),
                store.clone(),
            ));

            let _ = store.log_event("info", "app", "OneOS started");

            app.manage(AppState {
                paths,
                store,
                manager: manager.clone(),
                host: HostMonitor::default(),
                host_info,
                guest: tokio::sync::Mutex::new(None),
            });

            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    let app = window.app_handle().clone();
                    // Always release the VM before the process exits so the
                    // QCOW2 image is never left with a stale lock.
                    tauri::async_runtime::block_on(async move {
                        if let Some(state) = app.try_state::<AppState>() {
                            state.manager.shutdown_blocking().await;
                        }
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::host_info,
            commands::host_metrics,
            commands::check_prerequisites,
            commands::qemu_info,
            commands::probe_acceleration,
            commands::vm_config_get,
            commands::vm_config_new,
            commands::vm_config_save,
            commands::vm_status,
            commands::vm_start,
            commands::vm_stop,
            commands::vm_restart,
            commands::vm_disk_create,
            commands::vm_disk_info,
            commands::display_session,
            commands::guest_status,
            commands::guest_exec,
            commands::guest_list_dir,
            commands::guest_mkdir,
            commands::guest_rename,
            commands::guest_remove,
            commands::guest_read_text,
            commands::guest_write_text,
            commands::guest_import_file,
            commands::guest_export_file,
            commands::settings_all,
            commands::settings_set,
            commands::logs_tail,
            commands::app_paths,
            commands::default_iso_dir,
            commands::list_isos,
            commands::guest_write_base64,
            commands::session_info,
            commands::session_set_user,
            commands::session_set_pin,
            commands::session_set_lock_on_start,
            commands::session_unlock,
            commands::linux_app_install,
            commands::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OneOS");
}
