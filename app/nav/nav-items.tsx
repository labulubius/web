"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Folder, Globe2, LayoutGrid, Pencil, Star, Trash2 } from "lucide-react";
import type { Category, Site } from "./sites";

export function SortableCategoryRow({
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
        {isAdmin ? <Folder size={16} /> : <LayoutGrid size={16} />}<span>{category.name}</span>
      </button>
      <span className="category-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" disabled={!isAdmin} onClick={onEdit} aria-label={`Edit ${category.name}`}><Pencil size={12} /></button>
        <button type="button" disabled={!isAdmin} onClick={onDelete} aria-label={`Delete ${category.name}`}><Trash2 size={12} /></button>
      </span>
    </div>
  );
}

export function SiteCard({
  site,
  category,
  isAdmin,
  canReorder,
  onEdit,
  onDelete,
  onFavorite,
}: {
  site: Site;
  category?: Category;
  isAdmin: boolean;
  canReorder: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
}) {
  const icon = site.icon_url;
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: site.id,
    disabled: !canReorder,
  });

  return (
    <article
      className={`site-card${isAdmin ? " admin" : ""}${site.is_favorite ? " favorite" : ""}${canReorder ? " reorderable" : ""}${isDragging ? " dragging" : ""}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}
      {...(canReorder ? listeners : {})}
    >
      <a
        className="site-card-link"
        draggable={false}
        href={site.url}
        target="_blank"
        rel="noopener noreferrer"
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
                onLoad={(event) => { event.currentTarget.style.display = ""; }}
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
      </a>
      <span className="site-card-actions" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <button className={site.is_favorite ? "favorite-button active" : "favorite-button"} type="button" disabled={!isAdmin} onClick={onFavorite} aria-label={`${site.is_favorite ? "Remove" : "Add"} ${site.name} ${site.is_favorite ? "from" : "to"} favorites`} title={site.is_favorite ? "Remove from favorites" : "Add to favorites"}><Star size={14} fill={site.is_favorite ? "currentColor" : "none"} /></button>
        <button type="button" disabled={!isAdmin} onClick={onEdit} aria-label={`Edit ${site.name}`} title="Edit website"><Pencil size={14} /></button>
        <button type="button" disabled={!isAdmin} onClick={onDelete} aria-label={`Delete ${site.name}`} title="Delete website"><Trash2 size={14} /></button>
      </span>
    </article>
  );
}
