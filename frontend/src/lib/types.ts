export type VmState = "stopped" | "starting" | "running" | "stopping" | "crashed";

export interface VmStatus {
  state: VmState;
  pid: number | null;
  vncPort: number | null;
  wsPort: number | null;
  startedAt: number | null;
  installMode: boolean;
  message: string;
}

export interface VmConfig {
  id: string;
  name: string;
  memoryMb: number;
  cpuCores: number;
  diskSizeGb: number;
  diskPath: string;
  isoPath: string | null;
  uefi: boolean;
  accel: "whpx" | "tcg";
  displayWidth: number;
  displayHeight: number;
  network: "nat";
  sshPort: number;
  installMode: boolean;
}

export interface HostInfo {
  osName: string;
  osVersion: string;
  kernelVersion: string;
  hostName: string;
  cpuBrand: string;
  physicalCores: number;
  logicalCores: number;
  totalMemoryMb: number;
  totalSwapMb: number;
  uptimeSecs: number;
  disks: { name: string; mount: string; totalBytes: number; freeBytes: number }[];
  oneosRoot: string;
}

export interface HostMetrics {
  cpuUsage: number;
  totalMemoryMb: number;
  usedMemoryMb: number;
  availableMemoryMb: number;
  processCpu: number | null;
  processMemoryMb: number | null;
  uptimeSecs: number;
}

export interface QemuInfo {
  exe: string;
  qemuImg: string;
  version: string;
  whpxSupported: boolean;
  uefiAvailable: boolean;
  uefiCode: string | null;
}

export interface PrereqItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

export interface AccelerationProbe {
  whpxAvailable: boolean;
  message: string;
}

export interface DiskInfo {
  path: string;
  virtualSize: number;
  actualSize: number;
  format: string;
}

export interface DisplaySession {
  wsUrl: string;
  vncPort: number;
  wsPort: number;
  token: string;
}

export interface GuestStatus {
  connected: boolean;
  osName: string | null;
  osVersion: string | null;
  kernel: string | null;
  hostname: string | null;
  message: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export type AppId =
  | "display"
  | "terminal"
  | "files"
  | "software"
  | "settings"
  | "monitor"
  | "about";

export interface SessionInfo {
  user: string;
  hostUser: string;
  pinSet: boolean;
  lockOnStart: boolean;
}

export interface WindowState {
  id: string;
  appId: AppId;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  z: number;
}
