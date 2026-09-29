"use client";

import { Folder, FolderOpen, LayoutGrid, Pencil, Plus, Radio, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessibleDialog } from "../accessible-dialog";
import { useSiteAuth } from "../site-auth";
import type { ForumDirectory, ForumKind } from "../lib/forums-directory";

type Dialog = { kind: "category" | "source"; id?: string } | null;
const kindNames: Record<ForumKind, string> = { discourse: "Discourse forum", v2ex: "V2EX", hackernews: "Hacker News", stackexchange: "Stack Exchange", reddit: "Reddit", rss: "RSS / Atom" };

export function ForumsSidebar({ directory, activeCategory, activeSource }: { directory: ForumDirectory; activeCategory: string | null; activeSource: string | null }) {
  const router = useRouter();
  const { supabase, isAdmin } = useSiteAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sourceKind, setSourceKind] = useState<ForumKind>("discourse");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<string[] | null>(null);
  const selected = selection ?? directory.sources.filter((source) => source.selected).map((source) => source.id);
  const editedCategory = directory.categories.find((category) => category.id === dialog?.id);
  const editedSource = directory.sources.find((source) => source.id === dialog?.id);

  async function update(action: Record<string, unknown>) {
    if (!isAdmin || busy) return;
    setBusy(true); setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign in again.");
      const response = await fetch("/api/forums", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(action), cache: "no-store" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update communities.");
      setDialog(null); setSelection(null); router.refresh();
    } catch (failure) { setSelection(null); setError(failure instanceof Error ? failure.message : "Could not update communities."); }
    finally { setBusy(false); }
  }

  function openCategory(id: string | null) {
    if (id) setCollapsed((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
    router.push(id ? `/communities?category=${encodeURIComponent(id)}` : "/communities");
  }
  function openSource(id?: string) { setSourceKind(directory.sources.find((source) => source.id === id)?.kind || "discourse"); setDialog({ kind: "source", id }); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!dialog) return; const form = new FormData(event.currentTarget);
    if (dialog.kind === "category") await update({ action: dialog.id ? "renameCategory" : "createCategory", id: dialog.id, name: String(form.get("name") ?? "").trim() });
    else await update({ action: dialog.id ? "editSource" : "addSource", id: dialog.id, name: String(form.get("name") ?? "").trim(), categoryId: String(form.get("categoryId") ?? ""), kind: sourceKind,
      origin: String(form.get("origin") ?? "").trim(), view: String(form.get("view") ?? ""), site: String(form.get("site") ?? "").trim(), tags: String(form.get("tags") ?? "").trim(), subreddit: String(form.get("subreddit") ?? "").trim(), sort: String(form.get("sort") ?? ""), feedUrl: String(form.get("feedUrl") ?? "").trim() });
  }

  return <>
    <aside className="forums-sidebar" id="page-sidebar" aria-label="Community sources">
      <div className="forums-sidebar-heading"><h2>Communities</h2>{isAdmin && <button type="button" disabled={busy} onClick={() => setDialog({ kind: "category" })} title="Add category" aria-label="Add category"><Plus size={14} /></button>}</div>
      <div className="forums-category-row"><button type="button" className={!activeCategory && !activeSource ? "active" : ""} onClick={() => openCategory(null)}><LayoutGrid size={16} /><span>All discussions</span></button></div>
      <div className="forums-source-list">{directory.categories.map((category) => <section key={category.id}>
        <div className="forums-category-row"><button type="button" className={activeCategory === category.id ? "active" : ""} aria-expanded={!collapsed.includes(category.id)} onClick={() => openCategory(category.id)}>{collapsed.includes(category.id) ? <Folder size={16} /> : <FolderOpen size={16} />}<span title={category.name}>{category.name}</span></button>
          {isAdmin && <span className="forums-row-actions"><button type="button" disabled={busy} onClick={() => setDialog({ kind: "category", id: category.id })} aria-label={`Rename ${category.name}`} title={`Rename ${category.name}`}><Pencil size={12} /></button><button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete “${category.name}” and all its community sources?`)) void update({ action: "deleteCategory", id: category.id }); }} aria-label={`Delete ${category.name}`} title={`Delete ${category.name}`}><Trash2 size={12} /></button></span>}
        </div>
        {!collapsed.includes(category.id) && directory.sources.filter((source) => source.categoryId === category.id).map((source) => <div className="forums-source-row" key={source.id}>
          <label className="forums-source-check"><input type="checkbox" aria-label={`Include ${source.name} in all discussions`} checked={selected.includes(source.id)} disabled={!isAdmin || busy} onChange={() => { const next = selected.includes(source.id) ? selected.filter((id) => id !== source.id) : [...selected, source.id]; setSelection(next); void update({ action: "selectSources", selected: next }); }} /></label>
          <button className={`forums-source-name${activeSource === source.id ? " active" : ""}`} type="button" onClick={() => router.push(`/communities?source=${encodeURIComponent(source.id)}`)} title={`${source.name} · ${kindNames[source.kind]}`}>{source.name}</button>
          {isAdmin && <span className="forums-row-actions"><button type="button" disabled={busy} onClick={() => openSource(source.id)} aria-label={`Edit ${source.name}`} title={`Edit ${source.name}`}><Pencil size={12} /></button><button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete “${source.name}”?`)) void update({ action: "deleteSource", id: source.id }); }} aria-label={`Delete ${source.name}`} title={`Delete ${source.name}`}><Trash2 size={12} /></button></span>}
        </div>)}
      </section>)}</div>
      {isAdmin && <><div className="forums-sidebar-heading forums-settings-heading"><h2>Settings</h2></div><button className="forums-add-source" type="button" disabled={busy || !directory.categories.length} onClick={() => openSource()}><Radio size={14} /> Community Sources <Plus size={12} /></button></>}
      {error && <p className="forums-sidebar-error" role="alert">{error}</p>}
    </aside>
    {dialog && <AccessibleDialog labelledBy="forums-dialog-title" busy={busy} onClose={() => setDialog(null)}>
        <header><h2 id="forums-dialog-title">{dialog.kind === "category" ? `${dialog.id ? "Rename" : "Add"} category` : `${dialog.id ? "Edit" : "Add"} community source`}</h2><button type="button" disabled={busy} onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></header>
        <form key={`${dialog.kind}-${dialog.id ?? "new"}`} onSubmit={(event) => void submit(event)}>
          <label>Name<input name="name" maxLength={dialog.kind === "category" ? 60 : 100} defaultValue={editedCategory?.name ?? editedSource?.name ?? ""} autoFocus required /></label>
          {dialog.kind === "source" && <>
            <label>Source type<select name="kind" value={sourceKind} onChange={(event) => setSourceKind(event.target.value as ForumKind)}>{Object.entries(kindNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></label>
            {sourceKind === "discourse" && <label>Forum origin<input name="origin" type="url" placeholder="https://forum.example.com" defaultValue={editedSource?.kind === "discourse" ? editedSource.origin : ""} required /></label>}
            {sourceKind === "hackernews" && <label>Feed<select name="view" defaultValue={editedSource?.view || "top"}><option value="top">Top stories</option><option value="new">New stories</option><option value="best">Best stories</option><option value="ask">Ask HN</option><option value="show">Show HN</option></select></label>}
            {sourceKind === "stackexchange" && <><label>Site<input name="site" placeholder="stackoverflow" defaultValue={editedSource?.site || "stackoverflow"} required /></label><label>Tags (optional, separated by semicolons)<input name="tags" placeholder="javascript;reactjs" defaultValue={editedSource?.tags || ""} /></label></>}
            {sourceKind === "reddit" && <><label>Subreddit<input name="subreddit" placeholder="selfhosted" defaultValue={editedSource?.subreddit || ""} required /></label><label>Feed<select name="sort" defaultValue={editedSource?.sort || "hot"}><option value="hot">Hot</option><option value="new">New</option><option value="top">Top</option></select></label></>}
            {sourceKind === "rss" && <label>RSS or Atom URL<input name="feedUrl" type="url" placeholder="https://example.com/community.xml" defaultValue={editedSource?.feedUrl || ""} required /></label>}
            {sourceKind === "v2ex" && <p className="forums-form-note">Uses the public V2EX latest topics feed.</p>}
            <label>Category<select name="categoryId" defaultValue={editedSource?.categoryId ?? activeCategory ?? directory.categories[0]?.id} required>{directory.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          </>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer><button type="button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button></footer>
        </form>
    </AccessibleDialog>}
  </>;
}
