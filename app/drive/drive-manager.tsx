"use client";

import { ArrowLeft, Download, File, Folder, FolderPlus, HardDrive, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import { uploadInChunks } from "../lib/upload-client";
import "./drive.css";

type Entry = { name: string; type: "file" | "folder"; size: number; modified: string };

export function DriveManager() {
  const { supabase, isAdmin, loading } = useSiteAuth();
  const [parts, setParts] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [progress, setProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const path = parts.join("/");

  const api = useCallback(async (url: string, options: RequestInit = {}) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Session expired. Please sign in again.");
    // The main site runs on Vercel; Drive files live on the web server.
    const origin = window.location.hostname === "labulubius.com" ? "https://drive.labulubius.com" : "";
    const response = await fetch(`${origin}${url}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${data.session.access_token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(`${body?.error ?? "Drive request failed."} (HTTP ${response.status})`);
    }
    return response;
  }, [supabase]);

  const reload = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingList(true);
    setListFailed(false);
    try {
      const response = await api(`/api/drive?path=${encodeURIComponent(path)}`);
      const data = await response.json() as { entries: Entry[] };
      setEntries(data.entries);
      setError("");
    } catch (failure) {
      setEntries([]);
      setListFailed(true);
      setError(failure instanceof Error ? failure.message : "Could not load files.");
    } finally { setLoadingList(false); }
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
      try {
        for (const file of Array.from(files)) {
          await uploadInChunks(api, "/api/drive/upload", file, path, (sent) => setProgress(`Uploading ${file.name}: ${Math.round(100 * sent / file.size)}%`));
        }
      } finally { setProgress(""); }
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
      // Pick the destination before the first await, while the click still has user activation.
      const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }> }).showSaveFilePicker;
      const target = picker ? await picker.call(window, { suggestedName: entry.name }) : null;
      if (!target && entry.size > 64 * 1024 ** 2) throw new Error("Large downloads require a browser with streaming file save support (Chrome or Edge).");
      const response = await api(`/api/drive/download?path=${encodeURIComponent([...parts, entry.name].join("/"))}`);
      if (target) {
        if (!response.body) throw new Error("Download stream unavailable.");
        await response.body.pipeTo(await target.createWritable());
      } else {
        const objectUrl = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = entry.name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    });
  }

  if (loading) return <section className="drive-view"><p>Checking account…</p></section>;
  if (!isAdmin) return <section className="drive-view" inert>
    <header className="drive-header">
      <div><p className="drive-eyebrow">PERSONAL WORKSPACE / ADMINISTRATOR</p><h1><HardDrive size={22} /> Private Drive</h1><p>Private files on this server · 5 GB total</p></div>
      <div className="drive-actions"><button type="button" disabled><FolderPlus size={16} /> New folder</button><button type="button" disabled><Upload size={16} /> Upload files</button></div>
    </header>
    <div className="drive-location"><button className="drive-back" type="button" disabled aria-label="Go to parent folder"><ArrowLeft size={17} /></button><nav className="drive-breadcrumbs" aria-label="Drive path"><button type="button" disabled>Drive</button></nav><button className="drive-refresh" type="button" disabled aria-label="Refresh files"><RefreshCw size={16} /></button></div>
  </section>;

  return (
    <section className="drive-view">
      <header className="drive-header">
        <div><p className="drive-eyebrow">PERSONAL WORKSPACE / ADMINISTRATOR</p><h1><HardDrive size={22} /> Private Drive</h1><p>Private files on this server · 5 GB total</p></div>
        <div className="drive-actions"><button onClick={createFolder} disabled={busy} type="button"><FolderPlus size={16} /> New folder</button><button onClick={() => fileInput.current?.click()} disabled={busy} type="button"><Upload size={16} /> Upload files</button><input ref={fileInput} type="file" multiple hidden onChange={(event) => upload(event.target.files)} /></div>
      </header>
      <div className="drive-location">
        <button className="drive-back" type="button" onClick={() => setParts(parts.slice(0, -1))} disabled={parts.length === 0} aria-label="Go to parent folder" title="Go to parent folder"><ArrowLeft size={17} /></button>
        <nav className="drive-breadcrumbs" aria-label="Drive path"><button type="button" onClick={() => setParts([])}>Drive</button>{parts.map((part, index) => <span key={index}> / <button type="button" onClick={() => setParts(parts.slice(0, index + 1))} aria-current={index === parts.length - 1 ? "location" : undefined}>{part}</button></span>)}</nav>
        <button className="drive-refresh" type="button" onClick={() => void reload()} disabled={loadingList || busy} aria-label="Refresh files" title="Refresh files"><RefreshCw size={16} /></button>
      </div>
      {progress && <p role="status">{progress}</p>}
      {error && <p className="drive-error" role="alert">{error}</p>}
      {loadingList ? <p className="drive-empty" role="status">Loading files…</p> : listFailed ? <p className="drive-empty">Could not load files. Check the error above and try Refresh files.</p> : entries.length === 0 ? <div className="drive-empty"><Folder size={28} /><strong>This folder is empty</strong><span>Use Upload files or New folder to get started.</span></div> :
        <div className="drive-list-wrap"><div className="drive-columns" aria-hidden="true"><span>Name</span><span>Size / type</span><span>Modified</span><span>Actions</span></div>
        <ul className="drive-list">{entries.map((entry) => <li key={entry.name}>
          <span className="drive-file-icon">{entry.type === "folder" ? <Folder size={21} /> : <File size={21} />}</span>
          {entry.type === "folder" ? <button className="drive-name" type="button" onClick={() => setParts([...parts, entry.name])}>{entry.name}</button> : <span className="drive-name">{entry.name}</span>}
          <span className="drive-detail">{entry.type === "file" ? `${(entry.size / 1024).toFixed(1)} KB` : "Folder"}</span>
          <span className="drive-detail">{new Date(entry.modified).toLocaleDateString()}</span>
          <span className="drive-row-actions">{entry.type === "file" && <button className="drive-icon-button" aria-label={`Download ${entry.name}`} title="Download" type="button" disabled={busy} onClick={() => download(entry)}><Download size={17} /></button>}
          <button className="drive-icon-button drive-delete" aria-label={`Delete ${entry.name}`} title="Delete" type="button" disabled={busy} onClick={() => remove(entry)}><Trash2 size={17} /></button></span>
        </li>)}</ul></div>}
    </section>
  );
}
