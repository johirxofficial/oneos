import { invoke } from "@tauri-apps/api/core";
import type {
  AccelerationProbe,
  DiskInfo,
  DisplaySession,
  ExecResult,
  FileEntry,
  GuestStatus,
  HostInfo,
  HostMetrics,
  PrereqItem,
  QemuInfo,
  SessionInfo,
  VmConfig,
  VmStatus,
} from "./types";

function normalize(error: unknown): Error {
  if (typeof error === "string") return new Error(error);
  if (error instanceof Error) return error;
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown backend error");
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalize(error);
  }
}

export const api = {
  hostInfo: () => call<HostInfo>("host_info"),
  hostMetrics: () => call<HostMetrics>("host_metrics"),
  prerequisites: () => call<PrereqItem[]>("check_prerequisites"),
  qemuInfo: () => call<QemuInfo>("qemu_info"),
  probeAcceleration: () => call<AccelerationProbe>("probe_acceleration"),

  vmConfig: () => call<VmConfig | null>("vm_config_get"),
  vmConfigNew: () => call<VmConfig>("vm_config_new"),
  saveVmConfig: (config: VmConfig) => call<VmConfig>("vm_config_save", { config }),
  vmStatus: () => call<VmStatus>("vm_status"),
  vmStart: (install?: boolean, force?: boolean) => call<VmStatus>("vm_start", { install, force }),
  vmStop: () => call<VmStatus>("vm_stop"),
  vmRestart: () => call<VmStatus>("vm_restart"),
  diskCreate: () => call<DiskInfo>("vm_disk_create"),
  diskInfo: () => call<DiskInfo>("vm_disk_info"),
  displaySession: () => call<DisplaySession>("display_session"),

  guestStatus: () => call<GuestStatus>("guest_status"),
  guestExec: (command: string, cwd?: string) => call<ExecResult>("guest_exec", { command, cwd }),
  listDir: (path: string) => call<FileEntry[]>("guest_list_dir", { path }),
  mkdir: (path: string) => call<void>("guest_mkdir", { path }),
  rename: (from: string, to: string) => call<void>("guest_rename", { from, to }),
  remove: (path: string) => call<void>("guest_remove", { path }),
  readText: (path: string, maxBytes?: number) =>
    call<string>("guest_read_text", { path, maxBytes }),
  writeText: (path: string, content: string) =>
    call<void>("guest_write_text", { path, content }),
  importFile: (hostPath: string, guestPath: string) =>
    call<number>("guest_import_file", { hostPath, guestPath }),
  exportFile: (guestPath: string, fileName: string) =>
    call<string>("guest_export_file", { guestPath, fileName }),

  settingsAll: () => call<Record<string, string>>("settings_all"),
  settingSet: (key: string, value: string) => call<void>("settings_set", { key, value }),
  logsTail: (vmId: string, lines?: number) =>
    call<string>("logs_tail", { vmId, lines }),
  appPaths: () =>
    call<{ root: string; vms: string; isos: string; exports: string }>("app_paths"),
  defaultIsoDir: () => call<string>("default_iso_dir"),
  listIsos: () => call<{ name: string; path: string; size: number }[]>("list_isos"),
  writeBase64: (path: string, data: string) =>
    call<number>("guest_write_base64", { path, data }),

  sessionInfo: () => call<SessionInfo>("session_info"),
  sessionSetUser: (name: string) => call<SessionInfo>("session_set_user", { name }),
  sessionSetPin: (current: string | null, pin: string | null) =>
    call<SessionInfo>("session_set_pin", { current, pin }),
  sessionSetLockOnStart: (enabled: boolean) =>
    call<SessionInfo>("session_set_lock_on_start", { enabled }),
  sessionUnlock: (pin: string) => call<boolean>("session_unlock", { pin }),

  linuxAppInstall: (id: string) => call<ExecResult>("linux_app_install", { id }),
  openUrl: (url: string) => call<void>("open_url", { url }),
};
