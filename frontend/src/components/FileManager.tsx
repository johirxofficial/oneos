import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  HardDriveDownload,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { formatBytes, formatRelative } from "../lib/format";
import { useShell } from "../lib/shell";
import type { FileEntry } from "../lib/types";
import { Badge, Button, EmptyState, Spinner } from "./ui";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function FileManager() {
  const { notify } = useShell();
  const [path, setPath] = useState("/root");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ path: string; name: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stack = useRef<string[]>([]);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError("");
      try {
        const list = await api.listDir(target);
        setEntries(list);
        setSelected(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(path);
  }, [path, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  function navigate(next: string) {
    stack.current.push(path);
    setPath(next);
  }

  function goUp() {
    if (path === "/") return;
    const parent = path.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
    navigate(parent);
  }

  function goBack() {
    const prev = stack.current.pop();
    if (prev) setPath(prev);
  }

  async function createFolder() {
    const name = window.prompt("New folder name");
    if (!name) return;
    const target = `${path === "/" ? "" : path}/${name}`;
    try {
      await api.mkdir(target);
      notify("Folder created", target, "success");
      await load(path);
    } catch (e) {
      notify("Could not create folder", e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function removeEntry(entry: FileEntry) {
    if (!window.confirm(`Delete ${entry.path}? This cannot be undone.`)) return;
    try {
      await api.remove(entry.path);
      notify("Deleted", entry.path, "success");
      await load(path);
    } catch (e) {
      notify("Delete failed", e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function renameEntry(entry: FileEntry) {
    const next = window.prompt("Rename to", entry.name);
    if (!next || next === entry.name) return;
    const target = `${path === "/" ? "" : path}/${next}`;
    try {
      await api.rename(entry.path, target);
      await load(path);
    } catch (e) {
      notify("Rename failed", e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function openEntry(entry: FileEntry) {
    if (entry.isDir) {
      navigate(entry.path);
      return;
    }
    if (entry.size > 512 * 1024) {
      notify("File too large", "The editor opens files up to 512 KB.", "warn");
      return;
    }
    try {
      const content = await api.readText(entry.path, 512 * 1024);
      setEditor({ path: entry.path, name: entry.name, content });
    } catch (e) {
      notify("Could not open file", e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function saveEditor() {
    if (!editor) return;
    setSaving(true);
    try {
      await api.writeText(editor.path, editor.content);
      notify("Saved", editor.path, "success");
      setEditor(null);
      await load(path);
    } catch (e) {
      notify("Save failed", e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function exportSelected() {
    const entry = entries.find((e) => e.path === selected);
    if (!entry || entry.isDir) {
      notify("Nothing to export", "Select a file first.", "warn");
      return;
    }
    try {
      const dest = await api.exportFile(entry.path, entry.name);
      notify("Exported to Windows", dest, "success");
    } catch (e) {
      notify("Export failed", e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function importFile(file: File) {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      if (buffer.length > 64 * 1024 * 1024) {
        notify("File too large", "The import limit is 64 MB.", "warn");
        return;
      }
      const target = `${path === "/" ? "" : path}/${file.name}`;
      await api.writeBase64(target, toBase64(buffer));
      notify("Imported", `${file.name} -> ${target}`, "success");
      await load(path);
    } catch (e) {
      notify("Import failed", e instanceof Error ? e.message : String(e), "error");
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-[#070b12]">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-2">
        <button
          onClick={goBack}
          className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          onClick={goUp}
          className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
          title="Up one level"
        >
          <ArrowUp size={14} />
        </button>
        <button
          onClick={() => void load(path)}
          className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>

        <div className="mx-1 flex min-w-0 flex-1 items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-oneos-text/90">
          <HardDriveDownload size={12} className="text-oneos-muted" />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const value = path.trim() || "/";
                if (!value.startsWith("/")) setPath(`/${value}`);
                else void load(value);
              }
            }}
            className="w-full bg-transparent outline-none"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/25 px-2 py-1">
          <Search size={12} className="text-oneos-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter"
            className="w-24 bg-transparent text-[11px] text-oneos-text outline-none placeholder:text-oneos-muted/70"
          />
        </div>

        <button
          onClick={createFolder}
          className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
          title="New folder"
        >
          <FolderPlus size={14} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
          title="Import from Windows"
        >
          <Download size={14} />
        </button>
        <button
          onClick={() => void exportSelected()}
          className="rounded p-1.5 text-oneos-muted transition hover:bg-white/8 hover:text-oneos-text"
          title="Export selected file to Windows"
        >
          <ArrowUp size={14} className="rotate-45" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="band flex shrink-0 items-center gap-2 border-b border-white/[0.05] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-oneos-muted">
        <span className="flex-1">name</span>
        <span className="w-20 text-right">size</span>
        <span className="w-24 text-right">modified</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-oneos-muted">
            <Spinner size={14} /> reading Linux directory
          </div>
        ) : error ? (
          <EmptyState
            icon={<Folder size={26} />}
            title="Linux file system unavailable"
            detail={error}
            action={
              <Button onClick={() => void load(path)} variant="ghost">
                Try again
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Folder size={26} />} title="This folder is empty" />
        ) : (
          filtered.map((entry) => {
            const isSelected = selected === entry.path;
            return (
              <div
                key={entry.path}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => void openEntry(entry)}
                className={`group flex cursor-default items-center gap-2 border-b border-white/[0.03] px-3 py-1.5 text-[12px] transition ${
                  isSelected ? "bg-[color:var(--oneos-accent)]/12" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="shrink-0 text-oneos-muted">
                  {entry.isDir ? (
                    <Folder size={14} className="text-[color:var(--oneos-accent)]" />
                  ) : entry.name.endsWith(".txt") || entry.name.endsWith(".conf") || entry.name.endsWith(".md") ? (
                    <FileText size={14} />
                  ) : (
                    <FileIcon size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-oneos-text/90">{entry.name}</span>
                <span className="w-20 shrink-0 text-right font-mono text-[10px] text-oneos-muted">
                  {entry.isDir ? "-" : formatBytes(entry.size)}
                </span>
                <span className="w-24 shrink-0 text-right text-[10px] text-oneos-muted">
                  {formatRelative(entry.modified)}
                </span>
                <span className="flex w-14 shrink-0 justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void renameEntry(entry);
                    }}
                    className="rounded p-1 text-oneos-muted hover:bg-white/10 hover:text-oneos-text"
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeEntry(entry);
                    }}
                    className="rounded p-1 text-oneos-muted hover:bg-oneos-danger/15 hover:text-oneos-danger"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] px-3 text-[10px] text-oneos-muted">
        <span>
          {filtered.length} item{filtered.length === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-2">
          <Badge tone="neutral">linux</Badge>
          {selected ? <span className="max-w-[280px] truncate font-mono">{selected}</span> : null}
        </span>
      </div>

      {editor ? (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#05080e]/98 backdrop-blur">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={13} className="text-oneos-muted" />
              <span className="truncate font-mono text-[11px] text-oneos-text">{editor.path}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={() => void saveEditor()} disabled={saving}>
                {saving ? <Spinner size={12} /> : null} Save
              </Button>
              <button
                onClick={() => setEditor(null)}
                className="rounded p-1.5 text-oneos-muted hover:bg-white/8 hover:text-oneos-text"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <textarea
            value={editor.content}
            onChange={(e) => setEditor({ ...editor, content: e.target.value })}
            spellCheck={false}
            className="selectable min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12px] leading-relaxed text-oneos-text outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}
