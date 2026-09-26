"use client";

import { ArrowLeft, Copy, Download, ExternalLink, File, Folder, FolderPlus, Link2, RefreshCw, Share2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import "./share.css";

type Entry = { id: string; name: string; size: number; type: "image" | "file"; created: string; folderId?: string | null };
type ShareFolder = { id: string; name: string; parentId: string | null; created: string };
type Directory = { entries: Entry[]; folders: ShareFolder[]; breadcrumbs: ShareFolder[]; used: number };
const endpoint = "https://share.labulubius.com";

export function ShareManager() {
  const { supabase, isAdmin, loading } = useSiteAuth();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [directory, setDirectory] = useState<Directory>({ entries: [], folders: [], breadcrumbs: [], used: 0 });
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Session expired. Sign in again.");
    const response = await fetch(`${endpoint}${path}`, {
      ...init, cache: "no-store",
      headers: { ...init.headers, Authorization: `Bearer ${data.session.access_token}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed (HTTP ${response.status}).`);
    }
    return response;
  }, [supabase]);

  const reload = useCallback(async () => {
    if (!isAdmin) return;
    const current = ++requestId.current;
    setLoadingList(true);
    try {
      const response = await api(`/api/share${folderId ? `?folder=${encodeURIComponent(folderId)}` : ""}`);
      const result = await response.json() as Directory;
      if (current === requestId.current) { setDirectory(result); setError(""); }
    } catch (failure) { if (current === requestId.current) setError(failure instanceof Error ? failure.message : "Could not load shared files."); }
    finally { if (current === requestId.current) setLoadingList(false); }
  }, [api, isAdmin, folderId]);

  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(""); setMessage("");
    const selected = Array.from(files);
    try {
      for (const [index, file] of selected.entries()) {
        setProgress(`Uploading ${index + 1} of ${selected.length}: ${file.name}`);
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} exceeds the 20 MB limit.`);
        await api("/api/share", { method: "POST", headers: {
          "Content-Type": "application/octet-stream", "X-Share-Name": encodeURIComponent(file.name),
          ...(folderId ? { "X-Share-Folder": folderId } : {}),
        }, body: file });
      }
      setMessage(`${selected.length} ${selected.length === 1 ? "file" : "files"} shared. Anyone with a link can access them.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Upload failed."); }
    finally { setBusy(false); setProgress(""); if (input.current) input.current.value = ""; await reload(); }
  }

  async function createFolder() {
    const name = window.prompt("New folder name:")?.trim();
    if (!name) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId: folderId }) });
      await reload();
      setMessage("Folder created. Use its Link button to share it publicly.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create folder."); }
    finally { setBusy(false); }
  }

  async function removeFile(entry: Entry) {
    if (!window.confirm(`Remove “${entry.name}” from Share? Its public link will stop working at the origin.`)) return;
    setBusy(true); setError(""); setMessage("");
    try { await api(`/api/share/${entry.id}`, { method: "DELETE" }); await reload(); setMessage("Public link removed."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete file."); }
    finally { setBusy(false); }
  }

  async function removeFolder(folder: ShareFolder) {
    if (!window.confirm(`Delete “${folder.name}”, all nested folders and files? All their public links will stop working. This cannot be undone.`)) return;
    setBusy(true); setError(""); setMessage("");
    try { await api(`/api/share/folders/${folder.id}`, { method: "DELETE" }); await reload(); setMessage("Folder and contents removed; public links revoked."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete folder."); }
    finally { setBusy(false); }
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setMessage(`${label} copied.`); setError(""); }
    catch { setError("Clipboard unavailable. Open the link and copy it from the address bar."); }
  }

  const { folders, entries } = directory;
  if (loading) return <section className="share-view"><p>Checking account…</p></section>;
  if (!isAdmin) return <section className="share-view" inert>
    <header className="share-header"><div><p className="share-eyebrow">PERSONAL WORKSPACE / PUBLIC FILES</p><h1><Share2 size={22} /> Public Share</h1><p>Files here are public to anyone with a link · 20 MB per file</p></div><div className="share-header-actions"><button type="button" className="share-button" disabled><FolderPlus size={16} /> New folder</button><button type="button" className="share-button" disabled><Upload size={16} /> Upload files</button></div></header>
    <div className="share-location"><button className="share-back" type="button" disabled aria-label="Parent folder"><ArrowLeft size={17} /></button><nav className="share-breadcrumbs" aria-label="Share path"><button type="button" disabled>Share</button></nav><button className="share-refresh" type="button" disabled aria-label="Refresh files"><RefreshCw size={16} /></button></div>
  </section>;

  return <section className="share-view">
    <header className="share-header">
      <div><p className="share-eyebrow">PERSONAL WORKSPACE / PUBLIC FILES</p><h1><Share2 size={22} /> Public Share</h1>
        <p>Files and folders are public to anyone with a link · 20 MB per file</p></div>
      <div className="share-header-actions"><button type="button" className="share-button" onClick={() => void createFolder()} disabled={busy}><FolderPlus size={16} /> New folder</button>
        <button type="button" className="share-button" onClick={() => input.current?.click()} disabled={busy}><Upload size={16} /> Upload files</button></div>
      <input type="file" ref={input} multiple hidden onChange={(event) => void upload(event.target.files)} />
    </header>
    <div className="share-location">
      <button className="share-back" type="button" disabled={!folderId || busy} onClick={() => setFolderId(directory.breadcrumbs.at(-2)?.id ?? null)} title="Parent folder" aria-label="Parent folder"><ArrowLeft size={17} /></button>
      <nav className="share-breadcrumbs" aria-label="Share path"><button type="button" onClick={() => setFolderId(null)}>Share</button>{directory.breadcrumbs.map((folder) => <span key={folder.id}> / <button type="button" onClick={() => setFolderId(folder.id)} aria-current={folder.id === folderId ? "location" : undefined}>{folder.name}</button></span>)}</nav>
      <button className="share-refresh" type="button" title="Refresh files" aria-label="Refresh files" onClick={() => void reload()} disabled={busy || loadingList}><RefreshCw size={16} /></button>
    </div>
    {progress && <p className="share-notice" role="status">{progress}</p>}
    {message && <p className="share-notice" role="status">{message}</p>}
    {error && <p className="share-error" role="alert">{error}</p>}
    {loadingList ? <p className="share-empty" role="status">Loading folder…</p> : !folders.length && !entries.length ? <div className="share-empty"><Share2 size={29} /><strong>Nothing shared here yet</strong><span>Upload a file or create a folder to get started.</span></div> :
      <div className="share-list-wrap">
        <div className="share-columns" aria-hidden="true"><span>Name</span><span>Size / type</span><span>Created</span><span>Actions</span></div>
        <ul className="share-list">
          {folders.map((folder) => {
            const url = `${endpoint}/s/${folder.id}`;
            return <li key={folder.id}>
              <div className="share-row-name"><Folder size={21} /><button type="button" onClick={() => setFolderId(folder.id)} title={`Open ${folder.name}`}>{folder.name}</button></div>
              <span className="share-detail">Folder</span>
              <span className="share-detail">{new Date(folder.created).toLocaleDateString()}</span>
              <div className="share-row-actions">
                <button type="button" onClick={() => setFolderId(folder.id)} title="Open folder" aria-label={`Open ${folder.name}`}><Folder size={16} /></button>
                <button type="button" onClick={() => void copy(url, "Folder link")} title="Copy public folder link" aria-label={`Copy public link for ${folder.name}`}><Link2 size={16} /></button>
                <a href={url} target="_blank" rel="noopener noreferrer" title="View public folder" aria-label={`View public folder ${folder.name}`}><ExternalLink size={16} /></a>
                <button type="button" className="share-remove" onClick={() => void removeFolder(folder)} disabled={busy} title="Delete folder and contents" aria-label={`Delete ${folder.name}`}><Trash2 size={16} /></button>
              </div>
            </li>;
          })}
          {entries.map((entry) => {
            const url = `${endpoint}/f/${entry.id}`;
            return <li key={entry.id}>
              <div className="share-row-name"><File size={21} /><span title={entry.name}>{entry.name}</span></div>
              <span className="share-detail">{entry.type === "image" ? "Image" : "File"} · {(entry.size / 1024).toFixed(1)} KB</span>
              <span className="share-detail">{new Date(entry.created).toLocaleDateString()}</span>
              <div className="share-row-actions">
                <button type="button" onClick={() => void copy(url, "Link")} title="Copy public link" aria-label={`Copy public link for ${entry.name}`}><Link2 size={16} /></button>
                {entry.type === "image" && <button type="button" onClick={() => void copy(`![${entry.name}](${url})`, "Markdown")} title="Copy Markdown image" aria-label={`Copy Markdown image for ${entry.name}`}><Copy size={16} /></button>}
                <a href={url} target="_blank" rel="noopener noreferrer" title={entry.type === "image" ? "Open image" : "Download file"} aria-label={`${entry.type === "image" ? "Open" : "Download"} ${entry.name}`}>{entry.type === "image" ? <ExternalLink size={16} /> : <Download size={16} />}</a>
                <button type="button" className="share-remove" onClick={() => void removeFile(entry)} disabled={busy} title="Remove public file" aria-label={`Remove ${entry.name}`}><Trash2 size={16} /></button>
              </div>
            </li>;
          })}
        </ul>
      </div>}
  </section>;
}
