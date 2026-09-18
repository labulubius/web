"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Compass,
  GripVertical,
  Globe2,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSiteAuth } from "../site-auth";
import type { Category, Site } from "./sites";

type Dialog = "site" | "category" | null;

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
  canReorder,
  onEdit,
  onDelete,
  onFavorite,
  shouldBlockOpen,
}: {
  site: Site;
  category?: Category;
  isAdmin: boolean;
  canReorder: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  shouldBlockOpen: () => boolean;
}) {
  const icon = site.icon_url || automaticIcon(site.url);
  const didDrag = useRef(false);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: site.id,
    disabled: !canReorder,
  });

  useEffect(() => {
    if (isDragging) didDrag.current = true;
  }, [isDragging]);

  function openSite() {
    window.open(site.url, "_blank", "noopener,noreferrer");
  }

  return (
    <article
      className={`site-card${isAdmin ? " admin" : ""}${site.is_favorite ? " favorite" : ""}${canReorder ? " reorderable" : ""}${isDragging ? " dragging" : ""}`}
      ref={setNodeRef}
      role="link"
      tabIndex={0}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}
      onPointerDownCapture={() => { didDrag.current = false; }}
      onClick={() => {
        if (didDrag.current || shouldBlockOpen()) {
          didDrag.current = false;
          return;
        }
        openSite();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) openSite();
      }}
      {...(canReorder ? listeners : {})}
    >
      <div className="site-card-body">
        <span className="site-logo">
          <Globe2 className="site-logo-fallback" size={40} strokeWidth={1.35} aria-hidden="true" />
          {/* Dynamic third-party favicons are intentionally not routed through Next Image. */}
          {icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              draggable={false}
              src={icon}
              onError={(event) => { event.currentTarget.style.display = "none"; }}
              onLoad={(event) => {
                if (!site.icon_url && event.currentTarget.naturalWidth <= 16 && event.currentTarget.naturalHeight <= 16) {
                  event.currentTarget.style.display = "none";
                }
              }}
            />
          )}
        </span>
        <span className="site-card-copy">
          <strong>{site.name}</strong>
          <small>{site.description || site.url}</small>
          <em>{category?.name ?? "Uncategorized"}</em>
        </span>
      </div>
      {(isAdmin || site.is_favorite) && (
        <span className="site-card-actions" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          {isAdmin ? (
            <button className={site.is_favorite ? "favorite-button active" : "favorite-button"} type="button" onClick={onFavorite} aria-label={`${site.is_favorite ? "Remove" : "Add"} ${site.name} ${site.is_favorite ? "from" : "to"} favorites`} title={site.is_favorite ? "Remove from favorites" : "Add to favorites"}><Star size={14} fill={site.is_favorite ? "currentColor" : "none"} /></button>
          ) : (
            <span className="favorite-indicator" title="Favorite"><Star size={14} fill="currentColor" /></span>
          )}
          {isAdmin && <button type="button" onClick={onEdit} aria-label={`Edit ${site.name}`} title="Edit website"><Pencil size={14} /></button>}
          {isAdmin && <button type="button" onClick={onDelete} aria-label={`Delete ${site.name}`} title="Delete website"><Trash2 size={14} /></button>}
        </span>
      )}
    </article>
  );
}

export function NavDirectory() {
  const { supabase, isAdmin } = useSiteAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("favorites");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [categoryDropTarget, setCategoryDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const blockSiteOpenUntil = useRef(0);
  const siteSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
  );

  const loadDirectory = useCallback(async () => {
    const [categoryResult, siteResult] = await Promise.all([
      supabase.from("navigator_categories").select("*").order("sort_order").order("name"),
      supabase.from("navigator_sites").select("*").order("sort_order").order("name"),
    ]);

    const error = categoryResult.error ?? siteResult.error;
    if (error) {
      setMessage(error.message.includes("navigator_") ? "Navigator database has not been initialized yet." : error.message);
    } else {
      setCategories((categoryResult.data ?? []) as Category[]);
      setSites((siteResult.data ?? []).map((site) => ({ ...site, is_favorite: site.is_favorite === true })) as Site[]);
      setMessage("");
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDirectory(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [isAdmin, loadDirectory]);

  const filteredSites = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
    return sites
      .filter((site) => {
        const inCategory = categoryId === "favorites" ? site.is_favorite : site.category_id === categoryId;
        const category = categories.find((item) => item.id === site.category_id)?.name ?? "";
        const searchable = `${site.name} ${site.description} ${site.url} ${category}`.toLowerCase();
        return inCategory && (!keyword || searchable.includes(keyword));
      })
      .sort((a, b) => {
        if (categoryId === "favorites") {
          const categoryDifference = (categoryOrder.get(a.category_id) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(b.category_id) ?? Number.MAX_SAFE_INTEGER);
          if (categoryDifference !== 0) return categoryDifference;
        }
        return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
      });
  }, [categories, categoryId, query, sites]);

  const canReorderSites = isAdmin && categoryId !== "favorites" && query.trim() === "";
  const supportsCategoryVisibility = categories.some((category) => typeof category.is_published === "boolean");

  function closeDialog() {
    setDialog(null);
    setEditingSite(null);
    setEditingCategory(null);
    setMessage("");
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
    const categorySiteCount = sites.filter((site) => site.category_id === values.category_id).length;
    const siteValues = editingSite && editingSite.category_id !== values.category_id
      ? { ...values, sort_order: categorySiteCount }
      : values;
    const result = editingSite
      ? await supabase.from("navigator_sites").update(siteValues).eq("id", editingSite.id)
      : await supabase.from("navigator_sites").insert({ ...values, sort_order: categorySiteCount });
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
    const values = supportsCategoryVisibility
      ? { name, is_published: form.get("is_published") === "on" }
      : { name };
    const result = editingCategory
      ? await supabase.from("navigator_categories").update(values).eq("id", editingCategory.id)
      : await supabase.from("navigator_categories").insert({ ...values, sort_order: categories.length });
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

  async function toggleFavorite(site: Site) {
    const nextValue = !site.is_favorite;
    setSites((current) => current.map((item) => item.id === site.id ? { ...item, is_favorite: nextValue } : item));
    const { error } = await supabase.from("navigator_sites").update({ is_favorite: nextValue }).eq("id", site.id);
    if (error) {
      setMessage(`Could not update favorite: ${error.message}`);
      setSites((current) => current.map((item) => item.id === site.id ? { ...item, is_favorite: site.is_favorite } : item));
    }
  }

  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete the “${category.name}” group?`)) return;
    const { error } = await supabase.from("navigator_categories").delete().eq("id", category.id);
    if (error) setMessage("Move or delete the websites in this group before deleting it.");
    else {
      if (categoryId === category.id) setCategoryId("favorites");
      await loadDirectory();
    }
  }

  async function reorderCategory(targetId: string, after: boolean) {
    if (!draggingCategoryId || draggingCategoryId === targetId) return;
    const reordered = [...categories];
    const sourceIndex = reordered.findIndex((category) => category.id === draggingCategoryId);
    if (sourceIndex < 0) return;
    const [moved] = reordered.splice(sourceIndex, 1);
    const targetIndex = reordered.findIndex((category) => category.id === targetId);
    if (targetIndex < 0) return;
    reordered.splice(targetIndex + (after ? 1 : 0), 0, moved);
    const withOrder = reordered.map((category, index) => ({ ...category, sort_order: index }));

    setCategories(withOrder);
    setDraggingCategoryId(null);
    setCategoryDropTarget(null);
    const results = await Promise.all(
      withOrder.map((category) => supabase.from("navigator_categories").update({ sort_order: category.sort_order }).eq("id", category.id)),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) {
      setMessage(`Could not reorder groups: ${error.message}`);
      await loadDirectory();
    }
  }

  async function handleSiteDragEnd(event: DragEndEvent) {
    if (!canReorderSites || !event.over || event.active.id === event.over.id) return;
    const categorySites = sites
      .filter((site) => site.category_id === categoryId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const sourceIndex = categorySites.findIndex((site) => site.id === event.active.id);
    const targetIndex = categorySites.findIndex((site) => site.id === event.over?.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const withOrder = arrayMove(categorySites, sourceIndex, targetIndex)
      .map((site, index) => ({ ...site, sort_order: index }));
    const orderById = new Map(withOrder.map((site) => [site.id, site.sort_order]));

    setSites((current) => current.map((site) => orderById.has(site.id) ? { ...site, sort_order: orderById.get(site.id)! } : site));
    const results = await Promise.all(
      withOrder.map((site) => supabase.from("navigator_sites").update({ sort_order: site.sort_order }).eq("id", site.id)),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) {
      setMessage(`Could not reorder websites: ${error.message}`);
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
            <button className={categoryId === "favorites" ? "active" : ""} onClick={() => setCategoryId("favorites")} type="button">
              <Star size={16} fill={categoryId === "favorites" ? "currentColor" : "none"} /><span>Favorites</span>
            </button>
          </div>
          {categories.map((category) => (
            <div
              className={`category-row${draggingCategoryId === category.id ? " dragging" : ""}`}
              data-drop-position={categoryDropTarget?.id === category.id ? (categoryDropTarget.after ? "after" : "before") : undefined}
              draggable={isAdmin}
              key={category.id}
              onDragStart={(event) => {
                setDraggingCategoryId(category.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", category.id);
              }}
              onDragOver={(event) => {
                if (!isAdmin || draggingCategoryId === category.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setCategoryDropTarget({ id: category.id, after: event.clientY > bounds.top + bounds.height / 2 });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                void reorderCategory(category.id, event.clientY > bounds.top + bounds.height / 2);
              }}
              onDragEnd={() => { setDraggingCategoryId(null); setCategoryDropTarget(null); }}
            >
              <button className={categoryId === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)} type="button">
                {isAdmin ? <GripVertical size={16} /> : <LayoutGrid size={16} />}<span>{category.name}</span>
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
          <div><h1>{categoryId === "favorites" ? "Favorites" : categories.find((item) => item.id === categoryId)?.name}</h1><p>{filteredSites.length} items</p></div>
          <div className="directory-tools">
            <label className="breeze-search">
              <Search size={16} aria-hidden="true" />
              <input aria-label="Search websites" onChange={(event) => setQuery(event.target.value)} placeholder="Search…" type="search" value={query} />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
            </label>
            {isAdmin && <button className="directory-action primary" type="button" onClick={openNewSite} disabled={categories.length === 0} title={categories.length === 0 ? "Create a group first" : "Add website"}><Plus size={15} /> Website</button>}
          </div>
        </header>

        {message && !dialog && <div className="directory-notice" role="status">{message}</div>}
        {loading ? (
          <div className="empty-state"><p>Loading navigator…</p></div>
        ) : filteredSites.length > 0 ? (
          <DndContext
            sensors={siteSensors}
            collisionDetection={closestCenter}
            onDragStart={() => { blockSiteOpenUntil.current = Number.POSITIVE_INFINITY; }}
            onDragCancel={() => { blockSiteOpenUntil.current = Date.now() + 500; }}
            onDragEnd={(event) => {
              void handleSiteDragEnd(event);
              blockSiteOpenUntil.current = Date.now() + 500;
            }}
          >
            <SortableContext items={filteredSites.map((site) => site.id)} strategy={rectSortingStrategy}>
              <div className="site-grid">
                {filteredSites.map((site) => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    category={categories.find((item) => item.id === site.category_id)}
                    isAdmin={isAdmin}
                    canReorder={canReorderSites}
                    onEdit={() => { setEditingSite(site); setMessage(""); setDialog("site"); }}
                    onDelete={() => void deleteSite(site)}
                    onFavorite={() => void toggleFavorite(site)}
                    shouldBlockOpen={() => Date.now() < blockSiteOpenUntil.current}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="empty-state">
            <Compass size={48} strokeWidth={1.2} />
            <h2>{sites.length === 0 ? "No websites yet" : "No items found"}</h2>
            <p>{isAdmin && sites.length === 0 ? "Create a group, then add your first website." : "Try a different search term or category."}</p>
            {isAdmin && categories.length > 0 && sites.length === 0 && <button type="button" onClick={openNewSite}>Add website</button>}
          </div>
        )}
      </section>

      {dialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className="breeze-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <header>
              <h2 id="dialog-title">{dialog === "site" ? `${editingSite ? "Edit" : "Add"} website` : `${editingCategory ? "Edit" : "Add"} group`}</h2>
              <button type="button" onClick={closeDialog} aria-label="Close"><X size={17} /></button>
            </header>

            {dialog === "category" && (
              <form onSubmit={handleCategorySave}>
                <label>Group name<input name="name" defaultValue={editingCategory?.name ?? ""} maxLength={60} autoFocus required /></label>
                {supportsCategoryVisibility && <label className="checkbox-label"><input name="is_published" type="checkbox" defaultChecked={editingCategory?.is_published ?? true} /> Visible to guests</label>}
                {message && <p className="form-error" role="alert">{message}</p>}
                <footer><button type="button" onClick={closeDialog}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer>
              </form>
            )}

            {dialog === "site" && (
              <form onSubmit={handleSiteSave}>
                <div className="form-grid">
                  <label>Website name<input name="name" defaultValue={editingSite?.name ?? ""} maxLength={100} autoFocus required /></label>
                  <label>Group<select name="category_id" defaultValue={editingSite?.category_id ?? (categoryId === "favorites" ? categories[0]?.id : categoryId)} required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
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
