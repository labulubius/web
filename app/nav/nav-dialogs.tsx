"use client";

import { X } from "lucide-react";
import type { FormEvent } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import type { Category, Site } from "./sites";

export type Dialog = "site" | "category" | null;

export function NavDialog({
  dialog,
  editingSite,
  editingCategory,
  categories,
  categoryId,
  saving,
  message,
  onClose,
  onSiteSave,
  onCategorySave,
}: {
  dialog: Exclude<Dialog, null>;
  editingSite: Site | null;
  editingCategory: Category | null;
  categories: Category[];
  categoryId: string;
  saving: boolean;
  message: string;
  onClose: () => void;
  onSiteSave: (event: FormEvent<HTMLFormElement>) => void;
  onCategorySave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <AccessibleDialog labelledBy="dialog-title" busy={saving} onClose={onClose}>
        <header>
          <h2 id="dialog-title">{dialog === "site" ? `${editingSite ? "Edit" : "Add"} website` : `${editingCategory ? "Edit" : "Add"} group`}</h2>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>

        {dialog === "category" && (
          <form onSubmit={onCategorySave}>
            <label>Group name<input name="name" defaultValue={editingCategory?.name ?? ""} maxLength={60} autoFocus required /></label>
            {message && <p className="form-error" role="alert">{message}</p>}
            <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer>
          </form>
        )}

        {dialog === "site" && (
          <form onSubmit={onSiteSave}>
            <div className="form-grid">
              <label>Website name<input name="name" defaultValue={editingSite?.name ?? ""} maxLength={100} autoFocus required /></label>
              <label>Group<select name="category_id" defaultValue={editingSite?.category_id ?? (categoryId === "favorites" ? categories[0]?.id : categoryId)} required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            </div>
            <label>Website URL<input name="url" type="url" placeholder="https://example.com" defaultValue={editingSite?.url ?? ""} required /></label>
            <label>Description<textarea name="description" maxLength={300} rows={3} defaultValue={editingSite?.description ?? ""} /></label>
            <label>Custom icon source URL <small>(optional)</small><input name="icon_url" type="url" placeholder="Leave blank to find the website favicon automatically" /></label>
            {message && <p className="form-error" role="alert">{message}</p>}
            <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save website"}</button></footer>
          </form>
        )}
    </AccessibleDialog>
  );
}
