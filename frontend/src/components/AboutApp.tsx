import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Cpu, HardDrive, Info, MemoryStick } from "lucide-react";
import { api } from "../lib/api";
import { formatUptime } from "../lib/format";
import { useShell } from "../lib/shell";
import type { PrereqItem, QemuInfo } from "../lib/types";
import { Badge, Logo } from "../components/ui";

export default function AboutApp() {
  const { host } = useShell();
  const [qemu, setQemu] = useState<QemuInfo | null>(null);
  const [prereqs, setPrereqs] = useState<PrereqItem[]>([]);
  const [paths, setPaths] = useState<{ root: string; vms: string; isos: string } | null>(null);

  useEffect(() => {
    api.qemuInfo().then(setQemu).catch(() => undefined);
    api.prerequisites().then(setPrereqs).catch(() => undefined);
    api.appPaths().then(setPaths).catch(() => undefined);
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-[#070b12] p-6">
      <div className="flex items-center gap-4">
        <Logo size={56} />
        <div>
          <div className="text-[20px] font-semibold tracking-[0.16em] text-oneos-text">ONEOS</div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-oneos-muted">
            virtual desktop platform
          </div>
        </div>
        <Badge tone="accent">0.1.0</Badge>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-oneos-muted">
        OneOS runs a complete Debian Linux desktop inside a QEMU virtual machine managed by a Rust
        backend. The console is streamed over a loopback WebSocket into this window; files, terminal
        and metrics are wired to the real Linux machine through the QEMU guest agent.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
            <Cpu size={11} /> host cpu
          </div>
          <div className="text-[11px] text-oneos-text">{host?.cpuBrand ?? "-"}</div>
          <div className="text-[10px] text-oneos-muted">
            {host?.physicalCores ?? 0} cores / {host?.logicalCores ?? 0} threads
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
            <MemoryStick size={11} /> host memory
          </div>
          <div className="text-[11px] text-oneos-text">{host?.totalMemoryMb ?? 0} MB</div>
          <div className="text-[10px] text-oneos-muted">uptime {formatUptime(host?.uptimeSecs ?? 0)}</div>
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
            <HardDrive size={11} /> oneos root
          </div>
          <div className="truncate font-mono text-[10px] text-oneos-text">{paths?.root ?? "-"}</div>
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
            <Info size={11} /> qemu
          </div>
          <div className="truncate text-[11px] text-oneos-text">{qemu?.version ?? "not detected"}</div>
          <div className="text-[10px] text-oneos-muted">
            {qemu?.whpxSupported ? "whpx build" : "no whpx"} ·{" "}
            {qemu?.uefiAvailable ? "ovmf" : "bios"}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
          Requirements
        </div>
        <div className="space-y-1.5">
          {prereqs.map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
            >
              {p.ok ? (
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-oneos-ok" />
              ) : (
                <CircleAlert size={13} className="mt-0.5 shrink-0 text-oneos-warn" />
              )}
              <div className="min-w-0">
                <div className="text-[11px] text-oneos-text">{p.label}</div>
                <div className="break-words text-[10px] text-oneos-muted">{p.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 text-[10px] leading-relaxed text-oneos-muted/70">
        Rust + Tauri 2 · QEMU + WHPX · noVNC console · SQLite settings. Linux images and virtual disks
        stay outside the application installer.
      </div>
    </div>
  );
}
