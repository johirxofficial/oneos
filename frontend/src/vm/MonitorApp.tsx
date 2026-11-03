import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Activity, Cpu, Database, HardDrive, MemoryStick, RefreshCw, Server } from "lucide-react";
import { api } from "../lib/api";
import { formatBytes, formatMb, formatUptime } from "../lib/format";
import { useHostMetrics, useVmStatus } from "../lib/useVm";
import type { DiskInfo, GuestStatus } from "../lib/types";
import { Badge, Meter, Spinner } from "../components/ui";

interface LinuxMetrics {
  load1: number;
  memTotal: number;
  memUsed: number;
  memAvailable: number;
  diskTotal: number;
  diskUsed: number;
  diskFree: number;
  uptime: number;
}

function parseLinux(raw: string): LinuxMetrics | null {
  const out: LinuxMetrics = {
    load1: 0,
    memTotal: 0,
    memUsed: 0,
    memAvailable: 0,
    diskTotal: 0,
    diskUsed: 0,
    diskFree: 0,
    uptime: 0,
  };
  let found = false;
  for (const line of raw.split("\n")) {
    const [key, value] = line.split(":");
    if (!value) continue;
    const parts = value.split(",");
    if (key === "LOAD") {
      out.load1 = Number(parts[0]) || 0;
      found = true;
    } else if (key === "MEM") {
      out.memTotal = Number(parts[0]) || 0;
      out.memUsed = Number(parts[1]) || 0;
      out.memAvailable = Number(parts[2]) || 0;
      found = true;
    } else if (key === "DISK") {
      out.diskTotal = Number(parts[0]) || 0;
      out.diskUsed = Number(parts[1]) || 0;
      out.diskFree = Number(parts[2]) || 0;
      found = true;
    } else if (key === "UP") {
      out.uptime = Number(parts[0]) || 0;
    }
  }
  return found ? out : null;
}

function Card({
  icon,
  title,
  value,
  detail,
  meter,
  tone = "accent",
}: {
  icon: ReactNode;
  title: string;
  value: string;
  detail?: string;
  meter?: number;
  tone?: "accent" | "ok" | "warn" | "danger";
}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
          {icon} {title}
        </span>
        {detail ? <span className="text-[10px] text-oneos-muted">{detail}</span> : null}
      </div>
      <div className="mt-1.5 text-[18px] font-semibold leading-none text-oneos-text">{value}</div>
      {typeof meter === "number" ? <Meter value={meter} tone={tone} className="mt-2" /> : null}
    </div>
  );
}

export default function MonitorApp() {
  const host = useHostMetrics(2000);
  const { status, refresh } = useVmStatus(3000);
  const [guest, setLinux] = useState<GuestStatus | null>(null);
  const [metrics, setMetrics] = useState<LinuxMetrics | null>(null);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLinux = useCallback(async () => {
    if (status?.state !== "running") {
      setLinux(null);
      setMetrics(null);
      return;
    }
    try {
      const info = await api.guestStatus();
      setLinux(info);
      if (!info.connected) {
        setMetrics(null);
        return;
      }
      const res = await api.guestExec(
        `echo "LOAD:$(cut -d' ' -f1 /proc/loadavg)"; ` +
          `echo "MEM:$(free -m | awk '/^Mem:/{print $2","$3","$7}')"; ` +
          `echo "DISK:$(df -m / | awk 'NR==2{print $2","$3","$4}')"; ` +
          `echo "UP:$(cut -d. -f1 /proc/uptime)"`,
        "/",
      );
      setMetrics(parseLinux(res.stdout));
    } catch {
      setMetrics(null);
    }
  }, [status?.state]);

  useEffect(() => {
    void loadLinux();
    const t = window.setInterval(() => void loadLinux(), 5000);
    return () => window.clearInterval(t);
  }, [loadLinux]);

  useEffect(() => {
    if (status?.state === "running") {
      api.diskInfo().then(setDisk).catch(() => setDisk(null));
    }
  }, [status?.state]);

  const guestRunning = status?.state === "running";
  const cpuCores = 2;
  const guestCpu = metrics ? Math.min(100, (metrics.load1 / cpuCores) * 100) : 0;
  const guestMemPct = metrics && metrics.memTotal ? (metrics.memUsed / metrics.memTotal) * 100 : 0;
  const guestDiskPct = metrics && metrics.diskTotal ? (metrics.diskUsed / metrics.diskTotal) * 100 : 0;

  return (
    <div className="flex h-full flex-col bg-[#070b12]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2 text-[11px] text-oneos-muted">
          <Activity size={13} /> live resource monitoring
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            await refresh();
            await loadLinux();
            setBusy(false);
          }}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px] text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
        >
          {busy ? <Spinner size={11} /> : <RefreshCw size={11} />} refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-oneos-text/80">
              Host — Windows
            </h3>
            <Badge tone="neutral">{formatUptime(host?.uptimeSecs ?? 0)} uptime</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Card
              icon={<Cpu size={11} />}
              title="CPU load"
              value={`${Math.round(host?.cpuUsage ?? 0)}%`}
              meter={host?.cpuUsage ?? 0}
              tone={(host?.cpuUsage ?? 0) > 85 ? "danger" : (host?.cpuUsage ?? 0) > 60 ? "warn" : "ok"}
            />
            <Card
              icon={<MemoryStick size={11} />}
              title="Memory"
              value={formatMb(host?.usedMemoryMb ?? 0)}
              detail={`${formatMb(host?.availableMemoryMb ?? 0)} free`}
              meter={host ? (host.usedMemoryMb / host.totalMemoryMb) * 100 : 0}
              tone={host && host.availableMemoryMb < 1500 ? "warn" : "accent"}
            />
            <Card
              icon={<Activity size={11} />}
              title="QEMU process CPU"
              value={host?.processCpu != null ? `${host.processCpu.toFixed(0)}%` : "-"}
              meter={host?.processCpu ?? 0}
            />
            <Card
              icon={<Database size={11} />}
              title="QEMU process RAM"
              value={host?.processMemoryMb != null ? formatMb(host.processMemoryMb) : "-"}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-oneos-text/80">
              Linux · Debian
            </h3>
            <Badge tone={guest?.connected ? "ok" : guestRunning ? "warn" : "neutral"}>
              {guest?.connected ? "agent connected" : guestRunning ? "agent unavailable" : "offline"}
            </Badge>
          </div>

          {!guestRunning ? (
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-6 text-center text-[11px] text-oneos-muted">
              Start the Linux machine to collect metrics.
            </div>
          ) : !guest?.connected ? (
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-5 text-center text-[11px] text-oneos-muted">
              {guest?.message || "The QEMU guest agent is not reachable yet."}
              <div className="mt-1 text-[10px] text-oneos-muted/70">
                Install <span className="font-mono">qemu-guest-agent</span> inside Linux to enable
                file access, terminal and live metrics.
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[10px] text-oneos-muted">
                <Server size={11} />
                <span className="text-oneos-text/90">{guest.osName}</span>
                <span>{guest.osVersion}</span>
                <span className="font-mono">{guest.hostname}</span>
                <span className="font-mono">{guest.kernel}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Card
                  icon={<Cpu size={11} />}
                  title="CPU load (1m)"
                  value={metrics ? `${metrics.load1.toFixed(2)}` : "-"}
                  meter={guestCpu}
                  tone={guestCpu > 85 ? "danger" : guestCpu > 60 ? "warn" : "ok"}
                />
                <Card
                  icon={<MemoryStick size={11} />}
                  title="Linux memory"
                  value={metrics ? `${metrics.memUsed} MB` : "-"}
                  detail={metrics ? `${metrics.memTotal} MB total` : undefined}
                  meter={guestMemPct}
                />
                <Card
                  icon={<HardDrive size={11} />}
                  title="Linux root disk"
                  value={metrics ? formatBytes(metrics.diskUsed * 1024 * 1024) : "-"}
                  detail={metrics ? `${metrics.diskFree} MB free` : undefined}
                  meter={guestDiskPct}
                  tone={guestDiskPct > 90 ? "danger" : "accent"}
                />
                <Card
                  icon={<Activity size={11} />}
                  title="Linux uptime"
                  value={metrics ? formatUptime(metrics.uptime) : "-"}
                />
              </div>
            </>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-oneos-text/80">
            Virtual disk
          </h3>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[11px] text-oneos-muted">
            {disk ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em]">virtual size</div>
                  <div className="mt-0.5 font-mono text-oneos-text">{formatBytes(disk.virtualSize)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em]">allocated on host</div>
                  <div className="mt-0.5 font-mono text-oneos-text">{formatBytes(disk.actualSize)}</div>
                </div>
                <div className="col-span-2 truncate font-mono text-[10px] text-oneos-muted/80">
                  {disk.path}
                </div>
              </div>
            ) : (
              "No virtual disk has been created yet."
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

