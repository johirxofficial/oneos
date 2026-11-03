import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Cpu,
  Database,
  FolderCog,
  Gauge,
  HardDrive,
  KeyRound,
  Lock,
  MemoryStick,
  Palette,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  User,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { formatBytes, formatMb } from "../lib/format";
import { useHostMetrics } from "../lib/useVm";
import { useShell } from "../lib/shell";
import type { AccelerationProbe, DiskInfo, QemuInfo, VmConfig } from "../lib/types";
import { Badge, Button, Field, Meter, Spinner, Toggle } from "../components/ui";

type Tab = "machine" | "account" | "appearance" | "system";

const WALLPAPERS = [
  { id: "aurora", label: "Aurora", swatch: "from-[#4f9dff] to-[#7b61ff]" },
  { id: "nebula", label: "Nebula", swatch: "from-[#7b61ff] to-[#ff5f6d]" },
  { id: "graphite", label: "Graphite", swatch: "from-slate-500 to-slate-800" },
];

const ACCENTS = ["#4f9dff", "#37d399", "#7b61ff", "#f5b544", "#ff5f6d", "#8fd3ff"];

export default function SettingsApp() {
  const { host, settings, setSetting, notify, session, setSession } = useShell();
  const metrics = useHostMetrics(3000);
  const [tab, setTab] = useState<Tab>("machine");
  const [config, setConfig] = useState<VmConfig | null>(null);
  const [qemu, setQemu] = useState<QemuInfo | null>(null);
  const [isos, setIsos] = useState<{ name: string; path: string; size: number }[]>([]);
  const [paths, setPaths] = useState<{ root: string; vms: string; isos: string; exports: string } | null>(
    null,
  );
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [probe, setProbe] = useState<AccelerationProbe | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  useEffect(() => {
    if (session) setDisplayName(session.user);
  }, [session]);

  const loadAll = useCallback(async () => {
    setError("");
    try {
      const existing = await api.vmConfig();
      const cfg = existing ?? (await api.vmConfigNew());
      setConfig(cfg);
      setQemu(await api.qemuInfo().catch(() => null));
      setIsos(await api.listIsos().catch(() => []));
      setPaths(await api.appPaths());
      setDisk(await api.diskInfo().catch(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const memoryCap = useMemo(() => {
    const total = host?.totalMemoryMb ?? 8192;
    return Math.max(1024, Math.min(4096, Math.floor((total * 0.6) / 256) * 256));
  }, [host]);

  const maxCores = host ? Math.max(1, Math.min(4, host.logicalCores)) : 2;

  async function save() {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api.saveVmConfig(config);
      setConfig(saved);
      notify("Configuration saved", "Virtual machine settings were stored.", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      notify("Save failed", e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function createDisk() {
    setBusy(true);
    try {
      const info = await api.diskCreate();
      setDisk(info);
      notify("Virtual disk created", `${formatBytes(info.virtualSize)} QCOW2`, "success");
    } catch (e) {
      notify("Disk creation failed", e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runProbe() {
    setBusy(true);
    try {
      setProbe(await api.probeAcceleration());
    } catch (e) {
      setProbe({ whpxAvailable: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-oneos-muted">
        <Spinner size={14} /> loading settings
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof Settings2 }[] = [
    { id: "machine", label: "Machine", icon: Settings2 },
    { id: "account", label: "Account", icon: User },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "system", label: "System", icon: Gauge },
  ];

  return (
    <div className="flex h-full bg-[#070b12]">
      <aside className="flex w-40 shrink-0 flex-col gap-1 border-r border-white/[0.06] bg-white/[0.015] p-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition ${
                tab === t.id
                  ? "bg-[color:var(--oneos-accent)]/12 text-[color:var(--oneos-accent)]"
                  : "text-oneos-muted hover:bg-white/5 hover:text-oneos-text"
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
        <div className="mt-auto px-1 text-[10px] leading-relaxed text-oneos-muted/70">
          <div className="mb-1 flex items-center gap-1">
            <ShieldCheck size={11} /> validated on save
          </div>
          Values are checked against the host before they are written.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
          <span className="text-[11px] uppercase tracking-[0.18em] text-oneos-muted">
            {tab === "machine" ? "virtual machine" : tab}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadAll()}
              className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
              title="Reload"
            >
              <RefreshCw size={13} />
            </button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={12} /> : <Save size={13} />} Save
            </Button>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 border-b border-oneos-danger/20 bg-oneos-danger/10 px-3 py-2 text-[11px] text-oneos-danger">
            <CircleAlert size={13} /> {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "machine" ? (
            <div className="space-y-4">
              <Field label="Machine name">
                <input
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none focus:border-[color:var(--oneos-accent)]/50"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
                    <span className="flex items-center gap-1.5">
                      <MemoryStick size={11} /> Linux memory
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
                  <div className="mt-2 text-[10px] text-oneos-muted">
                    host free: {formatMb(metrics?.availableMemoryMb ?? 0)} of{" "}
                    {formatMb(host?.totalMemoryMb ?? 0)}
                  </div>
                  <Meter
                    value={
                      host ? (config.memoryMb / Math.max(1, host.totalMemoryMb)) * 100 : 0
                    }
                    className="mt-1.5"
                    tone={config.memoryMb > memoryCap * 0.85 ? "warn" : "accent"}
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
                            : "border-white/10 bg-black/20 text-oneos-muted hover:text-oneos-text"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-oneos-muted">
                    host: {host?.physicalCores ?? 0} cores / {host?.logicalCores ?? 0} threads
                  </div>
                </div>
              </div>

              <Field label="Acceleration">
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border border-white/10 bg-black/25 p-0.5">
                    {(["whpx", "tcg"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setConfig({ ...config, accel: mode })}
                        className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition ${
                          config.accel === mode
                            ? "bg-[color:var(--oneos-accent)]/18 text-[color:var(--oneos-accent)]"
                            : "text-oneos-muted hover:text-oneos-text"
                        }`}
                      >
                        {mode === "whpx" ? "WHPX" : "TCG"}
                      </button>
                    ))}
                  </div>
                  <Button variant="ghost" onClick={() => void runProbe()} disabled={busy}>
                    {busy ? <Spinner size={12} /> : <Zap size={12} />} Test
                  </Button>
                  {probe ? (
                    <Badge tone={probe.whpxAvailable ? "ok" : "danger"}>
                      {probe.whpxAvailable ? "accelerated" : "unavailable"}
                    </Badge>
                  ) : null}
                </div>
                {probe ? (
                  <div className="mt-1.5 text-[10px] leading-relaxed text-oneos-muted">
                    {probe.message}
                  </div>
                ) : (
                  <div className="mt-1.5 text-[10px] text-oneos-muted">
                    WHPX uses the Windows hypervisor. TCG is pure emulation and much slower.
                  </div>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Virtual disk size" hint={disk ? "Disk already exists; size is fixed" : "Applied when the disk is created"}>
                  <input
                    type="number"
                    min={8}
                    max={200}
                    value={config.diskSizeGb}
                    disabled={!!disk}
                    onChange={(e) => setConfig({ ...config, diskSizeGb: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none disabled:opacity-50"
                  />
                </Field>
                <Field label="SSH forward port" hint="Loopback only: 127.0.0.1:<port> -> Linux 22">
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={config.sshPort}
                    onChange={(e) => setConfig({ ...config, sshPort: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none"
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <div className="text-[12px] text-oneos-text">UEFI firmware (OVMF)</div>
                  <div className="text-[10px] text-oneos-muted">
                    {qemu?.uefiAvailable
                      ? "OVMF firmware found next to QEMU"
                      : "No OVMF firmware detected - legacy BIOS will be used"}
                  </div>
                </div>
                <Toggle
                  checked={config.uefi}
                  onChange={(v) => setConfig({ ...config, uefi: v })}
                  label="UEFI"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <div className="text-[12px] text-oneos-text">Install mode</div>
                  <div className="text-[10px] text-oneos-muted">
                    {config.installMode
                      ? "Boots the ISO first - turn this off once Debian is installed"
                      : "Boots from the virtual disk"}
                  </div>
                </div>
                <Toggle
                  checked={config.installMode}
                  onChange={(v) => setConfig({ ...config, installMode: v })}
                  label="Install mode"
                />
              </div>

              <Field label="Installation ISO" hint="Place images in the ISO folder, then refresh">
                <div className="flex gap-2">
                  <select
                    value={isos.some((i) => i.path === config.isoPath) ? (config.isoPath ?? "") : ""}
                    onChange={(e) =>
                      setConfig({ ...config, isoPath: e.target.value || null })
                    }
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none"
                  >
                    <option value="">No ISO selected</option>
                    {isos.map((iso) => (
                      <option key={iso.path} value={iso.path}>
                        {iso.name} ({formatBytes(iso.size)})
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    onClick={async () => setIsos(await api.listIsos().catch(() => []))}
                  >
                    <RefreshCw size={12} />
                  </Button>
                </div>
                <div className="mt-1.5 truncate font-mono text-[10px] text-oneos-muted/70">
                  {paths?.isos ?? ""}
                </div>
              </Field>

              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => void createDisk()} disabled={busy || !!disk}>
                  <HardDrive size={13} /> {disk ? "Disk ready" : "Create virtual disk"}
                </Button>
                {disk ? (
                  <span className="text-[10px] text-oneos-muted">
                    {formatBytes(disk.actualSize)} allocated of {formatBytes(disk.virtualSize)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === "appearance" ? (
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
                  Wallpaper
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {WALLPAPERS.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => void setSetting("wallpaper", w.id)}
                      className={`overflow-hidden rounded-lg border transition ${
                        settings["wallpaper"] === w.id
                          ? "border-[color:var(--oneos-accent)]/60"
                          : "border-white/10 hover:border-white/25"
                      }`}
                    >
                      <div className={`h-16 w-full bg-gradient-to-br ${w.swatch}`} />
                      <div className="px-2 py-1.5 text-left text-[11px] text-oneos-text">{w.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
                  Accent colour
                </div>
                <div className="flex gap-2">
                  {ACCENTS.map((color) => (
                    <button
                      key={color}
                      onClick={() => void setSetting("accent", color)}
                      style={{ background: color }}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        settings["accent"] === color ? "border-white" : "border-transparent"
                      }`}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <div className="text-[12px] text-oneos-text">Boot splash animation</div>
                  <div className="text-[10px] text-oneos-muted">Show the OneOS startup sequence</div>
                </div>
                <Toggle
                  checked={settings["boot.splash"] !== "false"}
                  onChange={(v) => void setSetting("boot.splash", v ? "true" : "false")}
                  label="Boot splash"
                />
              </div>

              <Field label="Startup behaviour">
                <select
                  value={settings["startup.behavior"] ?? "ask"}
                  onChange={(e) => void setSetting("startup.behavior", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none"
                >
                  <option value="ask">Ask each time</option>
                  <option value="open-display">Open Linux desktop</option>
                  <option value="stay">Stay on desktop</option>
                </select>
              </Field>
            </div>
          ) : null}

          {tab === "account" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
                  <User size={12} /> Session profile
                </div>
                <Field label="Display name" hint="Shown on the login and lock screens">
                  <div className="flex gap-2">
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={32}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none focus:border-[color:var(--oneos-accent)]/50"
                    />
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          setSession(await api.sessionSetUser(displayName));
                          notify("Name updated", "The session profile was saved.", "success");
                        } catch (e) {
                          notify("Could not save the name", e instanceof Error ? e.message : String(e), "error");
                        }
                      }}
                      disabled={!displayName.trim() || displayName === session?.user}
                    >
                      <Save size={12} /> Save
                    </Button>
                  </div>
                </Field>
                <div className="mt-2 text-[10px] text-oneos-muted">
                  OneOS runs inside Windows account{" "}
                  <span className="font-mono text-oneos-text">{session?.hostUser ?? "-"}</span>, so it
                  has that account's access. The name above only labels this shell.
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
                    <KeyRound size={12} /> Screen lock
                  </div>
                  <Badge tone={session?.pinSet ? "ok" : "warn"}>
                    {session?.pinSet ? "pin set" : "no pin"}
                  </Badge>
                </div>

                <div className="space-y-2">
                  {session?.pinSet ? (
                    <input
                      type="password"
                      value={currentPin}
                      onChange={(e) => setCurrentPin(e.target.value)}
                      placeholder="current PIN"
                      autoComplete="off"
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none focus:border-[color:var(--oneos-accent)]/50"
                    />
                  ) : null}
                  <input
                    type="password"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder={session?.pinSet ? "new PIN (4-64 characters)" : "PIN (4-64 characters)"}
                    autoComplete="off"
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-oneos-text outline-none focus:border-[color:var(--oneos-accent)]/50"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={pinBusy || newPin.length < 4}
                      onClick={async () => {
                        setPinBusy(true);
                        try {
                          setSession(
                            await api.sessionSetPin(session?.pinSet ? currentPin : null, newPin),
                          );
                          setCurrentPin("");
                          setNewPin("");
                          notify("PIN saved", "Ctrl+L now locks the session.", "success");
                        } catch (e) {
                          notify("Could not save the PIN", e instanceof Error ? e.message : String(e), "error");
                        } finally {
                          setPinBusy(false);
                        }
                      }}
                    >
                      {pinBusy ? <Spinner size={12} /> : <Lock size={12} />}
                      {session?.pinSet ? "Change PIN" : "Set PIN"}
                    </Button>
                    {session?.pinSet ? (
                      <Button
                        variant="ghost"
                        disabled={pinBusy || currentPin.length === 0}
                        onClick={async () => {
                          setPinBusy(true);
                          try {
                            setSession(await api.sessionSetPin(currentPin, null));
                            setCurrentPin("");
                            setNewPin("");
                            notify("PIN removed", "The lock screen no longer asks for a PIN.", "info");
                          } catch (e) {
                            notify("Could not remove the PIN", e instanceof Error ? e.message : String(e), "error");
                          } finally {
                            setPinBusy(false);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <div className="text-[10px] leading-relaxed text-oneos-muted">
                    The PIN is stored as a salted SHA-256 hash in the local database. Five wrong
                    attempts pause unlocking for 30 seconds. Press Ctrl+L to lock.
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <div>
                  <div className="text-[12px] text-oneos-text">Require the PIN at start-up</div>
                  <div className="text-[10px] text-oneos-muted">
                    {session?.pinSet
                      ? "OneOS opens on the lock screen instead of the welcome screen"
                      : "Set a PIN first"}
                  </div>
                </div>
                <Toggle
                  checked={session?.lockOnStart ?? false}
                  onChange={async (v) => {
                    try {
                      setSession(await api.sessionSetLockOnStart(v));
                    } catch (e) {
                      notify("Could not change the setting", e instanceof Error ? e.message : String(e), "error");
                    }
                  }}
                  label="Lock on start"
                />
              </div>
            </div>
          ) : null}

          {tab === "system" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
                  <Database size={12} /> QEMU runtime
                </div>
                {qemu ? (
                  <div className="space-y-1 font-mono text-[10px] text-oneos-muted">
                    <div className="truncate text-oneos-text">{qemu.version}</div>
                    <div className="truncate">{qemu.exe}</div>
                    <div className="flex gap-2 pt-1">
                      <Badge tone={qemu.whpxSupported ? "ok" : "warn"}>
                        {qemu.whpxSupported ? "whpx build" : "no whpx"}
                      </Badge>
                      <Badge tone={qemu.uefiAvailable ? "ok" : "warn"}>
                        {qemu.uefiAvailable ? "ovmf" : "bios only"}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-oneos-danger">QEMU was not detected.</div>
                )}
              </div>

              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
                  <FolderCog size={12} /> Storage locations
                </div>
                <div className="space-y-1 font-mono text-[10px] text-oneos-muted">
                  <div className="truncate">root: {paths?.root}</div>
                  <div className="truncate">vms: {paths?.vms}</div>
                  <div className="truncate">isos: {paths?.isos}</div>
                  <div className="truncate">exports: {paths?.exports}</div>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
                  Security posture
                </div>
                <ul className="space-y-1.5 text-[11px] text-oneos-muted">
                  {[
                    "Console proxy bound to 127.0.0.1 with a per-session token",
                    "QMP bound to loopback only",
                    "Linux paths validated; no host path traversal",
                    "Host file export restricted to the OneOS exports folder",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-1.5">
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-oneos-ok" /> {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
