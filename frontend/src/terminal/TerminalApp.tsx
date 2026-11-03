import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";
import { CornerDownLeft, Eraser, TerminalSquare } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Spinner } from "../components/ui";

type Kind = "cmd" | "out" | "err" | "sys";

interface Line {
  id: number;
  kind: Kind;
  text: string;
}

let lineId = 0;

export default function TerminalApp() {
  const [cwd, setCwd] = useState("/root");
  const [lines, setLines] = useState<Line[]>([
    {
      id: lineId++,
      kind: "sys",
      text: "OneOS terminal. Commands run inside the Debian Linux machine through the QEMU agent.",
    },
    { id: lineId++, kind: "sys", text: "Type 'help' for local shell helpers, 'clear' to reset the view." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, busy]);

  function push(kind: Kind, text: string) {
    setLines((prev) => [...prev.slice(-400), { id: lineId++, kind, text }]);
  }

  async function submit(raw: string) {
    const cmd = raw.trim();
    if (!cmd || busy) return;
    setHistory((h) => [...h, cmd]);
    setHistIndex(-1);
    setInput("");
    push("cmd", cmd);

    if (cmd === "clear") {
      setLines([]);
      return;
    }
    if (cmd === "help") {
      push("sys", "local helpers: clear, cd <path>, pwd. Everything else is executed in Linux.");
      return;
    }

    setBusy(true);
    try {
      if (cmd === "cd" || cmd.startsWith("cd ")) {
        const target = cmd === "cd" ? "/root" : cmd.slice(3).trim();
        const res = await api.guestExec(`cd ${target} && pwd`, cwd);
        if (res.exitCode === 0 && res.stdout.trim()) {
          setCwd(res.stdout.trim().split("\n").pop() || cwd);
        } else if (res.stderr.trim()) {
          push("err", res.stderr.trimEnd());
        }
        return;
      }

      const res = await api.guestExec(cmd, cwd);
      if (res.stdout) push("out", res.stdout.replace(/\s+$/, ""));
      if (res.stderr) push("err", res.stderr.replace(/\s+$/, ""));
      if (res.exitCode !== 0 && !res.stdout && !res.stderr) {
        push("err", `exit code ${res.exitCode}`);
      }
    } catch (e) {
      push("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }

  function onKeyDown(e: RKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      void submit(input);
      return;
    }
    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const next = histIndex <= 0 ? history.length - 1 : histIndex - 1;
      setHistIndex(next);
      setInput(history[next]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIndex === -1) return;
      const next = histIndex + 1;
      if (next >= history.length) {
        setHistIndex(-1);
        setInput("");
      } else {
        setHistIndex(next);
        setInput(history[next]);
      }
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#05080e]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3">
        <div className="flex items-center gap-2 text-[11px] text-oneos-muted">
          <TerminalSquare size={13} />
          <span className="font-mono">linux shell</span>
          <Badge tone="accent">{cwd}</Badge>
        </div>
        <button
          onClick={() => setLines([])}
          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
        >
          <Eraser size={12} /> clear
        </button>
      </div>

      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        className="selectable min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.55]"
      >
        {lines.map((line) => (
          <div
            key={line.id}
            className={
              line.kind === "cmd"
                ? "mt-1 text-oneos-text"
                : line.kind === "err"
                  ? "whitespace-pre-wrap text-oneos-danger/90"
                  : line.kind === "sys"
                    ? "whitespace-pre-wrap text-oneos-muted"
                    : "whitespace-pre-wrap text-oneos-text/85"
            }
          >
            {line.kind === "cmd" ? (
              <span>
                <span className="text-oneos-ok">oneos</span>
                <span className="text-oneos-muted">@{cwd}</span>
                <span className="text-[color:var(--oneos-accent)]"> $ </span>
                {line.text}
              </span>
            ) : (
              line.text
            )}
          </div>
        ))}
        {busy ? (
          <div className="mt-1 flex items-center gap-2 text-oneos-muted">
            <Spinner size={11} /> running...
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] bg-black/40 px-3 py-2 font-mono text-[12px]">
        <span className="shrink-0 text-oneos-ok">oneos</span>
        <span className="max-w-[160px] truncate text-oneos-muted">@{cwd}</span>
        <span className="shrink-0 text-[color:var(--oneos-accent)]">$</span>
        <input
          ref={inputRef}
          value={input}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-oneos-text outline-none"
          placeholder={busy ? "waiting for Linux..." : "enter a command"}
          disabled={busy}
        />
        <button
          onClick={() => void submit(input)}
          disabled={busy || !input.trim()}
          className="rounded p-1 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text disabled:opacity-30"
          title="Run"
        >
          <CornerDownLeft size={13} />
        </button>
      </div>
    </div>
  );
}

