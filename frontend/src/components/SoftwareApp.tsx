import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Package,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";
import { api } from "../lib/api";
import { useShell } from "../lib/shell";
import { useVmStatus } from "../lib/useVm";
import { Badge, Spinner } from "../components/ui";

type LinuxApp = { id: string; name: string; pkg: string; note: string };

const LINUX_APPS: LinuxApp[] = [
  { id: "chrome", name: "Google Chrome", pkg: "google-chrome-stable", note: "adds Google's signed repository" },
  { id: "chromium", name: "Chromium", pkg: "chromium", note: "open source browser, Debian archive" },
  { id: "firefox", name: "Firefox ESR", pkg: "firefox-esr", note: "Debian archive" },
  { id: "vlc", name: "VLC", pkg: "vlc", note: "media player, Debian archive" },
  { id: "libreoffice", name: "LibreOffice", pkg: "libreoffice", note: "office suite, Debian archive" },
  { id: "gimp", name: "GIMP", pkg: "gimp", note: "image editor, Debian archive" },
  { id: "flatpak", name: "Flatpak + Flathub", pkg: "flatpak", note: "store for thousands of GUI apps" },
];

const WINDOWS_APPS = [
  { name: "Google Chrome", url: "https://www.google.com/chrome/", note: "installs into Windows, appears in this taskbar" },
  { name: "Firefox", url: "https://www.mozilla.org/firefox/new/", note: "Mozilla's official page" },
  { name: "Visual Studio Code", url: "https://code.visualstudio.com/download", note: "Microsoft, Windows installer" },
  { name: "VLC", url: "https://www.videolan.org/vlc/download-windows.html", note: "media player for Windows" },
  { name: "7-Zip", url: "https://www.7-zip.org/download.html", note: "archiver for Windows" },
];

export default function SoftwareApp() {
  const { notify } = useShell();
  const { status } = useVmStatus(4000);
  const [tab, setTab] = useState<"linux" | "windows">("linux");
  const [agent, setAgent] = useState<{ connected: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [output, setOutput] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const running = status?.state === "running";

  async function checkAgent() {
    setChecking(true);
    try {
      const s = await api.guestStatus();
      setAgent({ connected: s.connected, message: s.message });
    } catch (e) {
      setAgent({ connected: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (running) void checkAgent();
    else setAgent({ connected: false, message: "the Linux machine is not running" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  async function install(app: LinuxApp) {
    setInstalling(app.id);
    setOutput(null);
    try {
      const res = await api.linuxAppInstall(app.id);
      const text = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
      setOutput({ id: app.id, ok: res.exitCode === 0, text: text || `exit code ${res.exitCode}` });
      if (res.exitCode === 0) notify(`${app.name} installed`, "The package is available inside the Linux desktop.", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOutput({ id: app.id, ok: false, text: msg });
      notify("Installation failed", msg, "error");
    } finally {
      setInstalling(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#070b12]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab("linux")}
            className={`rounded-md px-2.5 py-1.5 text-[11px] transition ${
              tab === "linux"
                ? "bg-[color:var(--oneos-accent)]/12 text-[color:var(--oneos-accent)]"
                : "text-oneos-muted hover:text-oneos-text"
            }`}
          >
            Linux apps
          </button>
          <button
            onClick={() => setTab("windows")}
            className={`rounded-md px-2.5 py-1.5 text-[11px] transition ${
              tab === "windows"
                ? "bg-[color:var(--oneos-accent)]/12 text-[color:var(--oneos-accent)]"
                : "text-oneos-muted hover:text-oneos-text"
            }`}
          >
            Windows apps
          </button>
        </div>
        <button
          onClick={() => void checkAgent()}
          className="flex items-center gap-1.5 rounded p-1.5 text-[10px] text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
          title="Re-check the Linux agent"
        >
          {checking ? <Spinner size={12} /> : <RefreshCw size={12} />} Linux agent
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "linux" ? (
          <>
            <div
              className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                agent?.connected
                  ? "border-oneos-ok/25 bg-oneos-ok/10 text-oneos-ok"
                  : "border-white/10 bg-white/[0.03] text-oneos-muted"
              }`}
            >
              {agent?.connected ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
              <span className="leading-relaxed">
                {agent?.connected
                  ? "Linux agent reachable. Installations run with apt inside the Debian machine."
                  : `Installations need the Linux machine running with the QEMU guest agent. ${agent?.message ?? ""}`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {LINUX_APPS.map((app) => (
                <div
                  key={app.id}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-white/10 to-white/[0.02]">
                      <Package size={15} strokeWidth={1.7} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-oneos-text">{app.name}</div>
                      <div className="truncate text-[10px] text-oneos-muted">{app.pkg}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] leading-relaxed text-oneos-muted">{app.note}</div>
                  <button
                    onClick={() => void install(app)}
                    disabled={!agent?.connected || installing !== null}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--oneos-accent)]/40 bg-[color:var(--oneos-accent)]/15 px-2 py-1.5 text-[11px] font-semibold text-[color:var(--oneos-accent)] transition hover:bg-[color:var(--oneos-accent)]/25 disabled:opacity-40"
                  >
                    {installing === app.id ? <Spinner size={12} /> : <Download size={12} />}
                    {installing === app.id ? "installing…" : "Install"}
                  </button>
                </div>
              ))}
            </div>

            {output ? (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
                  {output.ok ? (
                    <CheckCircle2 size={12} className="text-oneos-ok" />
                  ) : (
                    <CircleAlert size={12} className="text-oneos-danger" />
                  )}
                  <span className={output.ok ? "text-oneos-ok" : "text-oneos-danger"}>
                    {output.ok ? "completed" : "failed"}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-oneos-muted">
                    <TerminalSquare size={11} /> apt output
                  </span>
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-oneos-muted">
                  {output.text}
                </pre>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-oneos-muted">
              OneOS runs on your Windows installation, so Windows applications install
              normally. These buttons open the official download page in your browser;
              nothing is downloaded or installed silently.
            </div>
            <div className="space-y-1.5">
              {WINDOWS_APPS.map((app) => (
                <div
                  key={app.name}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-oneos-text">{app.name}</div>
                    <div className="truncate text-[10px] text-oneos-muted">{app.note}</div>
                  </div>
                  <Badge tone="neutral">windows</Badge>
                  <button
                    onClick={() =>
                      void api.openUrl(app.url).catch((e) =>
                        notify("Could not open the browser", e instanceof Error ? e.message : String(e), "error"),
                      )
                    }
                    className="flex items-center gap-1 rounded-md border border-white/10 bg-white/6 px-2 py-1 text-[10px] text-oneos-text transition hover:bg-white/12"
                  >
                    <ExternalLink size={11} /> download page
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
