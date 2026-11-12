import { visibleSites } from "../nav/site-filter";
import type { Category, Site } from "../nav/sites";

export type SearchPage = { href: string; label: string };

export type SearchResult =
  | { kind: "page"; id: string; title: string; detail: string; href: string }
  | { kind: "site"; id: string; title: string; detail: string; href: string; iconUrl: string | null };

export const SITE_RESULT_LIMIT = 8;

export function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

/**
 * Match quality for an already normalized keyword, lower is better:
 * 0 exact title, 1 title prefix, 2 word prefix in title, 3 title contains, 4 another field contains.
 */
export function matchScore(keyword: string, title: string, fields: string[] = []): number | null {
  const name = title.toLowerCase();
  if (name === keyword) return 0;
  if (name.startsWith(keyword)) return 1;
  if (name.split(/[\s\-_./]+/).some((word) => word.startsWith(keyword))) return 2;
  if (name.includes(keyword)) return 3;
  if (fields.some((field) => field.toLowerCase().includes(keyword))) return 4;
  return null;
}

/** Only web URLs may be opened from search results; anything else (for example `javascript:`) is dropped. */
export function isOpenableUrl(url: string) {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function siteHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Pages matching the query, best match first; an empty query lists every page in toolbar order. */
export function searchPages(pages: SearchPage[], query: string): SearchResult[] {
  const keyword = normalizeQuery(query);
  return pages
    .map((page, index) => ({ page, index, score: keyword ? matchScore(keyword, page.label, [page.href]) : 0 }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ page }) => ({ kind: "page", id: `page:${page.href}`, title: page.label, detail: page.href, href: page.href }));
}

/**
 * Websites from every category matching the query. Better matches come first; within the same match
 * quality, favorites come before other sites, then Navigator order. An empty query lists favorites
 * in their Navigator order.
 */
export function searchSites(sites: Site[], categories: Category[], query: string, limit = SITE_RESULT_LIMIT): SearchResult[] {
  const keyword = normalizeQuery(query);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const openable = sites.filter((site) => isOpenableUrl(site.url));
  const ranked = keyword
    ? openable
      .map((site) => ({ site, score: matchScore(keyword, site.name, [site.description, site.url, categoryName.get(site.category_id) ?? ""]) }))
      .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score
        || Number(b.site.is_favorite) - Number(a.site.is_favorite)
        || a.site.sort_order - b.site.sort_order
        || a.site.name.localeCompare(b.site.name))
      .map(({ site }) => site)
    : visibleSites(openable, categories, "favorites", "");
  return ranked.slice(0, limit).map((site) => {
    const category = categoryName.get(site.category_id);
    return {
      kind: "site",
      id: `site:${site.id}`,
      title: site.name,
      detail: category ? `${siteHost(site.url)} · ${category}` : siteHost(site.url),
      href: site.url,
      iconUrl: site.icon_url,
    };
  });
}

export type ShortcutKeys = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

/** Ctrl+K or ⌘K opens search anywhere; `/` opens it only when the user is not typing in a field. */
export function isSearchShortcut(event: ShortcutKeys, typingInField: boolean) {
  if (event.altKey) return false;
  if (event.metaKey || event.ctrlKey) return !event.shiftKey && event.key.toLowerCase() === "k";
  return event.key === "/" && !typingInField;
}
