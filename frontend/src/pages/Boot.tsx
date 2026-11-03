import { useEffect, useMemo, useState } from "react";
import { Logo, Meter } from "../components/ui";
import { useShell } from "../lib/shell";

interface BootLine {
  label: string;
  detail: string;
}

export default function Boot({ onDone }: { onDone: () => void }) {
  const { host } = useShell();
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);

  const lines = useMemo<BootLine[]>(
    () => [
      { label: "OneOS kernel services", detail: "initializing session bus" },
      { label: "Storage layer", detail: "verifying virtual machine data directory" },
      { label: "Virtualization", detail: "probing QEMU and hardware acceleration" },
      { label: "Display subsystem", detail: "preparing console bridge" },
      { label: "User environment", detail: host ? `starting session for ${host.hostName}` : "starting session" },
    ],
    [host],
  );

  useEffect(() => {
    const tick = window.setInterval(() => {
      setProgress((p) => Math.min(100, p + 4 + Math.random() * 9));
    }, 90);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (step >= lines.length) {
      const done = window.setTimeout(onDone, 480);
      return () => window.clearTimeout(done);
    }
    const next = window.setTimeout(() => setStep((s) => s + 1), 380);
    return () => window.clearTimeout(next);
  }, [step, lines.length, onDone]);

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-oneos-bg">
      <div className="wallpaper-aurora absolute inset-0 opacity-70" />
      <div className="grid-overlay absolute inset-0 opacity-40" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <div className="animate-boot-pulse">
          <Logo size={76} />
        </div>
        <div className="mt-6 text-[26px] font-semibold tracking-[0.42em] text-oneos-text">ONEOS</div>
        <div className="mt-2 text-[11px] uppercase tracking-[0.3em] text-oneos-muted">
          virtual desktop platform
        </div>

        <div className="mt-9 w-full">
          <Meter value={progress} />
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.18em] text-oneos-muted">
            <span>starting up</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="mt-7 h-28 w-full space-y-1.5 font-mono text-[11px] text-oneos-muted">
          {lines.slice(0, step).map((line) => (
            <div key={line.label} className="flex animate-fade-in items-center gap-2">
              <span className="text-oneos-ok">ok</span>
              <span className="text-oneos-text/85">{line.label}</span>
              <span className="truncate text-oneos-muted/70">{line.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-6 flex gap-4 text-[10px] uppercase tracking-[0.2em] text-oneos-muted/60">
        <span>secure local session</span>
        <span>oneos 0.1.0</span>
      </div>
    </div>
  );
}
