"use client";

import { Folder, FolderOpen, LayoutGrid, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useSiteAuth } from "../site-auth";
import type { ForumDirectory } from "../lib/forums-directory";

type Dialog = { kind: "category" | "source"; id?: string } | null;

export function ForumsSidebar({ directory, activeCategory, activeSource }: { directory: ForumDirectory; activeCategory: string | null; activeSource: string | null }) {
  const router = useRouter();
  const { supabase, isAdmin } = useSiteAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
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
      const response = await fetch("/api/forums", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(action), cache: "no-store",
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update forums.");
      setDialog(null);
      setSelection(null);
      router.refresh();
    } catch (failure) {
      setSelection(null);
      setError(failure instanceof Error ? failure.message : "Could not update forums.");
    } finally { setBusy(false); }
  }

  function openCategory(id: string | null) {
    if (id) setCollapsed((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
    router.push(id ? `/forums?category=${encodeURIComponent(id)}` : "/forums");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    if (dialog.kind === "category") await update({ action: dialog.id ? "renameCategory" : "createCategory", id: dialog.id, name: String(form.get("name") ?? "").trim() });
    else await update({ action: dialog.id ? "editSource" : "addSource", id: dialog.id, name: String(form.get("name") ?? "").trim(), origin: String(form.get("origin") ?? "").trim(), categoryId: String(form.get("categoryId") ?? "") });
  }

  return <>
    <aside className="forums-sidebar" id="page-sidebar" aria-label="Forum sources">
      <div className="forums-sidebar-heading"><h2>Categories</h2>{isAdmin && <button type="button" disabled={busy} onClick={() => setDialog({ kind: "category" })} title="Add category" aria-label="Add category"><Plus size={14} /></button>}</div>
      <div className="forums-category-row"><button type="button" className={!activeCategory && !activeSource ? "active" : ""} onClick={() => openCategory(null)}><LayoutGrid size={16} />All</button></div>
      <div className="forums-source-list">{directory.categories.map((category) => <section key={category.id}>
        <div className="forums-category-row"><button type="button" className={activeCategory === category.id ? "active" : ""} aria-expanded={!collapsed.includes(category.id)} onClick={() => openCategory(category.id)}>{collapsed.includes(category.id) ? <Folder size={16} /> : <FolderOpen size={16} />}<span title={category.name}>{category.name}</span></button>
          {isAdmin && <span className="forums-row-actions"><button type="button" disabled={busy} onClick={() => setDialog({ kind: "category", id: category.id })} aria-label={`Rename ${category.name}`} title={`Rename ${category.name}`}><Pencil size={12} /></button><button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete “${category.name}” and all its forum sources?`)) void update({ action: "deleteCategory", id: category.id }); }} aria-label={`Delete ${category.name}`} title={`Delete ${category.name}`}><Trash2 size={12} /></button></span>}
        </div>
        {!collapsed.includes(category.id) && directory.sources.filter((source) => source.categoryId === category.id).map((source) => <div className="forums-source-row" key={source.id}>
          <label className="forums-source-check"><input type="checkbox" aria-label={`Include ${source.name} in all discussions`} checked={selected.includes(source.id)} disabled={!isAdmin || busy} onChange={() => { const next = selected.includes(source.id) ? selected.filter((id) => id !== source.id) : [...selected, source.id]; setSelection(next); void update({ action: "selectSources", selected: next }); }} /></label>
          <button className={`forums-source-name${activeSource === source.id ? " active" : ""}`} type="button" onClick={() => router.push(`/forums?source=${encodeURIComponent(source.id)}`)} title={source.name}>{source.name}</button>
          {isAdmin && <span className="forums-row-actions"><button type="button" disabled={busy} onClick={() => setDialog({ kind: "source", id: source.id })} aria-label={`Edit ${source.name}`} title={`Edit ${source.name}`}><Pencil size={12} /></button><button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete “${source.name}”?`)) void update({ action: "deleteSource", id: source.id }); }} aria-label={`Delete ${source.name}`} title={`Delete ${source.name}`}><Trash2 size={12} /></button></span>}
        </div>)}
      </section>)}</div>
      {isAdmin && <button className="forums-add-source" type="button" disabled={busy || !directory.categories.length} onClick={() => setDialog({ kind: "source" })}><Plus size={14} /> Add forum source</button>}
      {error && <p className="forums-sidebar-error" role="alert">{error}</p>}
    </aside>
    {dialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
      <section className="breeze-dialog" role="dialog" aria-modal="true" aria-labelledby="forums-dialog-title">
        <header><h2 id="forums-dialog-title">{dialog.kind === "category" ? `${dialog.id ? "Rename" : "Add"} category` : `${dialog.id ? "Edit" : "Add"} forum source`}</h2><button type="button" disabled={busy} onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></header>
        <form key={`${dialog.kind}-${dialog.id ?? "new"}`} onSubmit={(event) => void submit(event)}>
          <label>Name<input name="name" maxLength={dialog.kind === "category" ? 60 : 100} defaultValue={editedCategory?.name ?? editedSource?.name ?? ""} autoFocus required /></label>
          {dialog.kind === "source" && <><label>Forum origin (HTTPS Discourse)<input name="origin" type="url" placeholder="https://forum.example.com" defaultValue={editedSource?.origin ?? ""} required /></label>
            <label>Category<select name="categoryId" defaultValue={editedSource?.categoryId ?? activeCategory ?? directory.categories[0]?.id} required>{directory.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer><button type="button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button></footer>
        </form>
      </section>
    </div>}
  </>;
}
