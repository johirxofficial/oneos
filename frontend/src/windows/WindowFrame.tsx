import { useCallback, useRef, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Maximize2, Minus, X } from "lucide-react";
import { useShell } from "../lib/shell";
import type { WindowState } from "../lib/types";

export default function WindowFrame({
  win,
  children,
}: {
  win: WindowState;
  children: ReactNode;
}) {
  const { focusWindow, minimizeWindow, toggleMaximize, closeWindow, moveWindow, resizeWindow, activeId } =
    useShell();
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);

  const onTitlePointerDown = useCallback(
    (e: RPointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
      focusWindow(win.id);
      if (win.maximized) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: win.x,
        originY: win.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [focusWindow, win.id, win.maximized, win.x, win.y],
  );

  const onTitlePointerMove = useCallback(
    (e: RPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const maxX = window.innerWidth - win.width - 8;
      const maxY = window.innerHeight - 96;
      const nextX = Math.min(Math.max(0, drag.originX + e.clientX - drag.startX), Math.max(0, maxX));
      const nextY = Math.min(Math.max(40, drag.originY + e.clientY - drag.startY), Math.max(40, maxY));
      moveWindow(win.id, nextX, nextY);
    },
    [moveWindow, win.id, win.width],
  );

  const onResizePointerDown = useCallback(
    (e: RPointerEvent) => {
      e.stopPropagation();
      focusWindow(win.id);
      resizeRef.current = { startX: e.clientX, startY: e.clientY, width: win.width, height: win.height };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [focusWindow, win.id, win.width, win.height],
  );

  const onResizePointerMove = useCallback(
    (e: RPointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const width = Math.max(420, r.width + e.clientX - r.startX);
      const height = Math.max(280, r.height + e.clientY - r.startY);
      resizeWindow(win.id, width, height);
    },
    [resizeWindow, win.id],
  );

  const active = activeId === win.id;

  return (
    <section
      style={{
        left: win.maximized ? 0 : win.x,
        top: win.maximized ? 40 : win.y,
        width: win.maximized ? "100%" : win.width,
        height: win.maximized ? "calc(100% - 40px)" : win.height,
        zIndex: win.z,
        display: win.minimized ? "none" : "flex",
      }}
      onPointerDown={() => focusWindow(win.id)}
      className={`absolute flex-col overflow-hidden rounded-xl border bg-[#070b12]/95 shadow-glass backdrop-blur-xl transition-shadow ${
        active ? "border-white/[0.14] shadow-[0_30px_80px_-24px_rgba(0,0,0,0.85)]" : "border-white/[0.08]"
      }`}
    >
      <header
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={() => (dragRef.current = null)}
        onDoubleClick={() => toggleMaximize(win.id)}
        className="flex h-9 shrink-0 cursor-default select-none items-center justify-between border-b border-white/[0.06] bg-white/[0.025] px-3"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              active ? "bg-[color:var(--oneos-accent)]" : "bg-oneos-muted/50"
            }`}
          />
          <span className="truncate text-[11px] font-medium tracking-wide text-oneos-text/90">
            {win.title}
          </span>
        </div>
        <div className="flex items-center gap-0.5" data-no-drag>
          <button
            onClick={() => minimizeWindow(win.id)}
            className="grid h-6 w-6 place-items-center rounded text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
            title="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={() => toggleMaximize(win.id)}
            className="grid h-6 w-6 place-items-center rounded text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
            title="Maximize"
          >
            <Maximize2 size={11} />
          </button>
          <button
            onClick={() => closeWindow(win.id)}
            className="grid h-6 w-6 place-items-center rounded text-oneos-muted transition hover:bg-oneos-danger/80 hover:text-white"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>

      {!win.maximized ? (
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={() => (resizeRef.current = null)}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          title="Resize"
        >
          <div className="absolute bottom-1 right-1 h-2 w-2 border-b border-r border-white/25" />
        </div>
      ) : null}
    </section>
  );
}

