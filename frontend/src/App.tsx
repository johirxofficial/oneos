import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { ShellProvider, useShell } from "./lib/shell";
import Boot from "./pages/Boot";
import Login from "./pages/Login";
import LockScreen from "./pages/LockScreen";
import Setup from "./pages/Setup";
import DesktopPage from "./pages/DesktopPage";

function Root() {
  const { phase, setPhase, settings, setSession } = useShell();
  const [bootFinished, setBootFinished] = useState(false);
  const [wasDesktop, setWasDesktop] = useState(false);

  useEffect(() => {
    if (phase === "boot" && settings["boot.splash"] === "false") {
      setBootFinished(true);
      void afterBoot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, settings["boot.splash"]]);

  useEffect(() => {
    if (phase === "desktop") setWasDesktop(true);
  }, [phase]);

  async function afterBoot() {
    try {
      const cfg = await api.vmConfig();
      if (!cfg) {
        setPhase("setup");
        return;
      }
      const session = await api.sessionInfo().catch(() => null);
      if (session) setSession(session);
      // A PIN plus "lock on start" means the shell opens on the lock screen.
      setPhase(session?.pinSet && session.lockOnStart ? "locked" : "login");
    } catch {
      setPhase("setup");
    }
  }

  return (
    <div className="h-full w-full">
      {phase === "boot" && !bootFinished ? (
        <Boot
          onDone={() => {
            setBootFinished(true);
            void afterBoot();
          }}
        />
      ) : null}

      {phase === "boot" && bootFinished ? <div className="h-full w-full bg-oneos-bg" /> : null}

      {phase === "setup" ? <Setup onDone={() => setPhase("desktop")} /> : null}

      {phase === "login" ? <Login onEnter={() => setPhase("desktop")} /> : null}

      {phase === "locked" ? (
        <LockScreen
          mode={wasDesktop ? "lock" : "login"}
          onUnlock={() => setPhase("desktop")}
        />
      ) : null}

      {phase === "desktop" ? <DesktopPage /> : null}
    </div>
  );
}

export default function App() {
  return (
    <ShellProvider>
      <Root />
    </ShellProvider>
  );
}
