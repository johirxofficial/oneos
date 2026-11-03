import { Lock, LogOut, Power, RotateCcw, X } from "lucide-react";
import { api } from "../lib/api";
import { windowAction } from "../lib/appWindow";
import { useShell } from "../lib/shell";
import { useVmStatus } from "../lib/useVm";
import { Spinner } from "../components/ui";

export default function PowerMenu({ onClose }: { onClose: () => void }) {
  const { notify, lock } = useShell();
  const { status, refresh } = useVmStatus();
  const running = status?.state === "running" || status?.state === "starting";

  async function shutdown() {
    try {
      if (running) await api.vmStop();
    } catch {
      /* still close the shell */
    }
    await windowAction("close");
  }

  return (
    <div className="absolute bottom-16 right-3 z-50 w-[260px] overflow-hidden rounded-xl border border-white/10 bg-[#080c13]/96 shadow-glass backdrop-blur-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <span className="text-[12px] font-semibold text-oneos-text">Session</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2">
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-oneos-muted">
          {running ? <Spinner size={12} /> : <span className="h-2 w-2 rounded-full bg-oneos-muted" />}
          <span className="truncate">{status?.message || "linux not running"}</span>
        </div>

        <button
          onClick={() => {
            onClose();
            lock();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-oneos-text transition hover:bg-white/6"
        >
          <Lock size={14} className="text-oneos-muted" /> Lock screen
          <span className="ml-auto rounded border border-white/10 px-1 text-[9px] text-oneos-muted">
            ctrl+l
          </span>
        </button>

        <button
          onClick={() => {
            void refresh();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-oneos-text transition hover:bg-white/6"
        >
          <RotateCcw size={14} className="text-oneos-muted" /> Refresh Linux state
        </button>

        <button
          onClick={() => {
            onClose();
            notify("Session restarted", "The OneOS shell is reloading.", "info");
            window.setTimeout(() => window.location.reload(), 400);
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-oneos-text transition hover:bg-white/6"
        >
          <LogOut size={14} className="text-oneos-muted" /> Restart shell
        </button>

        <div className="my-1 h-px bg-white/[0.07]" />

        <button
          onClick={() => void shutdown()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-oneos-danger transition hover:bg-oneos-danger/10"
        >
          <Power size={14} /> Shut down OneOS
        </button>
      </div>
    </div>
  );
}
