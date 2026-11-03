import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Download,
  HardDrive,
  Info,
  MemoryStick,
  Play,
  Settings2,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { formatBytes, formatMb } from "../lib/format";
import { useShell } from "../lib/shell";
import { startVm } from "../lib/useVm";
import type { PrereqItem, QemuInfo, VmConfig } from "../lib/types";
import { Badge, Button, Field, Logo, Meter, Spinner, Toggle } from "../components/ui";

const STEPS = ["Welcome", "Resources", "Installer"];

export default function Setup({ onDone }: { onDone: () => void }) {
  const { host, notify } = useShell();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<VmConfig | null>(null);
  const [prereqs, setPrereqs] = useState<PrereqItem[]>([]);
  const [qemu, setQemu] = useState<QemuInfo | null>(null);
  const [isos, setIsos] = useState<{ name: string; path: string; size: number }[]>([]);
  const [paths, setPaths] = useState<{ root: string; vms: string; isos: string; exports: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const existing = await api.vmConfig();
        setConfig(existing ?? (await api.vmConfigNew()));
        setPrereqs(await api.prerequisites());
        setQemu(await api.qemuInfo().catch(() => null));
        const found = await api.listIsos().catch(() => []);
        setIsos(found);
        // Convenience: if exactly one image is present and nothing is chosen yet,
        // preselect it instead of making the operator hunt for the path.
        if (found.length === 1) {
          setConfig((prev) => (prev && !prev.isoPath ? { ...prev, isoPath: found[0].path } : prev));
        }
        setPaths(await api.appPaths());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const memoryCap = Math.max(1024, Math.min(4096, Math.floor(((host?.totalMemoryMb ?? 8192) * 0.6) / 256) * 256));
  const maxCores = host ? Math.max(1, Math.min(4, host.logicalCores)) : 2;

  async function finish(startInstall: boolean, force = false) {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveVmConfig(config);
      setConfig(saved);
      if (startInstall) {
        await api.diskCreate();
        await startVm(true, force);
        notify("Installation started", "The Debian installer is booting from the ISO.", "success");
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-oneos-muted">
        <Spinner size={14} /> preparing first run
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#05080e]">
      <div className="absolute inset-0 wallpaper-aurora opacity-50" />
      <div className="relative z-10 flex h-[min(700px,92vh)] w-[min(860px,94vw)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070b12]/95 shadow-glass backdrop-blur-2xl">
        <header className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-3">
            <Logo size={30} glow={false} />
            <div>
              <div className="text-[13px] font-semibold tracking-[0.14em] text-oneos-text">
                ONEOS FIRST RUN
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-oneos-muted">
                virtual machine setup
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] font-semibold ${
                    i === step
                      ? "border-[color:var(--oneos-accent)] bg-[color:var(--oneos-accent)]/15 text-[color:var(--oneos-accent)]"
                      : i < step
                        ? "border-oneos-ok/40 bg-oneos-ok/10 text-oneos-ok"
                        : "border-white/10 text-oneos-muted"
                  }`}
                >
                  {i < step ? <CheckCircle2 size={12} /> : i + 1}
                </span>
                <span
                  className={`hidden text-[10px] uppercase tracking-[0.14em] sm:block ${
                    i === step ? "text-oneos-text" : "text-oneos-muted"
                  }`}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 ? <span className="h-px w-4 bg-white/10" /> : null}
              </div>
            ))}
          </div>
        </header>

        {error ? (
          <div className="flex items-center gap-2 border-b border-oneos-danger/20 bg-oneos-danger/10 px-5 py-2 text-[11px] text-oneos-danger">
            <CircleAlert size={13} /> {error}
            {/free host memory/i.test(error) ? (
              <button
                onClick={() => void finish(true, true)}
                disabled={busy}
                className="ml-auto shrink-0 rounded border border-oneos-warn/40 px-2 py-0.5 text-[10px] font-semibold text-oneos-warn disabled:opacity-40"
              >
                Start anyway
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-[16px] font-semibold text-oneos-text">Welcome to OneOS</h2>
                <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-oneos-muted">
                  OneOS will create a Debian Linux virtual machine on this computer and stream its
                  desktop into this window. Nothing is installed inside Windows beyond the QEMU
                  runtime; Linux lives in its own QCOW2 disk.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
                    <Cpu size={11} /> host capability
                  </div>
                  <div className="text-[11px] text-oneos-text">{host?.cpuBrand ?? "-"}</div>
                  <div className="text-[10px] text-oneos-muted">
                    {host?.physicalCores ?? 0} cores, {formatMb(host?.totalMemoryMb ?? 0)} RAM
                  </div>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
                    <Zap size={11} /> acceleration
                  </div>
                  <div className="text-[11px] text-oneos-text">
                    {qemu?.whpxSupported ? "WHPX build available" : "TCG only"}
                  </div>
                  <div className="text-[10px] text-oneos-muted">{qemu?.version ?? "QEMU not found"}</div>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
                  requirement check
                </div>
                <div className="space-y-1.5">
                  {prereqs.length === 0 ? (
                    <div className="text-[11px] text-oneos-muted">running checks...</div>
                  ) : (
                    prereqs.map((p) => (
                      <div key={p.id} className="flex items-start gap-2">
                        {p.ok ? (
                          <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-oneos-ok" />
                        ) : (
                          <CircleAlert size={12} className="mt-0.5 shrink-0 text-oneos-warn" />
                        )}
                        <div className="min-w-0">
                          <div className="text-[11px] text-oneos-text">{p.label}</div>
                          <div className="break-words text-[10px] text-oneos-muted">{p.detail}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-oneos-warn/20 bg-oneos-warn/[0.06] px-3 py-2 text-[10px] leading-relaxed text-oneos-warn">
                <Info size={12} className="mt-0.5 shrink-0" />
                8 GB hosts are tight. OneOS defaults to 1536 MB Linux memory and refuses to start when
                free host memory is below the Linux size plus an 800 MB reserve.
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <h2 className="text-[16px] font-semibold text-oneos-text">Linux resources</h2>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
                    <span className="flex items-center gap-1.5">
                      <MemoryStick size={11} /> memory
                    </span>
                    <span className="font-mono text-oneos-text">{formatMb(config.memoryMb)}</span>
                  </div>
                  <input
                    type="range"
                    min={512}
                    max={memoryCap}
                    step={256}
                    value={config.memoryMb}
                    onChange={(e) => setConfig({ ...config, memoryMb: Number(e.target.value) })}
                    className="w-full accent-[color:var(--oneos-accent)]"
                  />
                  <Meter
                    value={host ? (config.memoryMb / Math.max(1, host.totalMemoryMb)) * 100 : 0}
                    className="mt-2"
                  />
                </div>

                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
                    <Cpu size={11} /> virtual cpus
                  </div>
                  <div className="flex gap-1.5">
                    {Array.from({ length: maxCores }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => setConfig({ ...config, cpuCores: n })}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition ${
                          config.cpuCores === n
                            ? "border-[color:var(--oneos-accent)]/50 bg-[color:var(--oneos-accent)]/15 text-[color:var(--oneos-accent)]"
                            : "border-white/10 bg-black/20 text-oneos-muted"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-oneos-muted">
                    leave a core for Windows
                  </div>
                </div>
              </div>

              <Field label="Virtual disk size (GB)" hint="Dynamically allocated QCOW2 - grows as the guest writes data">
                <input
                  type="number"
                  min={8}
                  max={200}
                  value={config.diskSizeGb}
                  onChange={(e) => setConfig({ ...config, diskSizeGb: Number(e.target.value) })}
                  className="w-40 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none"
                />
              </Field>

              <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <div className="text-[12px] text-oneos-text">Use WHPX acceleration</div>
                  <div className="text-[10px] text-oneos-muted">
                    Requires the Windows Hypervisor Platform feature
                  </div>
                </div>
                <Toggle
                  checked={config.accel === "whpx"}
                  onChange={(v) => setConfig({ ...config, accel: v ? "whpx" : "tcg" })}
                  label="WHPX"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <div className="text-[12px] text-oneos-text">UEFI firmware</div>
                  <div className="text-[10px] text-oneos-muted">
                    {qemu?.uefiAvailable ? "OVMF available" : "OVMF not found - BIOS fallback"}
                  </div>
                </div>
                <Toggle
                  checked={config.uefi && !!qemu?.uefiAvailable}
                  onChange={(v) => setConfig({ ...config, uefi: v })}
                  label="UEFI"
                />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <h2 className="text-[16px] font-semibold text-oneos-text">Installation media</h2>
              <p className="text-[12px] leading-relaxed text-oneos-muted">
                Select an official Debian ISO already on this computer. OneOS verifies the file exists
                before booting; the installer then runs inside Linux.
              </p>

              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
                  <span className="flex items-center gap-1.5">
                    <HardDrive size={11} /> detected images
                  </span>
                  <button
                    onClick={async () => setIsos(await api.listIsos().catch(() => []))}
                    className="rounded px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
                  >
                    refresh
                  </button>
                </div>
                {isos.length === 0 ? (
                  <div className="space-y-1.5 text-[11px] text-oneos-muted">
                    <div>No ISO found in:</div>
                    <div className="break-all font-mono text-[10px] text-oneos-text/80">
                      {paths?.isos}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-oneos-muted/80">
                      <Download size={11} /> Download the Debian netinst image and copy it there, then
                      refresh.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {isos.map((iso) => (
                      <button
                        key={iso.path}
                        onClick={() => setConfig({ ...config, isoPath: iso.path })}
                        className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left text-[11px] transition ${
                          config.isoPath === iso.path
                            ? "border-[color:var(--oneos-accent)]/50 bg-[color:var(--oneos-accent)]/10 text-oneos-text"
                            : "border-white/10 bg-black/20 text-oneos-muted hover:text-oneos-text"
                        }`}
                      >
                        <span className="truncate">{iso.name}</span>
                        <span className="ml-2 shrink-0 font-mono text-[10px]">
                          {formatBytes(iso.size)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Field label="Custom ISO path" hint="Optional: full Windows path to a Debian ISO">
                <input
                  value={config.isoPath ?? ""}
                  onChange={(e) => setConfig({ ...config, isoPath: e.target.value || null })}
                  placeholder="D:\OneOS\data\isos\debian.iso"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-[11px] text-oneos-text outline-none"
                />
              </Field>

              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-[10px] leading-relaxed text-oneos-muted">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]">
                  <ShieldCheck size={11} /> what happens next
                </div>
                A 25 GB dynamic disk is created in{" "}
                <span className="font-mono text-oneos-text/80">{paths?.vms}</span>, QEMU boots the ISO,
                and the Debian installer appears in the Linux Desktop window. After installing, install{" "}
                <span className="font-mono">qemu-guest-agent</span> inside Linux to unlock terminal
                and file access.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={config.isoPath ? "ok" : "warn"}>
                  {config.isoPath ? "installer selected" : "installer not selected"}
                </Badge>
                <Badge tone={config.accel === "whpx" ? "accent" : "neutral"}>
                  {config.accel.toUpperCase()}
                </Badge>
                <Badge tone="neutral">{formatMb(config.memoryMb)} linux</Badge>
                <Badge tone="neutral">{config.cpuCores} vCPU</Badge>
                <Badge tone="neutral">{config.diskSizeGb} GB disk</Badge>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.07] px-5 py-3">
          <Button
            variant="subtle"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
          >
            <ArrowLeft size={13} /> Back
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="subtle" onClick={() => void finish(false)} disabled={busy}>
              <Settings2 size={13} /> Finish without installing
            </Button>
            {step < 2 ? (
              <Button variant="primary" onClick={() => setStep((s) => Math.min(2, s + 1))}>
                Continue <ArrowRight size={13} />
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void finish(true)}
                disabled={busy || !config.isoPath}
              >
                {busy ? <Spinner size={13} /> : <Play size={13} />} Create disk and start installation
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
