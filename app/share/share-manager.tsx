"use client";
/* eslint-disable @next/next/no-img-element -- Thumbnails are already optimized on upload and served by the share host. */

import { Copy, Download, ExternalLink, File, Link2, RefreshCw, Share2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import "./share.css";

type Entry = { id: string; name: string; size: number; type: "image" | "file"; created: string };
const endpoint = "https://share.labulubius.com";

export function ShareManager() {
  const { supabase, isAdmin, loading } = useSiteAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);

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
    try {
      const response = await api("/api/share");
      const data = await response.json() as { entries: Entry[] };
      setEntries(data.entries);
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load shared files."); }
  }, [api, isAdmin]);

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
        }, body: file });
      }
      setMessage(`${selected.length} ${selected.length === 1 ? "file" : "files"} shared. Anyone with a link can access them.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Upload failed."); }
    finally { setBusy(false); setProgress(""); if (input.current) input.current.value = ""; await reload(); }
  }

  async function remove(entry: Entry) {
    if (!window.confirm(`Remove “${entry.name}” from Share? Its public link will stop working at the origin.`)) return;
    setBusy(true); setError(""); setMessage("");
    try { await api(`/api/share/${entry.id}`, { method: "DELETE" }); await reload(); setMessage("Public link removed."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete file."); }
    finally { setBusy(false); }
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setMessage(`${label} copied.`); setError(""); }
    catch { setError("Clipboard unavailable. Open the link and copy it from the address bar."); }
  }

  const visible = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (loading) return <section className="share-view"><p>Checking account…</p></section>;
  if (!isAdmin) return <section className="share-view"><h1>Public Share</h1><p>Only the site owner can manage shared files. Sign in to continue.</p></section>;

  return <section className="share-view">
    <header className="share-header">
      <div><p className="share-eyebrow">PERSONAL WORKSPACE / PUBLIC FILES</p><h1><Share2 size={20} /> Public Share</h1>
        <p>Files here are public to anyone with a link · 20 MB per file</p></div>
      <button type="button" className="share-button" onClick={() => input.current?.click()} disabled={busy}><Upload size={16} /> Upload files</button>
      <input type="file" ref={input} multiple hidden onChange={(event) => void upload(event.target.files)} />
    </header>
    <div className="share-toolbar">
      <label>Search shared files <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name…" /></label>
      <span>{entries.length} files · {(entries.reduce((sum, item) => sum + item.size, 0) / (1024 * 1024)).toFixed(1)} MB used</span>
      <button type="button" title="Refresh" aria-label="Refresh files" onClick={() => void reload()} disabled={busy}><RefreshCw size={16} /></button>
    </div>
    {progress && <p className="share-notice" role="status">{progress}</p>}
    {message && <p className="share-notice" role="status">{message}</p>}
    {error && <p className="share-error" role="alert">{error}</p>}
    {visible.length === 0 ? <div className="share-empty"><Share2 size={48} strokeWidth={1.2} /><strong>{search ? "No matching files" : "Nothing shared yet"}</strong><span>{search ? "Try another search." : "Upload a file to create your first public link."}</span></div> :
      <ul className="share-grid">{visible.map((entry) => {
        const url = `${endpoint}/f/${entry.id}`;
        return <li key={entry.id} className="share-card">
          <div className="share-preview">{entry.type === "image" ? <img src={`${url}?thumb`} alt="" loading="lazy" /> : <span className="share-file-icon"><File size={40} strokeWidth={1.35} /></span>}</div>
          <div className="share-card-body"><strong title={entry.name}>{entry.name}</strong><span>{entry.type === "image" ? "Image" : "Download"} · {(entry.size / 1024).toFixed(1)} KB · {new Date(entry.created).toLocaleDateString()}</span>
            <div className="share-card-actions">
              <button type="button" onClick={() => void copy(url, "Link")} title="Copy public link"><Link2 size={15} /> Link</button>
              {entry.type === "image" && <button type="button" onClick={() => void copy(`![${entry.name}](${url})`, "Markdown")} title="Copy Markdown image"><Copy size={15} /> MD</button>}
              <a href={url} target="_blank" rel="noopener noreferrer" title={entry.type === "image" ? "Open image" : "Download file"}>{entry.type === "image" ? <ExternalLink size={14} /> : <Download size={14} />}<span className="sr-only">Open {entry.name}</span></a>
              <button type="button" className="share-remove" onClick={() => void remove(entry)} disabled={busy} title="Remove public file" aria-label={`Remove ${entry.name}`}><Trash2 size={14} /></button>
            </div>
          </div>
        </li>;
      })}</ul>}
  </section>;
}
