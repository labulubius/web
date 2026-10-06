"use client";

import { ArrowLeft, ArrowUp, Bot, ChevronRight, Copy, Download, File, FileText, Folder, FolderOpen, FolderPlus, Grid2X2, HardDrive, Info, Link2, List, MoreVertical, RefreshCw, Search, Trash2, Unlink, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import { useSiteAuth } from "../site-auth";
import { agentHandoffPath, pdfToEpubHandoff } from "../lib/agent-handoff";
import { uploadInChunks } from "../lib/upload-client";
import { OwnerAccess } from "../owner-access";
import "./drive.css";

type Entry = { name: string; type: "file" | "folder"; size: number; modified: string; shareId: string | null; path?: string };
type DriveMode = "files" | "links";
type ViewMode = "details" | "grid";
type SortKey = "name" | "size" | "modified";

type ConfirmState =
  | { kind: "delete"; entries: Entry[] }
  | { kind: "revoke"; entry: Entry }
  | null;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function entryIcon(entry: Entry) {
  if (entry.type === "folder") return <Folder size={20} />;
  if (entry.name.toLowerCase().endsWith(".pdf")) return <FileText size={20} />;
  return <File size={20} />;
}

export function DriveManager() {
  const { supabase, isAdmin, loading, authError, retryAuth } = useSiteAuth();
  const [parts, setParts] = useState<string[]>([]);
  const [mode, setMode] = useState<DriveMode>("files");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rootFolders, setRootFolders] = useState<string[]>([]);
  const [listedPath, setListedPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "name", direction: "asc" });
  const [view, setView] = useState<ViewMode>("details");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [infoOpen, setInfoOpen] = useState(true);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRequest = useRef<{ id: number; controller: AbortController } | null>(null);
  const path = parts.join("/");
  const pathRef = useRef(path);
  const modeRef = useRef(mode);
  useEffect(() => { pathRef.current = path; }, [path]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (window.localStorage.getItem("site-drive-view") === "grid") setView("grid");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const api = useCallback(async (url: string, options: RequestInit = {}) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Session expired. Please sign in again.");
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

  const reload = useCallback(async (targetPath = pathRef.current, targetMode = modeRef.current) => {
    if (!isAdmin) return;
    listRequest.current?.controller.abort();
    const request = { id: (listRequest.current?.id ?? 0) + 1, controller: new AbortController() };
    listRequest.current = request;
    setLoadingList(true);
    setListFailed(false);
    try {
      let nextEntries: Entry[];
      if (targetMode === "links") {
        const response = await api("/api/drive/shares", { signal: request.controller.signal });
        const data = await response.json() as { shares: Array<Entry & { path: string }> };
        nextEntries = data.shares.map((share) => ({ ...share, type: "file", shareId: share.shareId ?? null }));
      } else {
        const response = await api(`/api/drive?path=${encodeURIComponent(targetPath)}`, { signal: request.controller.signal });
        const data = await response.json() as { entries: Entry[] };
        nextEntries = data.entries;
        if (!targetPath) setRootFolders(data.entries.filter((entry) => entry.type === "folder").map((entry) => entry.name));
      }
      if (listRequest.current?.id !== request.id || request.controller.signal.aborted) return;
      setEntries(nextEntries);
      setListedPath(targetMode === "files" ? targetPath : "");
      setSelected(new Set());
      setMenuKey(null);
      setError("");
    } catch (failure) {
      if (listRequest.current?.id !== request.id || request.controller.signal.aborted) return;
      setEntries([]);
      setListedPath(targetMode === "files" ? targetPath : "");
      setListFailed(true);
      setError(failure instanceof Error ? failure.message : "Could not load files.");
    } finally {
      if (listRequest.current?.id === request.id) setLoadingList(false);
    }
  }, [api, isAdmin]);

  useEffect(() => { const timer = window.setTimeout(() => void reload(path, mode), 0); return () => window.clearTimeout(timer); }, [mode, path, reload]);
  useEffect(() => () => listRequest.current?.controller.abort(), []);

  async function run(task: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); await reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Drive operation failed."); }
    finally { setBusy(false); }
  }

  function entryPath(entry: Entry) {
    return entry.path ?? [listedPath, entry.name].filter(Boolean).join("/");
  }
  function entryKey(entry: Entry) { return entryPath(entry); }
  function publicUrl(id: string) { return new URL(`/drive/file/${id}`, window.location.origin).href; }

  async function copyPublicLink(id: string) {
    const url = publicUrl(id);
    try { await navigator.clipboard.writeText(url); setMessage("Public link copied to the clipboard."); }
    catch { window.prompt("Copy this public link:", url); setMessage("Public link is ready to copy."); }
  }

  function createShare(entry: Entry) {
    if (entry.type !== "file") return;
    void run(async () => {
      const response = await api("/api/drive/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: entryPath(entry) }) });
      const data = await response.json() as { share: { id: string } };
      await copyPublicLink(data.share.id);
    });
  }

  function revokeShare(entry: Entry) {
    if (entry.shareId) setConfirm({ kind: "revoke", entry });
  }

  function submitFolder() {
    const name = folderName.trim();
    if (!name) return;
    setFolderDialog(false); setFolderName("");
    void run(async () => { await api("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, name }) }); });
  }

  function upload(files: FileList | null) {
    if (!files?.length || mode !== "files") return;
    void run(async () => {
      try {
        for (const file of Array.from(files)) await uploadInChunks(api, "/api/drive/upload", file, path, (sent) => setProgress(`Uploading ${file.name}: ${Math.round(100 * sent / file.size)}%`));
      } finally { setProgress(""); }
    });
    if (fileInput.current) fileInput.current.value = "";
  }

  function askDelete(items: Entry[]) { if (items.length) setConfirm({ kind: "delete", entries: items }); }

  async function confirmAction() {
    const action = confirm;
    if (!action) return;
    setConfirm(null);
    if (action.kind === "revoke") {
      await run(async () => {
        await api(`/api/drive/shares/${encodeURIComponent(action.entry.shareId!)}`, { method: "DELETE" });
        setMessage("Public link revoked.");
      });
      return;
    }
    await run(async () => {
      for (const entry of action.entries) await api("/api/drive", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: entryPath(entry) }) });
      setMessage(action.entries.length === 1 ? "Item deleted." : `${action.entries.length} items deleted.`);
    });
  }

  function sendToPdfToEpub(entry: Entry) {
    const remote = entryPath(entry);
    window.location.assign(new URL(agentHandoffPath(pdfToEpubHandoff("drive", remote, entry.name, entry.size)), window.location.origin));
  }

  function download(entry: Entry) {
    void run(async () => {
      const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }> }).showSaveFilePicker;
      const target = picker ? await picker.call(window, { suggestedName: entry.name }) : null;
      if (!target && entry.size > 64 * 1024 ** 2) throw new Error("Large downloads require a browser with streaming file save support (Chrome or Edge).");
      const response = await api(`/api/drive/download?path=${encodeURIComponent(entryPath(entry))}`);
      if (target) {
        if (!response.body) throw new Error("Download stream unavailable.");
        await response.body.pipeTo(await target.createWritable());
      } else {
        const objectUrl = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = entry.name; document.body.append(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    });
  }

  function navigate(next: string[]) { setMode("files"); setParts(next); setSearch(""); }
  function chooseView(next: ViewMode) { setView(next); window.localStorage.setItem("site-drive-view", next); }
  function toggleSort(key: SortKey) { setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); }
  function toggleEntry(entry: Entry, checked: boolean) {
    setSelected((current) => { const next = new Set(current); if (checked) next.add(entryKey(entry)); else next.delete(entryKey(entry)); return next; });
    setInfoOpen(true); setMenuKey(null);
  }

  const shownEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = query ? entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query)) : entries;
    return [...filtered].sort((a, b) => {
      if (mode === "files" && a.type !== b.type) return a.type === "folder" ? -1 : 1;
      const factor = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "size") return factor * (a.size - b.size || a.name.localeCompare(b.name));
      if (sort.key === "modified") return factor * (Date.parse(a.modified) - Date.parse(b.modified) || a.name.localeCompare(b.name));
      return factor * a.name.localeCompare(b.name);
    });
  }, [entries, mode, search, sort]);
  const selectedEntries = entries.filter((entry) => selected.has(entryKey(entry)));
  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const allShownSelected = shownEntries.length > 0 && shownEntries.every((entry) => selected.has(entryKey(entry)));

  if (loading) return <section className="drive-access-state"><p role="status">Checking account…</p></section>;
  if (authError) return <section className="drive-access-state"><p className="drive-error" role="alert">{authError}</p><button type="button" onClick={retryAuth}>Retry account check</button></section>;
  if (!isAdmin) return <OwnerAccess icon={<HardDrive size={28} />} title="Private Drive" description="Only the site owner can access and manage private files. Use Sign in in the top toolbar to continue." />;

  const rowActions = (entry: Entry) => <>
    {entry.type === "folder" ? <button type="button" onClick={() => navigate([...entryPath(entry).split("/")])}><FolderOpen size={15} /> Open</button> : <button type="button" onClick={() => download(entry)}><Download size={15} /> Download</button>}
    {entry.type === "file" && entry.name.toLowerCase().endsWith(".pdf") && <button type="button" onClick={() => sendToPdfToEpub(entry)}><Bot size={15} /> Convert to EPUB</button>}
    {entry.type === "file" && (entry.shareId ? <><button type="button" onClick={() => void copyPublicLink(entry.shareId!)}><Copy size={15} /> Copy public link</button><button type="button" onClick={() => revokeShare(entry)}><Unlink size={15} /> Revoke public link</button></> : <button type="button" onClick={() => createShare(entry)}><Link2 size={15} /> Create public link</button>)}
    <button className="drive-danger-action" type="button" onClick={() => askDelete([entry])}><Trash2 size={15} /> Delete</button>
  </>;

  return <section className="drive-workspace">
    <aside className="drive-sidebar" id="page-sidebar" aria-label="Drive navigation">
      <h2>Places</h2>
      <button className={mode === "files" && parts.length === 0 ? "selected" : ""} type="button" onClick={() => navigate([])} aria-current={mode === "files" && parts.length === 0 ? "page" : undefined}><HardDrive size={16} /><span>My Drive</span></button>
      <button className={mode === "links" ? "selected" : ""} type="button" onClick={() => { setMode("links"); setSearch(""); }} aria-current={mode === "links" ? "page" : undefined}><Link2 size={16} /><span>Public links</span></button>
      {rootFolders.length > 0 && <><h2>Folders</h2>{rootFolders.map((folder) => <button key={folder} className={mode === "files" && parts[0] === folder ? "selected" : ""} type="button" onClick={() => navigate([folder])} title={folder}><ChevronRight size={15} /><span>{folder}</span></button>)}</>}
      <div className="drive-storage"><strong>Storage</strong><span>5 GB total</span></div>
    </aside>

    <section className={`drive-browser${selectedEntry && infoOpen ? " has-info" : ""}`}>
      <header className="drive-toolbar">
        <div className="drive-nav-buttons"><button type="button" onClick={() => navigate(parts.slice(0, -1))} disabled={mode !== "files" || !parts.length} aria-label="Go back" title="Go back"><ArrowLeft size={17} /></button><button type="button" onClick={() => navigate(parts.slice(0, -1))} disabled={mode !== "files" || !parts.length} aria-label="Go to parent folder" title="Go to parent folder"><ArrowUp size={17} /></button></div>
        <nav className="drive-path" aria-label="Drive path">{mode === "links" ? <button type="button" aria-current="location">Public links</button> : <><button type="button" onClick={() => navigate([])}>Drive</button>{parts.map((part, index) => <span key={`${part}:${index}`}><ChevronRight size={13} /><button type="button" onClick={() => navigate(parts.slice(0, index + 1))} aria-current={index === parts.length - 1 ? "location" : undefined}>{part}</button></span>)}</>}</nav>
        <label className="drive-search"><Search size={15} /><span className="sr-only">Search this view</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this view" /></label>
        <div className="drive-toolbar-actions">{mode === "files" && <><button type="button" onClick={() => setFolderDialog(true)} disabled={busy} aria-label="New folder" title="New folder"><FolderPlus size={16} /><span>New</span></button><button type="button" onClick={() => fileInput.current?.click()} disabled={busy} aria-label="Upload files" title="Upload files"><Upload size={16} /><span>Upload</span></button><input ref={fileInput} type="file" multiple hidden onChange={(event) => upload(event.target.files)} /></>}<button className={view === "details" ? "active" : ""} type="button" onClick={() => chooseView("details")} aria-label="Details view" title="Details view"><List size={17} /></button><button className={view === "grid" ? "active" : ""} type="button" onClick={() => chooseView("grid")} aria-label="Grid view" title="Grid view"><Grid2X2 size={17} /></button><button type="button" onClick={() => void reload()} disabled={loadingList || busy} aria-label="Refresh files" title="Refresh files"><RefreshCw size={16} /></button></div>
      </header>

      {selectedEntries.length > 0 && <div className="drive-selection-bar"><strong>{selectedEntries.length} {selectedEntries.length === 1 ? "item" : "items"} selected</strong>{selectedEntry?.type === "file" && <button type="button" onClick={() => download(selectedEntry)}><Download size={15} /> Download</button>}{selectedEntry?.type === "file" && (selectedEntry.shareId ? <button type="button" onClick={() => void copyPublicLink(selectedEntry.shareId!)}><Copy size={15} /> Copy link</button> : <button type="button" onClick={() => createShare(selectedEntry)}><Link2 size={15} /> Public link</button>)}<button type="button" onClick={() => setInfoOpen(true)} disabled={!selectedEntry}><Info size={15} /> Information</button><button className="drive-danger-action" type="button" onClick={() => askDelete(selectedEntries)}><Trash2 size={15} /> Delete</button></div>}

      <div className="drive-feedback" aria-live="polite">{progress && <p role="status">{progress}</p>}{message && <p className="drive-notice" role="status">{message}</p>}{error && <p className="drive-error" role="alert">{error}</p>}</div>

      <div className="drive-content">
        <section className="drive-items" aria-label={mode === "links" ? "Public links" : "Files"}>
          {loadingList ? <div className="drive-empty" role="status">Loading files…</div> : listFailed ? <div className="drive-empty"><strong>Could not load files</strong><span>Check the error above and try Refresh files.</span></div> : shownEntries.length === 0 ? <div className="drive-empty"><Folder size={28} /><strong>{search ? "No matching items" : mode === "links" ? "No public links" : "This folder is empty"}</strong><span>{search ? "Try a different search." : mode === "links" ? "Create a public link from a file in My Drive." : "Use Upload or New to get started."}</span></div> : view === "details" ? <div className="drive-details-wrap"><div className="drive-columns"><input type="checkbox" checked={allShownSelected} onChange={(event) => setSelected(event.target.checked ? new Set(shownEntries.map(entryKey)) : new Set())} aria-label="Select all visible items" /><span aria-hidden="true" /><button type="button" onClick={() => toggleSort("name")}>Name {sort.key === "name" ? sort.direction === "asc" ? "↑" : "↓" : ""}</button><button type="button" onClick={() => toggleSort("size")}>Size {sort.key === "size" ? sort.direction === "asc" ? "↑" : "↓" : ""}</button><button type="button" onClick={() => toggleSort("modified")}>Modified {sort.key === "modified" ? sort.direction === "asc" ? "↑" : "↓" : ""}</button><span>Public link</span><span>Actions</span></div><ul className="drive-list">{shownEntries.map((entry) => { const key = entryKey(entry); const checked = selected.has(key); return <li key={key} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} onChange={(event) => toggleEntry(entry, event.target.checked)} aria-label={`Select ${entry.name}`} /><span className={`drive-file-icon ${entry.type}`}>{entryIcon(entry)}</span>{entry.type === "folder" ? <button className="drive-name" type="button" onClick={() => navigate(entryPath(entry).split("/"))} title={entry.name}>{entry.name}</button> : <button className="drive-name" type="button" onClick={() => toggleEntry(entry, !checked)} title={entry.name}>{entry.name}</button>}<span className="drive-detail drive-size">{entry.type === "file" ? formatSize(entry.size) : "Folder"}</span><span className="drive-detail drive-modified">{new Date(entry.modified).toLocaleDateString()}</span><span className={`drive-link-state${entry.shareId ? " linked" : ""}`}>{entry.shareId ? <><Link2 size={13} /> Linked</> : "—"}</span><span className="drive-menu-wrap"><button className="drive-more" type="button" onClick={() => setMenuKey(menuKey === key ? null : key)} aria-expanded={menuKey === key} aria-label={`Actions for ${entry.name}`} title="Actions"><MoreVertical size={17} /></button>{menuKey === key && <span className="drive-menu" role="menu">{rowActions(entry)}</span>}</span></li>; })}</ul></div> : <ul className="drive-grid">{shownEntries.map((entry) => { const key = entryKey(entry); const checked = selected.has(key); return <li key={key} className={checked ? "selected" : ""}><label><input type="checkbox" checked={checked} onChange={(event) => toggleEntry(entry, event.target.checked)} /><span className={`drive-grid-icon ${entry.type}`}>{entryIcon(entry)}</span><strong title={entry.name}>{entry.name}</strong><small>{entry.type === "file" ? formatSize(entry.size) : "Folder"}</small>{entry.shareId && <span className="drive-grid-linked" title="Public link active"><Link2 size={14} /></span>}</label></li>; })}</ul>}
        </section>

        {selectedEntry && infoOpen && <aside className="drive-info" aria-label="File information"><header><h2>Information</h2><button type="button" onClick={() => setInfoOpen(false)} aria-label="Close information panel" title="Close"><X size={17} /></button></header><div className="drive-info-body"><div className={`drive-info-icon ${selectedEntry.type}`}>{entryIcon(selectedEntry)}</div><h3>{selectedEntry.name}</h3><p>{selectedEntry.type === "file" ? `${formatSize(selectedEntry.size)} file` : "Folder"}</p><dl><dt>Modified</dt><dd>{new Date(selectedEntry.modified).toLocaleString()}</dd><dt>Location</dt><dd>{entryPath(selectedEntry)}</dd><dt>Access</dt><dd>{selectedEntry.shareId ? "Anyone with the link can download" : "Private"}</dd></dl>{selectedEntry.type === "file" && <section className="drive-info-links"><h4>Public link</h4>{selectedEntry.shareId ? <><div><input value={publicUrl(selectedEntry.shareId)} readOnly aria-label="Public link" /><button type="button" onClick={() => void copyPublicLink(selectedEntry.shareId!)}>Copy</button></div><button className="drive-danger-action" type="button" onClick={() => revokeShare(selectedEntry)}><Unlink size={15} /> Revoke public link</button></> : <button type="button" onClick={() => createShare(selectedEntry)}><Link2 size={15} /> Create public link</button>}</section>}<div className="drive-info-actions">{selectedEntry.type === "folder" ? <button type="button" onClick={() => navigate(entryPath(selectedEntry).split("/"))}><FolderOpen size={15} /> Open</button> : <><button type="button" onClick={() => download(selectedEntry)}><Download size={15} /> Download</button>{selectedEntry.name.toLowerCase().endsWith(".pdf") && <button type="button" onClick={() => sendToPdfToEpub(selectedEntry)}><Bot size={15} /> Convert to EPUB</button>}</>}<button className="drive-danger-action" type="button" onClick={() => askDelete([selectedEntry])}><Trash2 size={15} /> Delete</button></div></div></aside>}
      </div>
    </section>

    {folderDialog && <AccessibleDialog labelledBy="drive-folder-title" onClose={() => { setFolderDialog(false); setFolderName(""); }} busy={busy} className="drive-dialog"><header><h2 id="drive-folder-title">New folder</h2><button type="button" onClick={() => { setFolderDialog(false); setFolderName(""); }} aria-label="Close new folder dialog" title="Close"><X size={17} /></button></header><form onSubmit={(event) => { event.preventDefault(); submitFolder(); }}><label>Folder name<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={255} /></label><footer><button type="button" onClick={() => { setFolderDialog(false); setFolderName(""); }}>Cancel</button><button className="drive-primary-action" type="submit" disabled={!folderName.trim() || busy}>Create</button></footer></form></AccessibleDialog>}

    {confirm && <AccessibleDialog labelledBy="drive-confirm-title" onClose={() => setConfirm(null)} busy={busy} className="drive-dialog"><header><h2 id="drive-confirm-title">{confirm.kind === "revoke" ? "Revoke public link?" : "Delete permanently?"}</h2><button type="button" onClick={() => setConfirm(null)} aria-label="Close confirmation" title="Close"><X size={17} /></button></header><div className="drive-confirm-copy">{confirm.kind === "revoke" ? <p>Anyone using the public link for <strong>{confirm.entry.name}</strong> will lose access.</p> : <p>{confirm.entries.length === 1 ? <><strong>{confirm.entries[0].name}</strong> will be permanently deleted.</> : <><strong>{confirm.entries.length} items</strong> will be permanently deleted.</>} This cannot be undone.</p>}</div><footer><button type="button" onClick={() => setConfirm(null)}>Cancel</button><button className="drive-destructive-button" type="button" onClick={() => void confirmAction()}>{confirm.kind === "revoke" ? "Revoke link" : "Delete"}</button></footer></AccessibleDialog>}
  </section>;
}
