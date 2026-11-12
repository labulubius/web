"use client";

import { ExternalLink, Globe2, type LucideIcon, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import type { Category, Site } from "../nav/sites";
import { useSiteAuth } from "../site-auth";
import { isOpenableUrl, isSearchShortcut, searchPages, searchSites, type SearchResult } from "./search-index";
import "./global-search.css";

// Reopening the panel refreshes websites that were loaded longer ago than this.
const SITE_CACHE_MS = 60_000;

type SearchPageLink = { href: string; label: string; icon: LucideIcon };

type SiteState = {
  status: "idle" | "loading" | "ready" | "error";
  sites: Site[];
  categories: Category[];
  loadedAt: number;
};

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Toolbar search over site pages and, for the site owner, every Navigator website.
 * Signed-out visitors and non-owners only search pages; no private data is requested for them.
 */
export function GlobalSearch({ pages }: { pages: SearchPageLink[] }) {
  const { supabase, isAdmin, loading: authLoading } = useSiteAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [siteState, setSiteState] = useState<SiteState>({ status: "idle", sites: [], categories: [], loadedAt: 0 });
  const request = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const listId = `${baseId}-results`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const openSearch = useCallback(() => {
    setQuery(""); setActiveIndex(0); setOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    // A failed load is retried the next time the panel opens.
    setSiteState((current) => current.status === "error" ? { ...current, status: "idle" } : current);
  }, []);

  const loadSites = useCallback(async () => {
    const current = ++request.current;
    setSiteState((state) => ({ ...state, status: "loading" }));
    try {
      const [categoryResult, siteResult] = await Promise.all([
        supabase.from("navigator_categories").select("*").order("sort_order").order("name"),
        supabase.from("navigator_sites").select("*").order("sort_order").order("name"),
      ]);
      if (current !== request.current) return;
      const error = categoryResult.error ?? siteResult.error;
      if (error) throw error;
      setSiteState({
        status: "ready",
        categories: (categoryResult.data ?? []) as Category[],
        sites: (siteResult.data ?? []).map((site) => ({ ...site, is_favorite: site.is_favorite === true })) as Site[],
        loadedAt: Date.now(),
      });
    } catch {
      if (current !== request.current) return;
      setSiteState((state) => ({ ...state, status: "error" }));
    }
  }, [supabase]);

  // Websites are owner-only: load them lazily, and only once the owner check has passed.
  useEffect(() => {
    if (!open || authLoading || !isAdmin) return;
    const stale = siteState.status === "idle" || (siteState.status === "ready" && Date.now() - siteState.loadedAt > SITE_CACHE_MS);
    if (!stale) return;
    const initialLoad = window.setTimeout(() => void loadSites(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [open, authLoading, isAdmin, siteState.status, siteState.loadedAt, loadSites]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !isSearchShortcut(event, isTypingTarget(event.target))) return;
      if (open) {
        event.preventDefault();
        closeSearch();
        return;
      }
      // Leave other dialogs (sign in, Navigator and task forms) in charge of the keyboard.
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openSearch, closeSearch]);

  const pageResults = useMemo(() => searchPages(pages, query), [pages, query]);
  const siteResults = useMemo(
    () => isAdmin ? searchSites(siteState.sites, siteState.categories, query) : [],
    [isAdmin, siteState.sites, siteState.categories, query],
  );
  const results = useMemo(() => [...pageResults, ...siteResults], [pageResults, siteResults]);
  const active = results.length ? Math.min(activeIndex, results.length - 1) : -1;

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  });

  function activate(result: SearchResult) {
    if (result.kind === "page") {
      closeSearch();
      router.push(result.href);
      return;
    }
    if (!isOpenableUrl(result.href)) return;
    window.open(result.href, "_blank", "noopener,noreferrer");
    closeSearch();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const total = results.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!total) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((Math.max(active, 0) + step + total) % total);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) activate(results[active]);
    }
  }

  function renderOption(result: SearchResult, index: number) {
    const PageIcon = result.kind === "page" ? pages.find((page) => page.href === result.href)?.icon : undefined;
    return (
      <div
        key={result.id}
        id={optionId(index)}
        className="global-search-option"
        role="option"
        aria-selected={index === active}
        onMouseMove={() => { if (index !== active) setActiveIndex(index); }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => activate(result)}
      >
        <span className="global-search-icon" aria-hidden="true">
          {result.kind === "page" ? (PageIcon ? <PageIcon size={16} /> : <Globe2 size={16} />) : <>
            <Globe2 size={16} />
            {/* Dynamic third-party favicons are intentionally not routed through Next Image. */}
            {result.iconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={result.iconUrl} onError={(event) => { event.currentTarget.style.display = "none"; }} />
            )}
          </>}
        </span>
        <span className="global-search-copy">
          <strong>{result.title}</strong>
          <small>{result.detail}</small>
        </span>
        {result.kind === "site" && <ExternalLink className="global-search-external" size={14} aria-hidden="true" />}
      </div>
    );
  }

  const trimmed = query.trim();
  const loadingSites = isAdmin && siteState.status === "loading" && siteState.sites.length === 0;
  const announcement = loadingSites ? "Loading websites…" : trimmed && !results.length ? "No results." : `${results.length} result${results.length === 1 ? "" : "s"}.`;

  return <>
    <button
      className="search-control"
      type="button"
      onClick={openSearch}
      aria-label="Search"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K /"
      title="Search (Ctrl+K or ⌘K)"
    >
      <Search size={18} /><span>Search</span>
    </button>
    {open && <AccessibleDialog labelledBy={titleId} onClose={closeSearch} className="global-search-dialog">
      <h2 id={titleId} className="global-search-sr">Search</h2>
      <div className="global-search-field">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus
          type="search"
          role="combobox"
          aria-label={isAdmin ? "Search pages and websites" : "Search pages"}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={results.length > 0}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={isAdmin ? "Search pages and websites…" : "Search pages…"}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={onInputKeyDown}
        />
        {query && <button type="button" onClick={() => { setQuery(""); setActiveIndex(0); inputRef.current?.focus(); }} aria-label="Clear search"><X size={14} /></button>}
      </div>
      <div id={listId} className="global-search-results" role="listbox" aria-label="Search results">
        {pageResults.length > 0 && <div role="group" aria-labelledby={`${baseId}-pages`}>
          <div id={`${baseId}-pages`} className="global-search-group">Pages</div>
          {pageResults.map((result, index) => renderOption(result, index))}
        </div>}
        {siteResults.length > 0 && <div role="group" aria-labelledby={`${baseId}-sites`}>
          <div id={`${baseId}-sites`} className="global-search-group">{trimmed ? "Websites" : "Favorites"}</div>
          {siteResults.map((result, index) => renderOption(result, pageResults.length + index))}
        </div>}
      </div>
      {trimmed && !results.length && !loadingSites && <p className="global-search-message">No results for “{trimmed}”.</p>}
      {loadingSites && <p className="global-search-message">Loading websites…</p>}
      {isAdmin && siteState.status === "error" && <p className="global-search-message global-search-error" role="alert">
        Websites could not be loaded. <button type="button" onClick={() => void loadSites()}>Retry</button>
      </p>}
      {!authLoading && !isAdmin && <p className="global-search-message">Sign in as the site owner to search websites too.</p>}
      <p className="global-search-sr" role="status" aria-live="polite">{announcement}</p>
      <footer className="global-search-hint" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
        <span><kbd>Enter</kbd> Open</span>
        <span><kbd>Esc</kbd> Close</span>
      </footer>
    </AccessibleDialog>}
  </>;
}
