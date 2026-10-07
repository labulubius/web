"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, LayoutGrid, Pencil, Plus, Rss, Search, Tags, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import { useSiteAuth } from "../site-auth";
import type { NewsArticle, NewsFeed } from "../lib/news-server-types";
import "./feeds.css";

type Dialog = { kind: "feed" | "tag" | "board"; id?: string } | null;
type Watchboard = { id: string; name: string; tagIds: string[] };
type WatchboardState = { tags: { id: string; name: string }[]; watchboards: Watchboard[]; sourceTags: Record<string, string[]> };
type Directory = { feeds: NewsFeed[]; selected: string[] };
function mergeArticles<T extends { id: string; published: number }>(previous: T[], incoming: T[]) {
  const merged = new Map(previous.map((article) => [article.id, article]));
  for (const article of incoming) merged.set(article.id, article);
  return [...merged.values()].sort((a, b) => b.published - a.published || a.id.localeCompare(b.id));
}

function readSidebarLocation() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("site-news-location");
  } catch {
    return null;
  }
}

function saveSidebarLocation(location: string) {
  try {
    window.localStorage.setItem("site-news-location", location);
  } catch {
    // Sidebar selection still works when browser storage is unavailable.
  }
}

function SortableWatchboardRow({ board, active, disabled, onSelect, onEdit, onDelete }: {
  board: Watchboard;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: board.id, disabled });
  return <div
    className={`news-category-row reorderable${isDragging ? " dragging" : ""}`}
    ref={setNodeRef}
    style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}
  >
    <button type="button" className={active ? "active" : ""} onClick={onSelect} {...attributes} {...listeners}>
      <LayoutGrid size={16} /><span title={board.name}>{board.name}</span>
    </button>
    <span className="news-category-actions" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" disabled={disabled} title={`Edit ${board.name}`} aria-label={`Edit ${board.name}`} onClick={onEdit}><Pencil size={12} /></button>
      <button type="button" disabled={disabled} title={`Delete ${board.name}`} aria-label={`Delete ${board.name}`} onClick={onDelete}><Trash2 size={12} /></button>
    </span>
  </div>;
}

function NewsArticleItem({ article }: { article: NewsArticle }) {
  const content = <div className="news-article-content">
    <div className="news-article-copy">
      <h2>{article.title}</h2>
      {article.summary && <p>{article.summary}</p>}
    </div>
    <div className="news-article-meta">
      <span title={article.source}>{article.source}</span>
      {article.published > 0 && <time dateTime={new Date(article.published * 1000).toISOString()}>{new Date(article.published * 1000).toLocaleDateString()}</time>}
    </div>
  </div>;

  return <article className="news-article">
    {article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{content}</a> : content}
  </article>;
}

export function FeedsReader() {
  const { supabase, loading, isAdmin, authError, retryAuth } = useSiteAuth();
  const [feeds, setFeeds] = useState<NewsFeed[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const requestId = useRef(0);
  const publicRequestId = useRef(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [initialSidebarLocation] = useState(readSidebarLocation);
  const [feedFilter, setFeedFilter] = useState<string | null>(() =>
    initialSidebarLocation?.startsWith("source:") ? initialSidebarLocation.slice("source:".length) : null
  );
  const [boardFilter, setBoardFilter] = useState<string | null>(() =>
    initialSidebarLocation?.startsWith("board:") ? initialSidebarLocation.slice("board:".length) : null
  );
  const [panel, setPanel] = useState<"articles" | "sources" | "tags">(() =>
    initialSidebarLocation === "sources" || initialSidebarLocation === "tags" ? initialSidebarLocation : "articles"
  );
  const [watchboards, setWatchboards] = useState<WatchboardState>({ tags: [], watchboards: [], sourceTags: {} });
  const [watchReady, setWatchReady] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [publicArticles, setPublicArticles] = useState<NewsArticle[]>([]);
  const [publicCursor, setPublicCursor] = useState<string | null>(null);
  const [publicArticlesBusy, setPublicArticlesBusy] = useState(true);
  const [publicArticlesError, setPublicArticlesError] = useState(false);
  const articleLoaderRef = useRef<HTMLDivElement>(null);
  const publicArticleLoaderRef = useRef<HTMLDivElement>(null);
  const sourceUrlInputRef = useRef<HTMLInputElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const watchboardSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Session expired. Please sign in again.");
    const response = await fetch(`/api/news${path}`, {
      ...options, cache: "no-store",
      headers: { ...options.headers, Authorization: `Bearer ${session.access_token}` },
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || "Feeds request failed.");
    return body;
  }, [supabase]);

  const loadArticles = useCallback(async (nextCursor: string | null = null) => {
    const currentRequest = ++requestId.current;
    setBusy(true);
    setError("");
    if (!nextCursor) { setArticles([]); setCursor(null); }
    try {
      const data = await api(`?view=articles${boardFilter ? `&board=${encodeURIComponent(boardFilter)}` : feedFilter ? `&feed=${encodeURIComponent(feedFilter)}` : ""}${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`) as { articles: NewsArticle[]; continuation: string | null };
      if (currentRequest !== requestId.current) return;
      setArticles((previous) => mergeArticles(nextCursor ? previous : [], data.articles));
      setCursor(data.continuation);
    } catch (failure) {
      if (currentRequest === requestId.current) setError(failure instanceof Error ? failure.message : "Could not load items.");
    } finally { if (currentRequest === requestId.current) setBusy(false); }
  }, [api, feedFilter, boardFilter]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await api("?view=feeds") as Directory;
          if (cancelled) return;
          const boards = await api("/watchboards") as WatchboardState;
          if (cancelled) return;
          setFeeds(data.feeds); setSelected(data.selected); setSaved(data.selected); setReady(true);
          setWatchboards(boards); setWatchReady(true);
          const savedBoard = initialSidebarLocation?.startsWith("board:") ? initialSidebarLocation.slice("board:".length) : null;
          const savedSource = initialSidebarLocation?.startsWith("source:") ? initialSidebarLocation.slice("source:".length) : null;
          if (savedBoard && boards.watchboards.some((board) => board.id === savedBoard)) {
            setBoardFilter(savedBoard); setFeedFilter(null); setPanel("articles");
          } else if (savedSource && data.feeds.some((feed) => feed.id === savedSource)) {
            setBoardFilter(null); setFeedFilter(savedSource); setPanel("articles");
          } else if (initialSidebarLocation === "sources" || initialSidebarLocation === "tags") {
            setBoardFilter(null); setFeedFilter(null); setPanel(initialSidebarLocation);
          } else {
            const firstBoard = boards.watchboards[0];
            setBoardFilter(firstBoard?.id ?? null); setFeedFilter(null); setPanel(firstBoard ? "articles" : "sources");
            saveSidebarLocation(firstBoard ? `board:${firstBoard.id}` : "sources");
          }
        } catch (failure) {
          if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not load sources.");
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, initialSidebarLocation, loading, isAdmin]);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    const timer = window.setTimeout(() => { void loadArticles(); }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, isAdmin, loadArticles]);

  useEffect(() => {
    if (dialog?.kind !== "feed" || dialog.id) return;
    const frame = window.requestAnimationFrame(() => sourceUrlInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [dialog]);

  useEffect(() => {
    const target = articleLoaderRef.current;
    if (!target || !cursor || busy || saving || panel !== "articles") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadArticles(cursor);
    }, { rootMargin: "400px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, busy, saving, panel, loadArticles]);

  const invalidatePublicRequests = useCallback(() => { publicRequestId.current++; }, []);

  const loadPublicArticles = useCallback(async (nextCursor: string | null = null) => {
    const currentRequest = ++publicRequestId.current;
    setPublicArticlesBusy(true); setPublicArticlesError(false);
    if (!nextCursor) { setPublicArticles([]); setPublicCursor(null); }
    try {
      const response = await fetch(`/api/news?view=publicArticles${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`);
      if (!response.ok) throw new Error("Items unavailable.");
      const data = await response.json() as { articles: NewsArticle[]; continuation: string | null };
      if (!Array.isArray(data.articles)) throw new Error("Invalid items.");
      if (currentRequest !== publicRequestId.current) return;
      setPublicArticles((previous) => mergeArticles(nextCursor ? previous : [], data.articles));
      setPublicCursor(data.continuation === nextCursor ? null : data.continuation);
    } catch { if (currentRequest === publicRequestId.current) setPublicArticlesError(true); }
    finally { if (currentRequest === publicRequestId.current) setPublicArticlesBusy(false); }
  }, []);

  useEffect(() => {
    if (loading || isAdmin) { invalidatePublicRequests(); return; }
    const timer = window.setTimeout(() => { void loadPublicArticles(); }, 0);
    return () => { window.clearTimeout(timer); invalidatePublicRequests(); };
  }, [loading, isAdmin, loadPublicArticles, invalidatePublicRequests]);

  useEffect(() => {
    const target = publicArticleLoaderRef.current;
    if (!target || !publicCursor || publicArticlesBusy || isAdmin) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadPublicArticles(publicCursor);
    }, { rootMargin: "400px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [publicCursor, publicArticlesBusy, isAdmin, loadPublicArticles]);

  const visible = articles;

  async function saveSelection(ids = selected) {
    const data = await api("", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected: ids }) }) as { selected: string[] };
    setSelected(data.selected); setSaved(data.selected);
    await loadArticles();
  }

  async function toggleSource(id: string) {
    if (saving) return;
    const next = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
    setSelected(next);
    setSaving(true);
    setError("");
    try { await saveSelection(next); }
    catch (failure) {
      setSelected(saved);
      setError(failure instanceof Error ? failure.message : "Could not save source selection.");
    } finally { setSaving(false); }
  }

  function showFallbackSidebar(boards = watchboards.watchboards) {
    const firstBoard = boards[0];
    setBoardFilter(firstBoard?.id ?? null); setFeedFilter(null); setPanel(firstBoard ? "articles" : "sources");
    saveSidebarLocation(firstBoard ? `board:${firstBoard.id}` : "sources");
  }

  async function mutateWatchboard(action: Record<string, unknown>) {
    setSaving(true); setError("");
    try {
      const data = await api("/watchboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }) as WatchboardState;
      setWatchboards(data);
      if (boardFilter && !data.watchboards.some((board) => board.id === boardFilter)) showFallbackSidebar(data.watchboards);
      closeDialog();
      if (action.action === "setSourceTags" && boardFilter) await loadArticles();
      if ((action.action === "updateWatchboard" && boardFilter === action.id) || (action.action === "deleteTag" && boardFilter)) await loadArticles();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update watchboards."); }
    finally { setSaving(false); }
  }

  async function handleWatchboardDragEnd(event: DragEndEvent) {
    if (saving || !event.over || event.active.id === event.over.id) return;
    const sourceIndex = watchboards.watchboards.findIndex((board) => board.id === event.active.id);
    const targetIndex = watchboards.watchboards.findIndex((board) => board.id === event.over?.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const previous = watchboards;
    const ordered = arrayMove(previous.watchboards, sourceIndex, targetIndex);
    setWatchboards({ ...previous, watchboards: ordered });
    setSaving(true); setError("");
    try {
      const data = await api("/watchboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "reorderWatchboards", ids: ordered.map((board) => board.id),
      }) }) as WatchboardState;
      setWatchboards(data);
    } catch (failure) {
      setWatchboards(previous);
      setError(failure instanceof Error ? failure.message : "Could not reorder watchboards.");
    } finally { setSaving(false); }
  }

  function closeDialog() {
    const trigger = dialogTriggerRef.current;
    dialogTriggerRef.current = null;
    setDialog(null);
    window.requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); });
  }

  function openDialog(kind: "board" | "feed" | "tag", id?: string) {
    dialogTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraftTags(kind === "board" ? [...(watchboards.watchboards.find((board) => board.id === id)?.tagIds || [])]
      : kind === "feed" && id ? [...(watchboards.sourceTags[id] || [])] : []);
    setDialog({ kind, id });
  }

  function chooseBoard(id: string) {
    setBoardFilter(id); setFeedFilter(null); setPanel("articles");
    saveSidebarLocation(`board:${id}`);
  }

  function chooseFeed(id: string) {
    setBoardFilter(null); setFeedFilter(id); setPanel("articles");
    saveSidebarLocation(`source:${id}`);
  }

  function choosePanel(nextPanel: "sources" | "tags") {
    setBoardFilter(null); setFeedFilter(null); setPanel(nextPanel);
    saveSidebarLocation(nextPanel);
  }

  async function mutate(action: Record<string, string>) {
    setSaving(true); setError("");
    try {
      const data = await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }) as Directory;
      setFeeds(data.feeds); setSelected(data.selected); setSaved(data.selected);
      closeDialog();
      if (action.action === "deleteFeed") {
        setWatchboards((previous) => ({ ...previous, sourceTags: Object.fromEntries(Object.entries(previous.sourceTags).filter(([id]) => id !== action.feedId)) }));
        if (feedFilter === action.feedId) showFallbackSidebar();
      }
      if (action.action === "addFeed") {
        const newFeed = data.feeds.find((feed) => !feeds.some((old) => old.id === feed.id));
        if (newFeed) await saveSelection([...data.selected, newFeed.id]);
        else await loadArticles();
      } else if (!(action.action === "deleteFeed" && feedFilter === action.feedId)) await loadArticles();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update Feeds."); }
    finally { setSaving(false); }
  }

  async function removeFeed(feed: NewsFeed) {
    if (!window.confirm(`Unsubscribe from “${feed.title}” and delete its stored items? This cannot be undone.`)) return;
    await mutate({ action: "deleteFeed", feedId: feed.id });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    if (dialog.kind === "tag") {
      await mutateWatchboard({ action: dialog.id ? "renameTag" : "createTag", ...(dialog.id ? { id: dialog.id } : {}), name: String(form.get("name") || "").trim() });
    } else if (dialog.kind === "board") {
      await mutateWatchboard({ action: dialog.id ? "updateWatchboard" : "createWatchboard", ...(dialog.id ? { id: dialog.id } : {}), name: String(form.get("name") || "").trim(), tagIds: draftTags });
    } else {
      const title = String(form.get("title") || "").trim();
      const existing = dialog.id ? feeds.find((feed) => feed.id === dialog.id) : undefined;
      const oldTags = dialog.id ? watchboards.sourceTags[dialog.id] || [] : [];
      const tagsChanged = draftTags.length !== oldTags.length || draftTags.some((id) => !oldTags.includes(id));
      setSaving(true); setError("");
      let added = false;
      try {
        let feedId = dialog.id;
        if (!dialog.id || (title && title !== existing?.title)) {
          const data = await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            action: dialog.id ? "editFeed" : "addFeed", ...(dialog.id ? { feedId: dialog.id } : { url: String(form.get("url") || "").trim() }),
            ...(title ? { title } : {}),
          }) }) as Directory;
          setFeeds(data.feeds); setSelected(data.selected); setSaved(data.selected);
          if (!dialog.id) {
            added = true;
            feedId = data.feeds.find((feed) => !feeds.some((old) => old.id === feed.id))?.id;
            if (!feedId) throw new Error("Subscription saved, but the new source was not found. Reload before retrying.");
          }
        }
        if (feedId && (tagsChanged || (!dialog.id && draftTags.length))) {
          const data = await api("/watchboards", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "setSourceTags", feedId, tagIds: draftTags }) }) as WatchboardState;
          setWatchboards(data);
        }
        closeDialog();
        if (feedId && !dialog.id) await saveSelection([...selected, feedId]);
        else if (boardFilter && tagsChanged) await loadArticles();
      } catch (failure) {
        if (added) closeDialog();
        const message = failure instanceof Error ? failure.message : "Could not save source.";
        setError(added ? `Source was added, but setup was incomplete: ${message} Edit the source to finish.` : message);
      } finally { setSaving(false); }
    }
  }

  if (loading) return <div className="news-access">Checking your account…</div>;
  if (authError) return <div className="news-access"><p role="alert">{authError}</p><button type="button" onClick={retryAuth}>Retry account check</button></div>;
  if (!isAdmin) {
    return <div className="news-layout">
      <aside className="news-sidebar" id="page-sidebar" aria-label="Feeds navigation">
        <div className="news-sidebar-heading"><h2>Watchboards</h2></div>
        <div className="news-sidebar-heading"><h2>Settings</h2></div>
        <div className="news-category-row"><button type="button" disabled><Rss size={16} /><span>Sources</span></button></div>
        <div className="news-category-row"><button type="button" disabled><Tags size={16} /><span>Tags</span></button></div>
      </aside>
      <section className="news-content">
        <header className="news-heading"><div><p className="section-label">PERSONAL WORKSPACE</p><h1>Feeds</h1><p>Your selected sources, powered by FreshRSS.</p></div></header>
        {publicArticlesBusy && <p className="news-empty">Loading items…</p>}
        {!publicArticlesBusy && !publicArticlesError && !publicArticles.length && <p className="news-empty">No items here yet.</p>}
        <div className="news-articles">{publicArticles.map((article) => <NewsArticleItem article={article} key={article.id} />)}</div>
        {(publicCursor || (publicArticlesBusy && publicArticles.length > 0)) && <div className="news-auto-loader" ref={publicArticleLoaderRef} role="status">{publicArticlesBusy ? "Loading…" : ""}</div>}
      </section>
    </div>;
  }

  const editedFeed = dialog?.kind === "feed" ? feeds.find((feed) => feed.id === dialog.id) : undefined;
  const editedTag = dialog?.kind === "tag" ? watchboards.tags.find((tag) => tag.id === dialog.id) : undefined;
  const editedBoard = dialog?.kind === "board" ? watchboards.watchboards.find((board) => board.id === dialog.id) : undefined;
  const activeBoard = watchboards.watchboards.find((board) => board.id === boardFilter);
  const matches = (board: WatchboardState["watchboards"][number]) => board.tagIds.length ? feeds.filter((feed) => board.tagIds.every((id) => (watchboards.sourceTags[feed.id] || []).includes(id))).length : 0;
  const popularTags = watchboards.tags.map((tag, index) => ({ tag, index, count: feeds.filter((feed) => (watchboards.sourceTags[feed.id] || []).includes(tag.id)).length }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
  const filteredFeeds = feeds.filter((feed) => feed.title.toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title));
  return <div className="news-layout">
    <aside className="news-sidebar" id="page-sidebar" aria-label="Feeds navigation">
      <div className="news-sidebar-heading"><h2>Watchboards</h2><button type="button" title="Create watchboard" aria-label="Create watchboard" disabled={!watchReady || saving} onClick={() => openDialog("board")}><Plus size={14} /></button></div>
      <DndContext sensors={watchboardSensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleWatchboardDragEnd(event)}>
        <SortableContext items={watchboards.watchboards.map((board) => board.id)} strategy={verticalListSortingStrategy}>
          {watchboards.watchboards.map((board) => <SortableWatchboardRow
            board={board}
            active={boardFilter === board.id && panel === "articles"}
            disabled={saving}
            key={board.id}
            onSelect={() => chooseBoard(board.id)}
            onEdit={() => openDialog("board", board.id)}
            onDelete={() => { if (window.confirm(`Delete watchboard “${board.name}”?`)) void mutateWatchboard({ action: "deleteWatchboard", id: board.id }); }}
          />)}
        </SortableContext>
      </DndContext>
      <div className="news-sidebar-heading"><h2>Settings</h2></div>
      <div className="news-category-row"><button type="button" className={panel === "sources" ? "active" : ""} onClick={() => choosePanel("sources")}><Rss size={16} /><span>Sources</span></button></div>
      <div className="news-category-row"><button type="button" className={panel === "tags" ? "active" : ""} onClick={() => choosePanel("tags")}><Tags size={16} /><span>Tags</span></button></div>
      {saving && <div className="news-source-status" role="status">Saving…</div>}
    </aside>
    <section className="news-content">
      <header className="news-heading"><div><p className="section-label">PERSONAL WORKSPACE</p><h1>{panel === "sources" ? "Sources" : panel === "tags" ? "Tags" : activeBoard?.name || feeds.find((feed) => feed.id === feedFilter)?.title || "Feeds"}</h1><p>{activeBoard ? `${matches(activeBoard)} matching sources` : panel === "sources" ? `${feeds.length} subscriptions · manage and tag your feeds` : panel === "tags" ? "Organize sources into watchboards." : "Your selected sources, powered by FreshRSS."}</p></div>{panel !== "articles" && <div className="news-heading-actions">
        {panel === "sources" ? <><label className="news-heading-search"><Search size={15} aria-hidden="true" /><input type="search" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Filter sources…" aria-label="Search sources" /></label><button type="button" className="news-add-action" disabled={!ready || saving} onClick={() => openDialog("feed")}><Plus size={15} /> Source</button></> : <button type="button" className="news-add-action" disabled={saving || !watchReady} onClick={() => openDialog("tag")}><Plus size={15} /> Tag</button>}
      </div>}</header>
      {panel === "sources" ? <><div className="news-table-scroll"><table className="news-table"><thead><tr><th>Source</th><th>Tags</th><th>In All items</th><th>Actions</th></tr></thead><tbody>{filteredFeeds.map((feed) => <tr key={feed.id}><td><button type="button" className="news-link-button" onClick={() => chooseFeed(feed.id)}>{feed.title}</button></td><td><div className="news-tag-list">{watchboards.tags.filter((tag) => (watchboards.sourceTags[feed.id] || []).includes(tag.id)).map((tag) => <span key={tag.id} className="news-tag-choice">{tag.name}</span>)}{!(watchboards.sourceTags[feed.id] || []).length && <span className="news-muted">No tags</span>}</div></td><td><input type="checkbox" disabled={saving} checked={selected.includes(feed.id)} onChange={() => void toggleSource(feed.id)} aria-label={`Include ${feed.title} in All items`} /></td><td><span className="news-inline-actions"><button type="button" disabled={saving} title={`Edit ${feed.title}`} aria-label={`Edit ${feed.title}`} onClick={() => openDialog("feed", feed.id)}><Pencil size={12} /></button><button type="button" disabled={saving} title={`Delete ${feed.title}`} aria-label={`Delete ${feed.title}`} onClick={() => void removeFeed(feed)}><Trash2 size={12} /></button></span></td></tr>)}</tbody></table></div>{!filteredFeeds.length && <p className="news-empty">No matching sources.</p>}</> : panel === "tags" ? <><p className="news-muted">Tags are assigned to sources. A watchboard shows items from sources matching all of its tags.</p><div className="news-settings-list">{watchboards.tags.map((tag) => <div key={tag.id} className="news-settings-row"><span>{tag.name} <small>({feeds.filter((feed) => (watchboards.sourceTags[feed.id] || []).includes(tag.id)).length} sources)</small></span><span className="news-inline-actions"><button type="button" disabled={saving} title={`Rename ${tag.name}`} aria-label={`Rename ${tag.name}`} onClick={() => openDialog("tag", tag.id)}><Pencil size={12} /></button><button type="button" disabled={saving} title={`Delete ${tag.name}`} aria-label={`Delete ${tag.name}`} onClick={() => { if (window.confirm(`Delete tag “${tag.name}” from all sources and watchboards?`)) void mutateWatchboard({ action: "deleteTag", id: tag.id }); }}><Trash2 size={12} /></button></span></div>)}{!watchboards.tags.length && <p className="news-empty">No tags yet. Add one to start grouping your sources.</p>}</div></> : <>
        {!ready && !error && <p className="news-empty">Loading your subscriptions…</p>}
        {ready && activeBoard && !matches(activeBoard) && <p className="news-empty">No sources match this watchboard. Assign its tags to sources under Settings → Sources.</p>}
        {ready && !activeBoard && !feedFilter && !saved.length && <p className="news-empty">Select sources under Settings → Sources to start reading.</p>}
        {ready && !visible.length && !busy && !error && (activeBoard ? matches(activeBoard) > 0 : saved.length > 0 || !!feedFilter) && <p className="news-empty">No items here yet. Try loading more or choose other sources.</p>}
        <div className="news-articles">{visible.map((article) => <NewsArticleItem article={article} key={article.id} />)}</div>
        {ready && (activeBoard ? matches(activeBoard) > 0 : saved.length > 0 || !!feedFilter) && (cursor || busy) && <div className="news-auto-loader" ref={articleLoaderRef} role="status">{busy ? "Loading…" : ""}</div>}
      </>}
    </section>
    {dialog && <AccessibleDialog labelledBy="news-dialog-title" busy={saving} onClose={() => closeDialog()}><header><h2 id="news-dialog-title">{dialog.id ? "Edit" : "Add"} {dialog.kind === "feed" ? "source" : dialog.kind === "board" ? "watchboard" : dialog.kind}</h2><button type="button" disabled={saving} onClick={() => closeDialog()} aria-label="Close"><X size={17} /></button></header><form onSubmit={(event) => void submit(event)}>
      {dialog.kind === "feed" ? <><label>Website or RSS URL{dialog.id ? <input type="url" defaultValue={editedFeed?.url || ""} readOnly /> : <input ref={sourceUrlInputRef} name="url" type="url" placeholder="https://example.com/feed" autoFocus required />}</label><label>Display name (optional)<input name="title" defaultValue={editedFeed?.title || ""} maxLength={200} autoFocus={!!dialog.id} /></label></> : <label>{dialog.kind === "tag" ? "Tag" : "Watchboard"} name<input name="name" defaultValue={editedTag?.name || editedBoard?.name || ""} maxLength={80} autoFocus required /></label>}
      {dialog.kind === "feed" && <details className="news-source-tags"><summary>Source tags{draftTags.length > 0 && <span>({draftTags.length} selected)</span>}<ChevronDown size={15} aria-hidden="true" /></summary><div className="news-source-tags-options">{popularTags.map(({ tag }) => <label key={tag.id}><input type="checkbox" checked={draftTags.includes(tag.id)} onChange={() => setDraftTags((old) => old.includes(tag.id) ? old.filter((id) => id !== tag.id) : [...old, tag.id])} />{tag.name}</label>)}{!popularTags.length && <p>Create tags under Settings → Tags first.</p>}</div></details>}
      {dialog.kind === "board" && <details className="news-source-tags"><summary>Matching tags{draftTags.length > 0 && <span>({draftTags.length} selected)</span>}<ChevronDown size={15} aria-hidden="true" /></summary><div className="news-source-tags-options">{watchboards.tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={draftTags.includes(tag.id)} onChange={() => setDraftTags((old) => old.includes(tag.id) ? old.filter((id) => id !== tag.id) : [...old, tag.id])} />{tag.name}</label>)}{!watchboards.tags.length && <p>Create tags under Settings → Tags first.</p>}</div></details>}
      {error && <p className="form-error" role="alert">{error}</p>}<footer><button type="button" disabled={saving} onClick={() => closeDialog()}>Cancel</button><button type="submit" className="primary" disabled={saving || (dialog.kind === "feed" && !watchReady)}>{saving ? "Saving…" : "Save"}</button></footer>
    </form></AccessibleDialog>}
  </div>;
}
