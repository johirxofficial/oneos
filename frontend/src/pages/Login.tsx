import { useEffect, useState } from "react";
import { ArrowRight, Cpu, HardDrive, ShieldCheck } from "lucide-react";
import { Logo } from "../components/ui";
import { formatClock, formatDate, formatMb } from "../lib/format";
import { useShell } from "../lib/shell";
import Wallpaper from "../desktop/Wallpaper";

export default function Login({ onEnter }: { onEnter: () => void }) {
  const { host, settings, session } = useShell();
  const [now, setNow] = useState(new Date());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function enter() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onEnter, 260);
  }

  return (
    <div
      className={`relative h-full w-full overflow-hidden transition-opacity duration-300 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <Wallpaper variant={settings["wallpaper"]} />
      <div className="absolute inset-0 backdrop-blur-[2px]" />

      <div className="relative flex h-full flex-col items-center justify-center px-8">
        <div className="mb-10 text-center">
          <div className="text-[64px] font-light leading-none tracking-tight text-white">
            {formatClock(now)}
          </div>
          <div className="mt-2 text-[12px] uppercase tracking-[0.32em] text-oneos-muted">
            {formatDate(now)}
          </div>
        </div>

        <button
          onClick={enter}
          className="group flex w-[320px] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/25 px-8 py-8 backdrop-blur-xl transition hover:border-[color:var(--oneos-accent)]/40 hover:bg-black/35"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-[color:var(--oneos-accent)]/25 blur-xl" />
            <div className="relative grid h-20 w-20 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-white/12 to-white/[0.02]">
              <Logo size={44} glow={false} />
            </div>
          </div>
          <div className="text-center">
            <div className="text-[16px] font-semibold text-oneos-text">
              {(session?.user ?? host?.hostName ?? "ONEOS").toUpperCase()}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-oneos-muted">
              {session?.hostUser ? `windows account · ${session.hostUser}` : "local session"}
            </div>
          </div>
          <span className="mt-1 inline-flex items-center gap-2 rounded-lg bg-[color:var(--oneos-accent)]/15 px-4 py-2 text-[12px] font-semibold text-[color:var(--oneos-accent)] transition group-hover:bg-[color:var(--oneos-accent)] group-hover:text-slate-950">
            Enter OneOS <ArrowRight size={15} />
          </span>
        </button>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-[11px] text-oneos-muted">
          <span className="inline-flex items-center gap-1.5">
            <Cpu size={13} /> {host ? `${host.physicalCores}C / ${host.logicalCores}T` : "-"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={13} /> {formatMb(host?.totalMemoryMb ?? 0)} RAM
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HardDrive size={13} /> {host ? host.oneosRoot : "-"}
          </span>
        </div>
      </div>

      <div className="absolute bottom-5 left-0 right-0 text-center text-[10px] uppercase tracking-[0.24em] text-oneos-muted/60">
        press enter to continue
      </div>
    </div>
  );
}
