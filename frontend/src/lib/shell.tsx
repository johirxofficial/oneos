import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { AppId, HostInfo, SessionInfo, WindowState } from "./types";

export type Phase = "boot" | "setup" | "login" | "locked" | "desktop";

export interface Notification {
  id: string;
  title: string;
  body: string;
  level: "info" | "success" | "warn" | "error";
  at: number;
}

interface AppMeta {
  id: AppId;
  title: string;
  width: number;
  height: number;
}

export const APP_META: Record<AppId, AppMeta> = {
  display: { id: "display", title: "Linux Desktop", width: 1000, height: 660 },
  terminal: { id: "terminal", title: "Terminal", width: 760, height: 500 },
  files: { id: "files", title: "Files", width: 860, height: 560 },
  software: { id: "software", title: "Software", width: 780, height: 560 },
  settings: { id: "settings", title: "Settings", width: 820, height: 580 },
  monitor: { id: "monitor", title: "System Monitor", width: 720, height: 540 },
  about: { id: "about", title: "About OneOS", width: 520, height: 460 },
};

interface ShellValue {
  phase: Phase;
  setPhase: (p: Phase) => void;
  host: HostInfo | null;
  session: SessionInfo | null;
  setSession: (s: SessionInfo) => void;
  lock: () => void;
  settings: Record<string, string>;
  setSetting: (key: string, value: string) => Promise<void>;
  windows: WindowState[];
  openWindow: (appId: AppId) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number, x?: number, y?: number) => void;
  activeId: string | null;
  notifications: Notification[];
  notify: (title: string, body: string, level?: Notification["level"]) => void;
  dismiss: (id: string) => void;
  clearNotifications: () => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside ShellProvider");
  return ctx;
}

let zCounter = 10;

export function ShellProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [host, setHost] = useState<HostInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    api.hostInfo().then(setHost).catch(() => undefined);
    api.sessionInfo().then(setSession).catch(() => undefined);
    api
      .settingsAll()
      .then((all) => {
        setSettings(all);
        const accent = all["accent"];
        if (accent && /^#[0-9a-f]{6}$/i.test(accent)) {
          document.documentElement.style.setProperty("--oneos-accent", accent);
        }
      })
      .catch(() => undefined);
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback(
    (title: string, body: string, level: Notification["level"] = "info") => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setNotifications((prev) => [...prev.slice(-4), { id, title, body, level, at: Date.now() }]);
      const timer = window.setTimeout(() => dismiss(id), 6000);
      timers.current.push(timer);
    },
    [dismiss],
  );

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const focusWindow = useCallback((id: string) => {
    zCounter += 1;
    const z = zCounter;
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, z, minimized: false } : w)));
    setActiveId(id);
  }, []);

  const openWindow = useCallback((appId: AppId) => {
    const meta = APP_META[appId];
    setWindows((prev) => {
      const existing = prev.find((w) => w.appId === appId);
      if (existing) {
        zCounter += 1;
        setActiveId(existing.id);
        return prev.map((w) =>
          w.id === existing.id ? { ...w, minimized: false, z: zCounter } : w,
        );
      }
      const count = prev.length;
      const offset = (count % 6) * 28;
      zCounter += 1;
      const id = `${appId}-${Date.now()}`;
      setActiveId(id);
      return [
        ...prev,
        {
          id,
          appId,
          title: meta.title,
          x: 96 + offset,
          y: 74 + offset,
          width: meta.width,
          height: meta.height,
          minimized: false,
          maximized: false,
          z: zCounter,
        },
      ];
    });
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w)),
    );
  }, []);

  const moveWindow = useCallback((id: string, x: number, y: number) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }, []);

  const resizeWindow = useCallback(
    (id: string, width: number, height: number, x?: number, y?: number) => {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, width, height, x: x ?? w.x, y: y ?? w.y }
            : w,
        ),
      );
    },
    [],
  );

  const setSetting = useCallback(async (key: string, value: string) => {
    await api.settingSet(key, value);
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (key === "accent" && /^#[0-9a-f]{6}$/i.test(value)) {
      document.documentElement.style.setProperty("--oneos-accent", value);
    }
  }, []);

  const clearNotifications = useCallback(() => setNotifications([]), []);

  const lock = useCallback(() => {
    setNotifications([]);
    setPhase("locked");
  }, []);

  const value = useMemo<ShellValue>(
    () => ({
      phase,
      setPhase,
      host,
      session,
      setSession,
      lock,
      settings,
      setSetting,
      windows,
      openWindow,
      closeWindow,
      focusWindow,
      minimizeWindow,
      toggleMaximize,
      moveWindow,
      resizeWindow,
      activeId,
      notifications,
      notify,
      dismiss,
      clearNotifications,
    }),
    [
      phase,
      host,
      session,
      lock,
      settings,
      setSetting,
      windows,
      openWindow,
      closeWindow,
      focusWindow,
      minimizeWindow,
      toggleMaximize,
      moveWindow,
      resizeWindow,
      activeId,
      notifications,
      notify,
      dismiss,
      clearNotifications,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
