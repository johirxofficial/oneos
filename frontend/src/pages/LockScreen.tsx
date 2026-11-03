import { useEffect, useRef, useState } from "react";
import { KeyRound, Lock, Unlock } from "lucide-react";
import { api } from "../lib/api";
import { formatClock, formatDate } from "../lib/format";
import { useShell } from "../lib/shell";
import Wallpaper from "../desktop/Wallpaper";
import { Spinner } from "../components/ui";

type Props = {
  /** "login" is the start-up gate, "lock" is the in-session lock screen. */
  mode: "login" | "lock";
  onUnlock: () => void;
};

export default function LockScreen({ mode, onUnlock }: Props) {
  const { session, settings } = useShell();
  const [now, setNow] = useState(new Date());
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pinSet = session?.pinSet ?? false;

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10_000);
    inputRef.current?.focus();
    return () => window.clearInterval(t);
  }, []);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!pinSet) {
      onUnlock();
      return;
    }
    if (pin.trim().length === 0) {
      setError("enter your PIN");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ok = await api.sessionUnlock(pin);
      if (ok) {
        setPin("");
        onUnlock();
      } else {
        setError("incorrect PIN");
        setPin("");
        inputRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const name = session?.user ?? "Owner";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Wallpaper variant={settings["wallpaper"]} />
      <div className="absolute inset-0 backdrop-blur-[10px]" />
      <div className="absolute inset-0 bg-black/35" />

      <div className="relative flex h-full flex-col items-center justify-center px-8">
        <div className="mb-8 text-center">
          <div className="text-[64px] font-light leading-none tracking-tight text-white">
            {formatClock(now)}
          </div>
          <div className="mt-2 text-[12px] uppercase tracking-[0.32em] text-oneos-muted">
            {formatDate(now)}
          </div>
        </div>

        <div className="w-[340px] rounded-2xl border border-white/10 bg-black/35 px-8 py-7 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-3">
            <div className="grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-white/12 to-white/[0.02] text-[20px] font-semibold text-oneos-text">
              {initials || "O"}
            </div>
            <div className="text-center">
              <div className="text-[15px] font-semibold text-oneos-text">{name}</div>
              <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] uppercase tracking-[0.22em] text-oneos-muted">
                {pinSet ? <Lock size={10} /> : <Unlock size={10} />}
                {mode === "lock" ? "session locked" : "local session"}
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-3">
            {pinSet ? (
              <>
                <div className="relative">
                  <KeyRound
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oneos-muted"
                  />
                  <input
                    ref={inputRef}
                    type="password"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      setError("");
                    }}
                    placeholder="PIN"
                    autoComplete="off"
                    className="w-full rounded-lg border border-white/10 bg-black/40 py-2.5 pl-9 pr-3 text-[13px] tracking-[0.2em] text-oneos-text outline-none focus:border-[color:var(--oneos-accent)]/50"
                  />
                </div>
                {error ? <div className="text-[11px] text-oneos-danger">{error}</div> : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--oneos-accent)] px-4 py-2 text-[12px] font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
                >
                  {busy ? <Spinner size={13} /> : <Unlock size={13} />} Unlock
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onUnlock()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--oneos-accent)] px-4 py-2 text-[12px] font-semibold text-slate-950 transition hover:brightness-110"
              >
                <Unlock size={13} /> {mode === "lock" ? "Resume session" : "Enter OneOS"}
              </button>
            )}
            <div className="text-center text-[10px] leading-relaxed text-oneos-muted/80">
              {pinSet
                ? "Five wrong attempts pause unlocking for 30 seconds."
                : "No PIN is set. Add one in Settings → Account to protect this screen."}
            </div>
          </form>
        </div>

        <div className="absolute bottom-5 left-0 right-0 text-center text-[10px] uppercase tracking-[0.24em] text-oneos-muted/60">
          oneos · local session · {session?.hostUser ?? "owner"}
        </div>
      </div>
    </div>
  );
}
