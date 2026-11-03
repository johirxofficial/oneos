import { useEffect, useState } from "react";
import {
  Activity,
  FolderOpen,
  Info,
  MonitorPlay,
  Package,
  Play,
  Settings,
  Square,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { formatClock, formatMb } from "../lib/format";
import { useShell } from "../lib/shell";
import { startVm, useHostMetrics, useVmStatus } from "../lib/useVm";
import type { AppId } from "../lib/types";
import Wallpaper from "../desktop/Wallpaper";
import Taskbar from "../desktop/Taskbar";
import Launcher from "../desktop/Launcher";
import NotificationCenter from "../desktop/NotificationCenter";
import PowerMenu from "../desktop/PowerMenu";
import WindowManager from "../windows/WindowManager";
import { Logo } from "../components/ui";

const ICONS: { appId: AppId; label: string; icon: typeof FolderOpen }[] = [
  { appId: "display", label: "Linux Desktop", icon: MonitorPlay },
  { appId: "terminal", label: "Terminal", icon: TerminalSquare },
  { appId: "files", label: "Files", icon: FolderOpen },
  { appId: "software", label: "Software", icon: Package },
  { appId: "settings", label: "Settings", icon: Settings },
  { appId: "monitor", label: "System Monitor", icon: Activity },
  { appId: "about", label: "About OneOS", icon: Info },
];

export default function DesktopPage() {
  const { settings, openWindow, notifications, notify, lock } = useShell();
  const [launcher, setLauncher] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { status, refresh } = useVmStatus(3000);
  const metrics = useHostMetrics(3000);
  const [now] = useState(new Date());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault();
        setLauncher((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        lock();
      }
      if (e.key === "Escape") {
        setLauncher(false);
        setNotifOpen(false);
        setPowerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lock]);

  const running = status?.state === "running";

  async function toggleGuest() {
    setBusy(true);
    try {
      if (running) {
        await api.vmStop();
        notify("Linux stopped", "The Debian session has been shut down.", "info");
      } else {
        await startVm();
        notify("Linux starting", "QEMU boot sequence has begun.", "info");
        openWindow("display");
      }
      await refresh();
    } catch (e) {
      notify("Virtual machine error", e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Wallpaper variant={settings["wallpaper"]} />

      <div
        className="absolute inset-0 bottom-20 top-10 px-5 py-4"
        onPointerDown={() => setSelected(null)}
      >
        <div className="grid w-[92px] auto-rows-min gap-1">
          {ICONS.map((item) => {
            const Icon = item.icon;
            const isSelected = selected === item.appId;
            return (
              <button
                key={item.appId}
                onClick={() => setSelected(item.appId)}
                onDoubleClick={() => openWindow(item.appId)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2 transition ${
                  isSelected
                    ? "border-[color:var(--oneos-accent)]/40 bg-[color:var(--oneos-accent)]/12"
                    : "border-transparent hover:border-white/10 hover:bg-white/[0.06]"
                }`}
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-white/12 to-white/[0.02] text-oneos-text shadow-sm">
                  <Icon size={18} strokeWidth={1.7} />
                </span>
                <span className="max-w-[80px] text-center text-[10px] leading-tight text-oneos-text/85">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop widget: session overview */}
      <div className="pointer-events-none absolute right-5 top-14 w-[230px]">
        <div className="pointer-events-auto rounded-xl border border-white/10 bg-black/25 p-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Logo size={20} glow={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-oneos-text">
                {settings["theme"] === "aurora" ? "OneOS Session" : "OneOS Session"}
              </div>
              <div className="text-[10px] text-oneos-muted">{formatClock(now)} local</div>
            </div>
            <span
              className={`h-2 w-2 rounded-full ${
                running ? "bg-oneos-ok" : status?.state === "crashed" ? "bg-oneos-danger" : "bg-oneos-muted"
              }`}
            />
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded-md bg-white/[0.04] px-2 py-1.5">
              <div className="text-oneos-muted">host cpu</div>
              <div className="font-mono text-oneos-text">{Math.round(metrics?.cpuUsage ?? 0)}%</div>
            </div>
            <div className="rounded-md bg-white/[0.04] px-2 py-1.5">
              <div className="text-oneos-muted">host free</div>
              <div className="font-mono text-oneos-text">{formatMb(metrics?.availableMemoryMb ?? 0)}</div>
            </div>
          </div>

          <button
            onClick={() => void toggleGuest()}
            disabled={busy || status?.state === "starting" || status?.state === "stopping"}
            className={`mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${
              running
                ? "border-oneos-danger/30 bg-oneos-danger/12 text-oneos-danger hover:bg-oneos-danger/20"
                : "border-[color:var(--oneos-accent)]/40 bg-[color:var(--oneos-accent)]/15 text-[color:var(--oneos-accent)] hover:bg-[color:var(--oneos-accent)]/25"
            }`}
          >
            {running ? <Square size={11} /> : <Play size={11} />}
            {running ? "Stop Linux" : "Start Linux"}
          </button>

          <div className="mt-1.5 truncate text-center text-[9px] text-oneos-muted/70">
            {status?.message || "linux not running"}
          </div>
        </div>

        <div className="pointer-events-auto mt-2 flex items-center justify-between rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-1.5 text-[9px] text-oneos-muted backdrop-blur">
          <span className="inline-flex items-center gap-1">
            <Zap size={10} className="text-[color:var(--oneos-accent)]" /> ctrl+space to launch
          </span>
          <span className="uppercase tracking-[0.16em]">oneos</span>
        </div>
      </div>

      <WindowManager />

      <Taskbar
        launcherOpen={launcher}
        onToggleLauncher={() => {
          setLauncher((v) => !v);
          setNotifOpen(false);
          setPowerOpen(false);
        }}
        onToggleNotifications={() => {
          setNotifOpen((v) => !v);
          setPowerOpen(false);
        }}
        onTogglePower={() => {
          setPowerOpen((v) => !v);
          setNotifOpen(false);
        }}
        unread={notifications.length}
      />

      {launcher ? <Launcher onClose={() => setLauncher(false)} /> : null}
      {notifOpen ? <NotificationCenter onClose={() => setNotifOpen(false)} /> : null}
      {powerOpen ? <PowerMenu onClose={() => setPowerOpen(false)} /> : null}

      <div className="pointer-events-none absolute bottom-20 right-4 z-20 flex w-[280px] flex-col gap-2">
        {notifications.slice(-3).map((n) => (
          <div
            key={n.id}
            className="animate-rise rounded-lg border border-white/10 bg-[#0a0f18]/95 px-3 py-2 shadow-glass backdrop-blur"
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  n.level === "success"
                    ? "bg-oneos-ok"
                    : n.level === "warn"
                      ? "bg-oneos-warn"
                      : n.level === "error"
                        ? "bg-oneos-danger"
                        : "bg-[color:var(--oneos-accent)]"
                }`}
              />
              <span className="truncate text-[11px] font-medium text-oneos-text">{n.title}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-oneos-muted">
              {n.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
