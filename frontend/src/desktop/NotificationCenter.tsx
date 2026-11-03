import { BellOff, CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useShell } from "../lib/shell";

export default function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { notifications, dismiss, clearNotifications } = useShell();

  return (
    <div className="absolute right-3 top-12 z-50 w-[330px] overflow-hidden rounded-xl border border-white/10 bg-[#080c13]/95 shadow-glass backdrop-blur-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <span className="text-[12px] font-semibold text-oneos-text">Notifications</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
        >
          <X size={14} />
        </button>
      </div>

      <div className="max-h-[320px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <BellOff size={22} className="text-oneos-muted/60" />
            <span className="text-[12px] text-oneos-muted">No notifications</span>
          </div>
        ) : (
          notifications
            .slice()
            .reverse()
            .map((n) => {
              const Icon =
                n.level === "success"
                  ? CheckCircle2
                  : n.level === "warn" || n.level === "error"
                    ? CircleAlert
                    : Info;
              const color =
                n.level === "success"
                  ? "text-oneos-ok"
                  : n.level === "warn"
                    ? "text-oneos-warn"
                    : n.level === "error"
                      ? "text-oneos-danger"
                      : "text-[color:var(--oneos-accent)]";
              return (
                <div
                  key={n.id}
                  className="flex items-start gap-3 border-b border-white/[0.05] px-4 py-3 last:border-0"
                >
                  <Icon size={15} className={`mt-0.5 shrink-0 ${color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-oneos-text">{n.title}</div>
                    <div className="mt-0.5 break-words text-[11px] leading-relaxed text-oneos-muted">
                      {n.body}
                    </div>
                  </div>
                  <button
                    onClick={() => dismiss(n.id)}
                    className="rounded p-1 text-oneos-muted/60 transition hover:text-oneos-text"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })
        )}
      </div>

      {notifications.length > 0 ? (
        <button
          onClick={clearNotifications}
          className="w-full border-t border-white/[0.07] px-4 py-2 text-[11px] text-oneos-muted transition hover:bg-white/5 hover:text-oneos-text"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
