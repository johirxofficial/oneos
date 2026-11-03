import { useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  Bell,
  Circle,
  Cpu,
  FolderOpen,
  Info,
  LayoutGrid,
  Maximize2,
  Minus,
  MonitorPlay,
  Package,
  Power,
  Settings,
  TerminalSquare,
  Wifi,
  X,
} from "lucide-react";
import { formatClock } from "../lib/format";
import { APP_META, useShell } from "../lib/shell";
import { useHostMetrics, useVmStatus } from "../lib/useVm";
import { windowAction } from "../lib/appWindow";
import { Logo } from "../components/ui";
import type { AppId } from "../lib/types";

const DOCK_APPS: AppId[] = ["display", "terminal", "files", "software", "settings", "monitor", "about"];

const DOCK_ICONS: Record<AppId, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  display: MonitorPlay,
  terminal: TerminalSquare,
  files: FolderOpen,
  software: Package,
  settings: Settings,
  monitor: Activity,
  about: Info,
};

export default function Taskbar({
  launcherOpen,
  onToggleLauncher,
  onToggleNotifications,
  onTogglePower,
  unread,
}: {
  launcherOpen: boolean;
  onToggleLauncher: () => void;
  onToggleNotifications: () => void;
  onTogglePower: () => void;
  unread: number;
}) {
  const { openWindow, focusWindow, windows, activeId, minimizeWindow } = useShell();
  const [now, setNow] = useState(new Date());
  const metrics = useHostMetrics();
  const { status } = useVmStatus();

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const running = status?.state === "running";
  const stateLabel =
    status?.state === "running"
      ? "linux running"
      : status?.state === "starting"
        ? "starting linux"
        : status?.state === "stopping"
          ? "stopping linux"
          : status?.state === "crashed"
            ? "linux stopped unexpectedly"
            : "linux not running";

  function activate(appId: AppId) {
    const existing = windows.find((w) => w.appId === appId);
    if (existing) {
      if (existing.minimized || activeId !== existing.id) focusWindow(existing.id);
      else minimizeWindow(existing.id);
      return;
    }
    openWindow(appId);
  }

  return (
    <>
      {/* Top system bar */}
      <header className="drag-region absolute inset-x-0 top-0 z-40 flex h-10 items-center justify-between border-b border-white/[0.06] bg-[#05070c]/70 px-3 backdrop-blur-xl">
        <div className="no-drag flex items-center gap-2">
          <button
            onClick={onToggleLauncher}
            onDoubleClick={onToggleLauncher}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 transition ${
              launcherOpen ? "bg-white/10" : "hover:bg-white/6"
            }`}
            title="Open launcher"
          >
            <Logo size={18} glow={false} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-oneos-text/90">
              OneOS
            </span>
          </button>
          <span className="h-4 w-px bg-white/10" />
          <button
            onClick={onToggleLauncher}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-oneos-muted transition hover:bg-white/6 hover:text-oneos-text"
          >
            <LayoutGrid size={13} />
            Apps
          </button>
          {activeId ? (
            <span className="ml-1 max-w-[220px] truncate text-[11px] text-oneos-muted">
              {windows.find((w) => w.id === activeId)?.title}
            </span>
          ) : null}
        </div>

        <div className="no-drag flex items-center gap-1.5">
          <div
            className={`hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium sm:flex ${
              running
                ? "border-oneos-ok/25 bg-oneos-ok/10 text-oneos-ok"
                : status?.state === "crashed"
                  ? "border-oneos-danger/25 bg-oneos-danger/10 text-oneos-danger"
                  : "border-white/10 bg-white/[0.03] text-oneos-muted"
            }`}
            title={status?.message || stateLabel}
          >
            <Circle size={7} fill="currentColor" strokeWidth={0} />
            {stateLabel}
          </div>

          <div className="hidden items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-oneos-muted md:flex">
            <span className="inline-flex items-center gap-1">
              <Cpu size={11} /> {Math.round(metrics?.cpuUsage ?? 0)}%
            </span>
            <span className="inline-flex items-center gap-1">
              <Activity size={11} />
              {metrics
                ? `${Math.round(metrics.usedMemoryMb / 1024 * 10) / 10} / ${Math.round(
                    metrics.totalMemoryMb / 1024,
                  )} GB`
                : "-"}
            </span>
            {running ? (
              <span className="inline-flex items-center gap-1 text-oneos-ok">
                <Wifi size={11} /> nat
              </span>
            ) : null}
          </div>

          <button
            onClick={onToggleNotifications}
            className="relative rounded-md p-1.5 text-oneos-muted transition hover:bg-white/6 hover:text-oneos-text"
            title="Notifications"
          >
            <Bell size={15} />
            {unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[color:var(--oneos-accent)] px-1 text-[9px] font-bold text-slate-950">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </button>

          <button
            onClick={onTogglePower}
            className="rounded-md p-1.5 text-oneos-muted transition hover:bg-white/6 hover:text-oneos-text"
            title="Power"
          >
            <Power size={15} />
          </button>

          <div className="ml-1 flex flex-col items-end leading-none">
            <span className="text-[12px] font-semibold text-oneos-text">{formatClock(now)}</span>
            <span className="text-[9px] uppercase tracking-[0.14em] text-oneos-muted">
              {now.toLocaleDateString([], { day: "2-digit", month: "short" })}
            </span>
          </div>

          <span className="mx-1 h-5 w-px bg-white/10" />

          <div className="no-drag flex items-center">
            <button
              onClick={() => void windowAction("minimize")}
              className="grid h-7 w-8 place-items-center rounded text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
              title="Minimize window"
            >
              <Minus size={13} />
            </button>
            <button
              onClick={() => void windowAction("maximize")}
              className="grid h-7 w-8 place-items-center rounded text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
              title="Maximize window"
            >
              <Maximize2 size={12} />
            </button>
            <button
              onClick={() => void windowAction("close")}
              className="grid h-7 w-8 place-items-center rounded text-oneos-muted transition hover:bg-oneos-danger/80 hover:text-white"
              title="Close OneOS"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Dock */}
      <nav className="absolute inset-x-0 bottom-3 z-40 flex justify-center">
        <div className="flex items-end gap-1.5 rounded-2xl border border-white/10 bg-[#080c13]/75 px-2.5 py-2 shadow-glass backdrop-blur-2xl">
          {DOCK_APPS.map((appId) => {
            const Icon = DOCK_ICONS[appId];
            const open = windows.find((w) => w.appId === appId);
            const active = open && !open.minimized && activeId === open.id;
            return (
              <button
                key={appId}
                onClick={() => activate(appId)}
                className={`group relative grid h-11 w-11 place-items-center rounded-xl border transition-all duration-150 ${
                  active
                    ? "border-[color:var(--oneos-accent)]/40 bg-[color:var(--oneos-accent)]/15 text-[color:var(--oneos-accent)]"
                    : "border-transparent text-oneos-muted hover:border-white/10 hover:bg-white/8 hover:text-oneos-text"
                }`}
                title={APP_META[appId].title}
              >
                <Icon size={19} strokeWidth={1.7} />
                {open ? (
                  <span
                    className={`absolute -bottom-1 h-1 w-1 rounded-full ${
                      active ? "bg-[color:var(--oneos-accent)]" : "bg-oneos-muted/60"
                    }`}
                  />
                ) : null}
                <span className="pointer-events-none absolute -top-8 whitespace-nowrap rounded-md border border-white/10 bg-black/85 px-2 py-1 text-[10px] text-oneos-text opacity-0 transition group-hover:opacity-100">
                  {APP_META[appId].title}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
