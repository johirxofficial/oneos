import { getCurrentWindow } from "@tauri-apps/api/window";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function windowAction(action: "minimize" | "maximize" | "close") {
  if (!inTauri()) {
    if (action === "close") window.close();
    return;
  }
  try {
    const win = getCurrentWindow();
    if (action === "minimize") await win.minimize();
    if (action === "maximize") await win.toggleMaximize();
    if (action === "close") await win.close();
  } catch {
    /* window controls are best-effort */
  }
}
