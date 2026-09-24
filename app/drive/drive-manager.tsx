"use client";

import { Download, File, Folder, FolderPlus, HardDrive, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import "./drive.css";

type Entry = { name: string; type: "file" | "folder"; size: number; modified: string };

export function DriveManager() {
  const { supabase, isAdmin, loading } = useSiteAuth();
  const [parts, setParts] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const path = parts.join("/");

  const api = useCallback(async (url: string, options: RequestInit = {}) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Session expired. Please sign in again.");
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${data.session.access_token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? "Drive request failed.");
    }
    return response;
  }, [supabase]);

  const reload = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingList(true);
    try {
      const response = await api(`/api/drive?path=${encodeURIComponent(path)}`);
      const data = await response.json() as { entries: Entry[] };
      setEntries(data.entries);
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load files."); }
    finally { setLoadingList(false); }
  }, [api, isAdmin, path]);

  useEffect(() => { const timer = window.setTimeout(() => void reload(), 0); return () => window.clearTimeout(timer); }, [reload]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await task(); await reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Drive operation failed."); }
    finally { setBusy(false); }
  }

  function createFolder() {
    const name = window.prompt("New folder name:")?.trim();
    if (!name) return;
    void run(async () => {
      await api("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, name }) });
    });
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    void run(async () => {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} exceeds the 20 MB limit.`);
        const form = new FormData();
        form.set("path", path);
        form.set("file", file);
        await api("/api/drive/upload", { method: "POST", body: form });
      }
    });
    if (fileInput.current) fileInput.current.value = "";
  }

  function remove(entry: Entry) {
    if (!window.confirm(`Delete ${entry.type === "folder" ? "folder and everything inside" : "file"} “${entry.name}”? This cannot be undone.`)) return;
    void run(async () => {
      await api("/api/drive", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: [...parts, entry.name].join("/") }) });
    });
  }

  function download(entry: Entry) {
    void run(async () => {
      const response = await api(`/api/drive/download?path=${encodeURIComponent([...parts, entry.name].join("/"))}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = entry.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    });
  }

  if (loading) return <section className="drive-view"><p>Checking account…</p></section>;
  if (!isAdmin) return <section className="drive-view"><h1>Private Drive</h1><p>This drive is available only to the site administrator. Sign in to continue.</p></section>;

  return (
    <section className="drive-view">
      <header className="drive-header"><div><h1><HardDrive size={22} /> Private Drive</h1><p>Files are stored on this web server. Maximum 20 MB per file.</p></div>
        <div className="drive-actions"><button onClick={createFolder} disabled={busy} type="button"><FolderPlus size={16} /> New folder</button><button onClick={() => fileInput.current?.click()} disabled={busy} type="button"><Upload size={16} /> Upload</button><input ref={fileInput} type="file" multiple hidden onChange={(event) => upload(event.target.files)} /></div>
      </header>
      <nav className="drive-breadcrumbs" aria-label="Drive path"><button type="button" onClick={() => setParts([])}>Drive</button>{parts.map((part, index) => <span key={index}> / <button type="button" onClick={() => setParts(parts.slice(0, index + 1))}>{part}</button></span>)}</nav>
      {error && <p className="drive-error" role="alert">{error}</p>}
      {loadingList ? <p>Loading files…</p> : entries.length === 0 ? <p className="drive-empty">This folder is empty.</p> :
        <ul className="drive-list">{entries.map((entry) => <li key={entry.name}>
          <span className="drive-file-icon">{entry.type === "folder" ? <Folder size={21} /> : <File size={21} />}</span>
          {entry.type === "folder" ? <button className="drive-name" type="button" onClick={() => setParts([...parts, entry.name])}>{entry.name}</button> : <span className="drive-name">{entry.name}</span>}
          <span className="drive-detail">{entry.type === "file" ? `${(entry.size / 1024).toFixed(1)} KB` : "Folder"}</span>
          <span className="drive-detail">{new Date(entry.modified).toLocaleDateString()}</span>
          {entry.type === "file" && <button className="drive-icon-button" aria-label={`Download ${entry.name}`} title="Download" type="button" disabled={busy} onClick={() => download(entry)}><Download size={17} /></button>}
          <button className="drive-icon-button" aria-label={`Delete ${entry.name}`} title="Delete" type="button" disabled={busy} onClick={() => remove(entry)}><Trash2 size={17} /></button>
        </li>)}</ul>}
    </section>
  );
}
