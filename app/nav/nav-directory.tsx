"use client";

import {
  ArrowUpRight,
  Compass,
  FolderPlus,
  LayoutGrid,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowserClient } from "../lib/supabase";
import type { Category, Site } from "./sites";

type Dialog = "login" | "site" | "category" | null;

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function automaticIcon(url: string) {
  try {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=128`;
  } catch {
    return "";
  }
}

function SiteCard({
  site,
  category,
  isAdmin,
  onEdit,
  onDelete,
}: {
  site: Site;
  category?: Category;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const icon = site.icon_url || automaticIcon(site.url);

  return (
    <article className="site-card">
      <a className="site-card-link" href={site.url} rel="noreferrer" target="_blank">
        <span className="site-logo">
          <span>{initialsFor(site.name)}</span>
          {/* Dynamic third-party favicons are intentionally not routed through Next Image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {icon && <img alt="" src={icon} onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        </span>
        <span className="site-card-copy">
          <strong>{site.name}</strong>
          <small>{site.description || site.url}</small>
          <em>{category?.name ?? "Uncategorized"}</em>
        </span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </a>
      {isAdmin && (
        <span className="site-card-actions">
          <button type="button" onClick={onEdit} aria-label={`Edit ${site.name}`} title="Edit website"><Pencil size={14} /></button>
          <button type="button" onClick={onDelete} aria-label={`Delete ${site.name}`} title="Delete website"><Trash2 size={14} /></button>
        </span>
      )}
    </article>
  );
}

export function NavDirectory() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [toolbarAccountTarget, setToolbarAccountTarget] = useState<HTMLElement | null>(null);

  const loadDirectory = useCallback(async () => {
    const [categoryResult, siteResult] = await Promise.all([
      supabase.from("navigator_categories").select("id,name,sort_order").order("sort_order").order("name"),
      supabase.from("navigator_sites").select("id,category_id,name,description,url,icon_url,sort_order,is_published").order("sort_order").order("name"),
    ]);

    const error = categoryResult.error ?? siteResult.error;
    if (error) {
      setMessage(error.message.includes("navigator_") ? "Navigator database has not been initialized yet." : error.message);
    } else {
      setCategories((categoryResult.data ?? []) as Category[]);
      setSites((siteResult.data ?? []) as Site[]);
      setMessage("");
    }
    setLoading(false);
  }, [supabase]);

  const syncUser = useCallback(async (nextUser: SupabaseUser | null) => {
    setUser(nextUser);
    if (!nextUser) {
      setIsAdmin(false);
      return;
    }
    const { data, error } = await supabase.rpc("navigator_is_admin");
    setIsAdmin(!error && data === true);
  }, [supabase]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      setToolbarAccountTarget(document.getElementById("nav-toolbar-account"));
      void Promise.all([
        loadDirectory(),
        supabase.auth.getUser().then(({ data }) => syncUser(data.user)),
      ]);
    }, 0);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncUser(session?.user ?? null).then(loadDirectory);
    });
    return () => {
      window.clearTimeout(initialLoad);
      listener.subscription.unsubscribe();
    };
  }, [loadDirectory, supabase, syncUser]);

  const filteredSites = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sites.filter((site) => {
      const inCategory = categoryId === "all" || site.category_id === categoryId;
      const category = categories.find((item) => item.id === site.category_id)?.name ?? "";
      const searchable = `${site.name} ${site.description} ${site.url} ${category}`.toLowerCase();
      return inCategory && (!keyword || searchable.includes(keyword));
    });
  }, [categories, categoryId, query, sites]);

  function closeDialog() {
    setDialog(null);
    setEditingSite(null);
    setEditingCategory(null);
    setMessage("");
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    setSaving(false);
    if (error) setMessage(error.message);
    else closeDialog();
  }

  async function handleSiteSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name") ?? "").trim(),
      url: String(form.get("url") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      category_id: String(form.get("category_id") ?? ""),
      icon_url: String(form.get("icon_url") ?? "").trim() || null,
      is_published: form.get("is_published") === "on",
    };
    const result = editingSite
      ? await supabase.from("navigator_sites").update(values).eq("id", editingSite.id)
      : await supabase.from("navigator_sites").insert({ ...values, sort_order: sites.length });
    setSaving(false);
    if (result.error) setMessage(result.error.message);
    else {
      closeDialog();
      await loadDirectory();
    }
  }

  async function handleCategorySave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const result = editingCategory
      ? await supabase.from("navigator_categories").update({ name }).eq("id", editingCategory.id)
      : await supabase.from("navigator_categories").insert({ name, sort_order: categories.length });
    setSaving(false);
    if (result.error) setMessage(result.error.message);
    else {
      closeDialog();
      await loadDirectory();
    }
  }

  async function deleteSite(site: Site) {
    if (!window.confirm(`Delete “${site.name}”?`)) return;
    const { error } = await supabase.from("navigator_sites").delete().eq("id", site.id);
    if (error) setMessage(error.message);
    else await loadDirectory();
  }

  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete the “${category.name}” group?`)) return;
    const { error } = await supabase.from("navigator_categories").delete().eq("id", category.id);
    if (error) setMessage("Move or delete the websites in this group before deleting it.");
    else {
      if (categoryId === category.id) setCategoryId("all");
      await loadDirectory();
    }
  }

  function openNewSite() {
    setEditingSite(null);
    setMessage("");
    setDialog("site");
  }

  return (
    <div className="directory-view">
      <aside className="directory-sidebar" id="page-sidebar">
        <div className="sidebar-heading">
          <h2>Categories</h2>
          {isAdmin && <button type="button" onClick={() => { setEditingCategory(null); setDialog("category"); }} aria-label="Add group" title="Add group"><Plus size={14} /></button>}
        </div>
        <nav aria-label="Website categories">
          <div className="category-row">
            <button className={categoryId === "all" ? "active" : ""} onClick={() => setCategoryId("all")} type="button">
              <LayoutGrid size={16} /><span>All</span><small>{sites.length}</small>
            </button>
          </div>
          {categories.map((category) => (
            <div className="category-row" key={category.id}>
              <button className={categoryId === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)} type="button">
                <LayoutGrid size={16} /><span>{category.name}</span><small>{sites.filter((site) => site.category_id === category.id).length}</small>
              </button>
              {isAdmin && (
                <span className="category-actions">
                  <button type="button" onClick={() => { setEditingCategory(category); setDialog("category"); }} aria-label={`Edit ${category.name}`}><Pencil size={12} /></button>
                  <button type="button" onClick={() => void deleteCategory(category)} aria-label={`Delete ${category.name}`}><Trash2 size={12} /></button>
                </span>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <section className="directory-content">
        <header className="directory-header">
          <div><h1>{categoryId === "all" ? "Web Navigator" : categories.find((item) => item.id === categoryId)?.name}</h1><p>{filteredSites.length} items</p></div>
          <div className="directory-tools">
            <label className="breeze-search">
              <Search size={16} aria-hidden="true" />
              <input aria-label="Search websites" onChange={(event) => setQuery(event.target.value)} placeholder="Search…" type="search" value={query} />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
            </label>
            {isAdmin && (
              <>
                <button className="directory-action" type="button" onClick={() => { setEditingCategory(null); setDialog("category"); }}><FolderPlus size={15} /> Group</button>
                <button className="directory-action primary" type="button" onClick={openNewSite} disabled={categories.length === 0} title={categories.length === 0 ? "Create a group first" : "Add website"}><Plus size={15} /> Website</button>
              </>
            )}
          </div>
        </header>

        {message && !dialog && <div className="directory-notice" role="status">{message}</div>}
        {loading ? (
          <div className="empty-state"><p>Loading navigator…</p></div>
        ) : filteredSites.length > 0 ? (
          <div className="site-grid">
            {filteredSites.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                category={categories.find((item) => item.id === site.category_id)}
                isAdmin={isAdmin}
                onEdit={() => { setEditingSite(site); setMessage(""); setDialog("site"); }}
                onDelete={() => void deleteSite(site)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Compass size={48} strokeWidth={1.2} />
            <h2>{sites.length === 0 ? "No websites yet" : "No items found"}</h2>
            <p>{isAdmin && sites.length === 0 ? "Create a group, then add your first website." : "Try a different search term or category."}</p>
            {isAdmin && categories.length > 0 && sites.length === 0 && <button type="button" onClick={openNewSite}>Add website</button>}
          </div>
        )}
      </section>

      {toolbarAccountTarget && createPortal(
        user ? (
          <button className="account-control" type="button" onClick={() => void supabase.auth.signOut()} title={`Sign out ${user.email ?? ""}`}><User size={15} /><span>{isAdmin ? "Owner" : "Read only"}</span><LogOut size={14} /></button>
        ) : (
          <button className="account-control" type="button" onClick={() => { setMessage(""); setDialog("login"); }}><LogIn size={15} /><span>Sign in</span></button>
        ),
        toolbarAccountTarget,
      )}

      {dialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className="breeze-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <header>
              <h2 id="dialog-title">{dialog === "login" ? "Owner sign in" : dialog === "site" ? `${editingSite ? "Edit" : "Add"} website` : `${editingCategory ? "Edit" : "Add"} group`}</h2>
              <button type="button" onClick={closeDialog} aria-label="Close"><X size={17} /></button>
            </header>

            {dialog === "login" && (
              <form onSubmit={handleLogin}>
                <label>Email<input name="email" type="email" autoComplete="username" required /></label>
                <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
                {message && <p className="form-error" role="alert">{message}</p>}
                <footer><button type="button" onClick={closeDialog}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Signing in…" : "Sign in"}</button></footer>
              </form>
            )}

            {dialog === "category" && (
              <form onSubmit={handleCategorySave}>
                <label>Group name<input name="name" defaultValue={editingCategory?.name ?? ""} maxLength={60} autoFocus required /></label>
                {message && <p className="form-error" role="alert">{message}</p>}
                <footer><button type="button" onClick={closeDialog}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer>
              </form>
            )}

            {dialog === "site" && (
              <form onSubmit={handleSiteSave}>
                <div className="form-grid">
                  <label>Website name<input name="name" defaultValue={editingSite?.name ?? ""} maxLength={100} autoFocus required /></label>
                  <label>Group<select name="category_id" defaultValue={editingSite?.category_id ?? (categoryId === "all" ? categories[0]?.id : categoryId)} required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                </div>
                <label>Website URL<input name="url" type="url" placeholder="https://example.com" defaultValue={editingSite?.url ?? ""} required /></label>
                <label>Description<textarea name="description" maxLength={300} rows={3} defaultValue={editingSite?.description ?? ""} /></label>
                <label>Custom icon URL <small>(optional)</small><input name="icon_url" type="url" placeholder="Automatically uses the website favicon" defaultValue={editingSite?.icon_url ?? ""} /></label>
                <label className="checkbox-label"><input name="is_published" type="checkbox" defaultChecked={editingSite?.is_published ?? true} /> Visible to guests</label>
                {message && <p className="form-error" role="alert">{message}</p>}
                <footer><button type="button" onClick={closeDialog}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save website"}</button></footer>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
