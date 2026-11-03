import { useShell } from "../lib/shell";
import WindowFrame from "./WindowFrame";
import DisplaySession from "../vm/DisplaySession";
import TerminalApp from "../terminal/TerminalApp";
import FileManager from "../components/FileManager";
import SettingsApp from "../settings/SettingsApp";
import MonitorApp from "../vm/MonitorApp";
import AboutApp from "../components/AboutApp";
import SoftwareApp from "../components/SoftwareApp";

export default function WindowManager() {
  const { windows } = useShell();

  return (
    <>
      {windows.map((win) => (
        <WindowFrame key={win.id} win={win}>
          <div className="h-full w-full">
            {win.appId === "display" ? <DisplaySession /> : null}
            {win.appId === "terminal" ? <TerminalApp /> : null}
            {win.appId === "files" ? <FileManager /> : null}
            {win.appId === "software" ? <SoftwareApp /> : null}
            {win.appId === "settings" ? <SettingsApp /> : null}
            {win.appId === "monitor" ? <MonitorApp /> : null}
            {win.appId === "about" ? <AboutApp /> : null}
          </div>
        </WindowFrame>
      ))}
    </>
  );
}
