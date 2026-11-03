import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  FolderOpen,
  Info,
  MonitorPlay,
  Package,
  Power,
  Search,
  Settings,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { APP_META } from "../lib/shell";
import { useShell } from "../lib/shell";
import { startVm, useVmStatus } from "../lib/useVm";
import type { AppId, PrereqItem } from "../lib/types";
import { Badge, Logo } from "../components/ui";

const ITEMS: { id: AppId; description: string; icon: typeof MonitorPlay }[] = [
  { id: "display", description: "Open the running Linux desktop", icon: MonitorPlay },
  { id: "terminal", description: "Run commands inside the Linux machine", icon: TerminalSquare },
  { id: "files", description: "Browse the Linux file system", icon: FolderOpen },
  { id: "software", description: "Install Linux and Windows applications", icon: Package },
  { id: "monitor", description: "Host and Linux resource usage", icon: Activity },
  { id: "settings", description: "Machine, account and appearance", icon: Settings },
  { id: "about", description: "Version and component status", icon: Info },
];

export default function Launcher({ onClose }: { onClose: () => void }) {
  const { openWindow } = useShell();
  const { status, refresh } = useVmStatus();
  const [query, setQuery] = useState("");
  const [prereqs, setPrereqs] = useState<PrereqItem[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.prerequisites().then(setPrereqs).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter(
      (i) => APP_META[i.id].title.toLowerCase().includes(q) || i.description.includes(q),
    );
  }, [query]);

  const running = status?.state === "running";

  async function toggleGuest() {
    setBusy(true);
    try {
      if (running) await api.vmStop();
      else await startVm();
      await refresh();
    } catch {
      /* surfaced by the VM status banner */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#04060a]/72 backdrop-blur-2xl">
      <div className="flex items-start justify-between px-10 pt-16">
        <div className="flex items-center gap-4">
          <Logo size={40} />
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.26em] text-oneos-text">
              OneOS Launcher
            </div>
            <div className="text-[11px] text-oneos-muted">
              {running
                ? "linux session is active"
                : status?.state === "starting"
                  ? "linux is starting"
                  : "linux session is not running"}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-white/10 bg-white/5 p-2 text-oneos-muted transition hover:text-oneos-text"
          title="Close launcher"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mx-auto mt-8 w-full max-w-3xl px-8">
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3">
          <Search size={16} className="text-oneos-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search applications and actions"
            className="w-full bg-transparent text-[13px] text-oneos-text outline-none placeholder:text-oneos-muted/70"
          />
          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-oneos-muted">
            esc
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {filtered.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  openWindow(item.id);
                  onClose();
                }}
                className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-left transition hover:border-[color:var(--oneos-accent)]/35 hover:bg-white/[0.06]"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-white/10 to-white/[0.02] text-oneos-text">
                  <Icon size={18} strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-oneos-text">
                    {APP_META[item.id].title}
                  </span>
                  <span className="block truncate text-[11px] text-oneos-muted">
                    {item.description}
                  </span>
                </span>
                <ArrowRight
                  size={14}
                  className="text-oneos-muted/0 transition group-hover:text-oneos-muted"
                />
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`grid h-9 w-9 place-items-center rounded-lg ${
                running ? "bg-oneos-ok/12 text-oneos-ok" : "bg-white/6 text-oneos-muted"
              }`}
            >
              <Power size={17} />
            </span>
            <div>
              <div className="text-[12px] font-medium text-oneos-text">
                {running ? "Stop virtual machine" : "Start virtual machine"}
              </div>
              <div className="text-[11px] text-oneos-muted">
                {status?.message || "QEMU Linux lifecycle"}
              </div>
            </div>
          </div>
          <button
            disabled={busy || status?.state === "starting" || status?.state === "stopping"}
            onClick={() => void toggleGuest()}
            className="rounded-lg border border-white/10 bg-white/6 px-3 py-1.5 text-[11px] font-semibold text-oneos-text transition hover:bg-white/12 disabled:opacity-40"
          >
            {running ? "Stop" : "Start"}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[10px] text-oneos-muted">
          <ShieldCheck size={12} />
          <span>local loopback console</span>
          {prereqs.map((p) => (
            <Badge key={p.id} tone={p.ok ? "ok" : p.required ? "warn" : "neutral"}>
              {p.label}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
