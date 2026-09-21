"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
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

const restrictToViewport: Modifier = ({ draggingNodeRect, transform, windowRect }) => {
  if (!draggingNodeRect || !windowRect) return transform;

  const next = { ...transform };
  next.x = Math.min(
    Math.max(transform.x, windowRect.left - draggingNodeRect.left),
    windowRect.right - draggingNodeRect.right,
  );
  next.y = Math.min(
    Math.max(transform.y, windowRect.top - draggingNodeRect.top),
    windowRect.bottom - draggingNodeRect.bottom,
  );
  return next;
};

function SortableCategoryRow({
  category,
  active,
  isAdmin,
  onSelect,
  onEdit,
  onDelete,
}: {
  category: Category;
  active: boolean;
  isAdmin: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: !isAdmin,
  });

  return (
    <div
      className={`category-row${isAdmin ? " reorderable" : ""}${isDragging ? " dragging" : ""}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}
    >
      <button
        className={active ? "active" : ""}
        onClick={onSelect}
        type="button"
        {...(isAdmin ? attributes : {})}
        {...(isAdmin ? listeners : {})}
      >
        {isAdmin ? <GripVertical size={16} /> : <LayoutGrid size={16} />}<span>{category.name}</span>
      </button>
      {isAdmin && (
        <span className="category-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={onEdit} aria-label={`Edit ${category.name}`}><Pencil size={12} /></button>
          <button type="button" onClick={onDelete} aria-label={`Delete ${category.name}`}><Trash2 size={12} /></button>
        </span>
      )}
    </div>
  );
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
  const icon = site.icon_url;
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
  const blockSiteOpenUntil = useRef(0);
  const iconBackfillStarted = useRef(false);
  const categorySensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
  );
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

  useEffect(() => {
    if (!isAdmin || loading || iconBackfillStarted.current) return;
    iconBackfillStarted.current = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const response = await fetch("/api/nav/icon", {
        method: "PUT",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (response.ok) await loadDirectory();
    })();
  }, [isAdmin, loading, loadDirectory, supabase]);

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
          const favoriteDifference = (a.favorite_sort_order ?? a.sort_order) - (b.favorite_sort_order ?? b.sort_order);
          if (favoriteDifference !== 0) return favoriteDifference;
          const categoryDifference = (categoryOrder.get(a.category_id) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(b.category_id) ?? Number.MAX_SAFE_INTEGER);
          if (categoryDifference !== 0) return categoryDifference;
        }
        return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
      });
  }, [categories, categoryId, query, sites]);

  const canReorderSites = isAdmin && query.trim() === "";
  const supportsCategoryVisibility = categories.some((category) => typeof category.is_published === "boolean");
  const supportsFavoriteOrder = sites.some((site) => site.favorite_sort_order !== undefined);

  function closeDialog() {
    setDialog(null);
    setEditingSite(null);
    setEditingCategory(null);
    setMessage("");
  }

  async function requestIconImport(method: "POST" | "DELETE", siteId: string, sourceUrl?: string | null) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Your administrator session has expired.");

    const response = await fetch("/api/nav/icon", {
      method,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ siteId, sourceUrl }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error ?? "Could not store the website icon.");
    }
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
      : await supabase.from("navigator_sites").insert({ ...values, sort_order: categorySiteCount }).select("id").single();
    if (result.error) {
      setSaving(false);
      setMessage(result.error.message);
      return;
    }

    const siteId = editingSite?.id ?? result.data?.id;
    try {
      if (!siteId) throw new Error("The saved website ID was not returned.");
      await requestIconImport("POST", siteId, values.icon_url);
      setSaving(false);
      closeDialog();
      await loadDirectory();
    } catch (error) {
      setSaving(false);
      setMessage(`Website saved, but its icon could not be stored: ${error instanceof Error ? error.message : "Unknown error"}`);
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
    else {
      await requestIconImport("DELETE", site.id).catch(() => undefined);
      await loadDirectory();
    }
  }

  async function toggleFavorite(site: Site) {
    const nextValue = !site.is_favorite;
    const favoriteSortOrder = nextValue
      ? Math.max(-1, ...sites.filter((item) => item.is_favorite).map((item) => item.favorite_sort_order ?? item.sort_order)) + 1
      : null;
    const optimisticValues = supportsFavoriteOrder
      ? { is_favorite: nextValue, favorite_sort_order: favoriteSortOrder }
      : { is_favorite: nextValue };
    const databaseValues = supportsFavoriteOrder
      ? optimisticValues
      : { is_favorite: nextValue };
    setSites((current) => current.map((item) => item.id === site.id ? { ...item, ...optimisticValues } : item));
    const { error } = await supabase.from("navigator_sites").update(databaseValues).eq("id", site.id);
    if (error) {
      setMessage(`Could not update favorite: ${error.message}`);
      setSites((current) => current.map((item) => item.id === site.id ? { ...item, is_favorite: site.is_favorite, favorite_sort_order: site.favorite_sort_order } : item));
    }
  }

  async function deleteCategory(category: Category) {
    const siteCount = sites.filter((site) => site.category_id === category.id).length;
    const siteLabel = siteCount === 1 ? "website" : "websites";
    if (!window.confirm(`Delete the “${category.name}” group and its ${siteCount} ${siteLabel}? This cannot be undone.`)) return;

    let { error } = await supabase.from("navigator_categories").delete().eq("id", category.id);

    // Support databases that have not applied the cascading foreign-key migration yet.
    if (error?.code === "23503") {
      const siteResult = await supabase.from("navigator_sites").delete().eq("category_id", category.id);
      if (siteResult.error) {
        setMessage(`Could not delete the group websites: ${siteResult.error.message}`);
        return;
      }
      ({ error } = await supabase.from("navigator_categories").delete().eq("id", category.id));
    }

    if (error) setMessage(`Could not delete the group: ${error.message}`);
    else {
      const deletedSiteIds = sites.filter((site) => site.category_id === category.id).map((site) => site.id);
      await Promise.allSettled(deletedSiteIds.map((siteId) => requestIconImport("DELETE", siteId)));
      if (categoryId === category.id) setCategoryId("favorites");
      await loadDirectory();
    }
  }

  async function handleCategoryDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const sourceIndex = categories.findIndex((category) => category.id === event.active.id);
    const targetIndex = categories.findIndex((category) => category.id === event.over?.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const withOrder = arrayMove(categories, sourceIndex, targetIndex)
      .map((category, index) => ({ ...category, sort_order: index }));

    setCategories(withOrder);
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
    const sourceIndex = filteredSites.findIndex((site) => site.id === event.active.id);
    const targetIndex = filteredSites.findIndex((site) => site.id === event.over?.id);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const orderField = categoryId === "favorites" && supportsFavoriteOrder ? "favorite_sort_order" : "sort_order";
    const withOrder = arrayMove(filteredSites, sourceIndex, targetIndex)
      .map((site, index) => ({ ...site, [orderField]: index }));
    const orderById = new Map(withOrder.map((site, index) => [site.id, index]));

    setSites((current) => current.map((site) => orderById.has(site.id) ? { ...site, [orderField]: orderById.get(site.id)! } : site));
    const results = await Promise.all(
      withOrder.map((site) => supabase.from("navigator_sites").update({ [orderField]: site[orderField] }).eq("id", site.id)),
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
          <DndContext sensors={categorySensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleCategoryDragEnd(event)}>
            <SortableContext items={categories.map((category) => category.id)} strategy={verticalListSortingStrategy}>
              {categories.map((category) => (
                <SortableCategoryRow
                  category={category}
                  active={categoryId === category.id}
                  isAdmin={isAdmin}
                  key={category.id}
                  onSelect={() => setCategoryId(category.id)}
                  onEdit={() => { setEditingCategory(category); setDialog("category"); }}
                  onDelete={() => void deleteCategory(category)}
                />
              ))}
            </SortableContext>
          </DndContext>
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
            modifiers={[restrictToViewport]}
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
