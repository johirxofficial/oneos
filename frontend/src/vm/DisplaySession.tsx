import { useCallback, useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";
import {
  Keyboard,
  Maximize,
  MonitorPlay,
  Play,
  RefreshCw,
  Square,
  TriangleAlert,
} from "lucide-react";
import { api } from "../lib/api";
import { startVm, isMemoryBlocked, useVmStatus } from "../lib/useVm";
import { Badge, Button, Spinner } from "../components/ui";

type Phase = "idle" | "connecting" | "connected" | "error";

export default function DisplaySession() {
  const { status, refresh } = useVmStatus(2000);
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [scaled, setScaled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [memBlocked, setMemBlocked] = useState(false);

  const disconnect = useCallback(() => {
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {
        /* already gone */
      }
      rfbRef.current = null;
    }
    if (containerRef.current) containerRef.current.innerHTML = "";
  }, []);

  const connect = useCallback(async () => {
    if (!containerRef.current) return;
    setPhase("connecting");
    setMessage("negotiating local console session");
    disconnect();
    try {
      const session = await api.displaySession();
      const target = containerRef.current;
      target.innerHTML = "";
      const rfb = new RFB(target, session.wsUrl, {
        credentials: { password: session.token },
        wsProtocols: ["binary"],
      });
      rfb.scaleViewport = scaled;
      rfb.resizeSession = false;
      rfb.showDotCursor = true;
      rfb.focusOnClick = true;
      rfb.background = "#04060a";
      rfb.clipViewport = false;

      rfb.addEventListener("connect", () => {
        setPhase("connected");
        setMessage("console connected");
      });
      rfb.addEventListener("disconnect", ((event: CustomEvent<{ clean: boolean }>) => {
        setPhase((prev) => (prev === "error" ? prev : "idle"));
        setMessage(event.detail?.clean ? "console closed" : "console disconnected");
      }) as EventListener);
      rfb.addEventListener("credentialsrequired", () => {
        rfb.sendCredentials({ password: session.token });
      });
      rfb.addEventListener("securityfailure", ((event: CustomEvent<{ reason?: string }>) => {
        setPhase("error");
        setMessage(event.detail?.reason || "console authentication failed");
      }) as EventListener);

      rfbRef.current = rfb;
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [disconnect, scaled]);

  useEffect(() => {
    if (status?.state === "running" && phase === "idle") {
      void connect();
    }
    if (status && status.state !== "running" && rfbRef.current) {
      disconnect();
      setPhase("idle");
    }
  }, [status, phase, connect, disconnect]);

  useEffect(() => () => disconnect(), [disconnect]);

  useEffect(() => {
    if (rfbRef.current) rfbRef.current.scaleViewport = scaled;
  }, [scaled]);

  async function startGuest(force = false) {
    setBusy(true);
    try {
      await startVm(undefined, force);
      setMemBlocked(false);
      await refresh();
    } catch (e) {
      setMemBlocked(isMemoryBlocked(e));
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  const running = status?.state === "running";

  return (
    <div className="flex h-full flex-col bg-[#04060a]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3">
        <div className="flex items-center gap-2">
          <Badge tone={running ? "ok" : status?.state === "crashed" ? "danger" : "neutral"}>
            {running ? "live" : status?.state ?? "stopped"}
          </Badge>
          <span className="truncate text-[11px] text-oneos-muted">
            {message || status?.message || "linux console"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScaled((s) => !s)}
            className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
            title="Toggle scaling"
          >
            <Maximize size={14} />
          </button>
          <button
            onClick={() => rfbRef.current?.sendCtrlAltDel()}
            disabled={!running}
            className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text disabled:opacity-30"
            title="Send Ctrl+Alt+Del to Linux"
          >
            <Keyboard size={14} />
          </button>
          <button
            onClick={() => void connect()}
            disabled={!running}
            className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text disabled:opacity-30"
            title="Reconnect console"
          >
            <RefreshCw size={14} />
          </button>
          {running ? (
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  await api.vmStop();
                  await refresh();
                } finally {
                  setBusy(false);
                  disconnect();
                }
              }}
              disabled={busy}
              className="rounded p-1.5 text-oneos-danger/80 transition hover:bg-oneos-danger/15 hover:text-oneos-danger disabled:opacity-30"
              title="Stop Linux"
            >
              <Square size={13} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="vnc-host absolute inset-0" />

        {!running ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#05080e]/90 px-8 text-center">
            {status?.state === "starting" || status?.state === "stopping" ? (
              <>
                <Spinner size={26} />
                <div className="text-[13px] text-oneos-text">{status.message}</div>
                <div className="max-w-sm text-[11px] text-oneos-muted">
                  The console will attach automatically as soon as the machine is running.
                </div>
              </>
            ) : status?.state === "crashed" ? (
              <>
                <TriangleAlert size={26} className="text-oneos-danger" />
                <div className="text-[13px] font-medium text-oneos-text">Linux stopped unexpectedly</div>
                <div className="max-w-md break-words text-[11px] text-oneos-muted">{status.message}</div>
                <Button variant="primary" onClick={() => void startGuest()} disabled={busy}>
                  <Play size={14} /> Start again
                </Button>
              </>
            ) : (
              <>
                <MonitorPlay size={28} className="text-oneos-muted/70" />
                <div className="text-[13px] font-medium text-oneos-text">Linux console is offline</div>
                <div className="max-w-sm text-[11px] leading-relaxed text-oneos-muted">
                  Start the Linux machine to open the Debian desktop inside this window. First run
                  boots the installer from the selected ISO.
                </div>
                <Button variant="primary" onClick={() => void startGuest()} disabled={busy}>
                  {busy ? <Spinner size={14} /> : <Play size={14} />} Start Linux
                </Button>
                {memBlocked ? (
                  <button
                    onClick={() => void startGuest(true)}
                    disabled={busy}
                    className="text-[10px] font-semibold text-oneos-warn underline disabled:opacity-40"
                  >
                    Start anyway (Windows may slow down)
                  </button>
                ) : null}
                {message ? (
                  <div className="mt-2 max-w-md break-words text-[10px] text-oneos-danger/80">{message}</div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {running && phase === "connecting" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-[11px] text-oneos-text">
              <Spinner size={13} /> connecting console...
            </div>
          </div>
        ) : null}

        {running && phase === "error" ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-oneos-danger/20 bg-oneos-danger/10 px-3 py-2 text-[11px] text-oneos-danger">
            <span className="truncate">{message}</span>
            <button onClick={() => void connect()} className="font-semibold underline">
              retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
