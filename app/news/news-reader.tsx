"use client";

import { ChevronDown, LayoutGrid, Pencil, Plus, Rss, Tags, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AccessibleDialog } from "../accessible-dialog";
import { useSiteAuth } from "../site-auth";
import type { NewsArticle, NewsFeed } from "../lib/news-server-types";
import "./news.css";

type Dialog = { kind: "feed" | "tag" | "board"; id?: string } | null;
type WatchboardState = { tags: { id: string; name: string }[]; watchboards: { id: string; name: string; tagIds: string[] }[]; sourceTags: Record<string, string[]> };
type Directory = { feeds: NewsFeed[]; selected: string[] };
type PublicArticle = Omit<NewsArticle, "feedId"> & { category: string; sourceKey: number };

function mergeArticles<T extends { id: string; published: number }>(previous: T[], incoming: T[]) {
  const merged = new Map(previous.map((article) => [article.id, article]));
  for (const article of incoming) merged.set(article.id, article);
  return [...merged.values()].sort((a, b) => b.published - a.published || a.id.localeCompare(b.id));
}

function readSidebarLocation() {
  if (typeof window === "undefined") return "articles";
  try {
    return window.localStorage.getItem("site-news-location") || "articles";
  } catch {
    return "articles";
  }
}

function saveSidebarLocation(location: string) {
  try {
    window.localStorage.setItem("site-news-location", location);
  } catch {
    // Sidebar selection still works when browser storage is unavailable.
  }
}

export function NewsReader() {
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
  const [feedFilter, setFeedFilter] = useState<string | null>(null);
  const [initialSidebarLocation] = useState(readSidebarLocation);
  const [boardFilter, setBoardFilter] = useState<string | null>(() =>
    initialSidebarLocation.startsWith("board:") ? initialSidebarLocation.slice("board:".length) : null
  );
  const [panel, setPanel] = useState<"articles" | "sources" | "tags">(() =>
    initialSidebarLocation === "sources" || initialSidebarLocation === "tags" ? initialSidebarLocation : "articles"
  );
  const [watchboards, setWatchboards] = useState<WatchboardState>({ tags: [], watchboards: [], sourceTags: {} });
  const [watchReady, setWatchReady] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [publicArticles, setPublicArticles] = useState<PublicArticle[]>([]);
  const [publicCursor, setPublicCursor] = useState<string | null>(null);
  const [publicArticlesBusy, setPublicArticlesBusy] = useState(true);
  const [publicArticlesError, setPublicArticlesError] = useState(false);

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Session expired. Please sign in again.");
    const response = await fetch(`/api/news${path}`, {
      ...options, cache: "no-store",
      headers: { ...options.headers, Authorization: `Bearer ${session.access_token}` },
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || "News request failed.");
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
      if (currentRequest === requestId.current) setError(failure instanceof Error ? failure.message : "Could not load articles.");
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
          setBoardFilter((savedBoard) => {
            if (!savedBoard || boards.watchboards.some((board) => board.id === savedBoard)) return savedBoard;
            saveSidebarLocation("articles");
            return null;
          });
        } catch (failure) {
          if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not load sources.");
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, loading, isAdmin]);

  useEffect(() => {
    if (!ready || !isAdmin) return;
    const timer = window.setTimeout(() => { void loadArticles(); }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, isAdmin, loadArticles]);

  const invalidatePublicRequests = useCallback(() => { publicRequestId.current++; }, []);

  const loadPublicArticles = useCallback(async (nextCursor: string | null = null) => {
    const currentRequest = ++publicRequestId.current;
    setPublicArticlesBusy(true); setPublicArticlesError(false);
    if (!nextCursor) { setPublicArticles([]); setPublicCursor(null); }
    try {
      const response = await fetch(`/api/news?view=publicArticles${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Articles unavailable.");
      const data = await response.json() as { articles: PublicArticle[]; continuation: string | null };
      if (!Array.isArray(data.articles)) throw new Error("Invalid articles.");
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

  async function mutateWatchboard(action: Record<string, unknown>) {
    setSaving(true); setError("");
    try {
      const data = await api("/watchboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }) as WatchboardState;
      setWatchboards(data);
      if (boardFilter && !data.watchboards.some((board) => board.id === boardFilter)) {
        setBoardFilter(null);
        saveSidebarLocation("articles");
      }
      setDialog(null);
      if (action.action === "setSourceTags" && boardFilter) await loadArticles();
      if ((action.action === "updateWatchboard" && boardFilter === action.id) || (action.action === "deleteTag" && boardFilter)) await loadArticles();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update watchboards."); }
    finally { setSaving(false); }
  }

  function openDialog(kind: "board" | "feed" | "tag", id?: string) {
    setDraftTags(kind === "board" ? [...(watchboards.watchboards.find((board) => board.id === id)?.tagIds || [])]
      : kind === "feed" && id ? [...(watchboards.sourceTags[id] || [])] : []);
    setDialog({ kind, id });
  }

  function chooseBoard(id: string | null) {
    setBoardFilter(id); setFeedFilter(null); setPanel("articles");
    saveSidebarLocation(id ? `board:${id}` : "articles");
  }

  function choosePanel(nextPanel: "sources" | "tags") {
    setPanel(nextPanel);
    saveSidebarLocation(nextPanel);
  }

  async function mutate(action: Record<string, string>) {
    setSaving(true); setError("");
    try {
      const data = await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }) as Directory;
      setFeeds(data.feeds); setSelected(data.selected); setSaved(data.selected);
      setDialog(null);
      if (action.action === "deleteFeed") {
        setWatchboards((previous) => ({ ...previous, sourceTags: Object.fromEntries(Object.entries(previous.sourceTags).filter(([id]) => id !== action.feedId)) }));
        if (feedFilter === action.feedId) setFeedFilter(null);
      }
      if (action.action === "addFeed") {
        const newFeed = data.feeds.find((feed) => !feeds.some((old) => old.id === feed.id));
        if (newFeed) await saveSelection([...data.selected, newFeed.id]);
        else await loadArticles();
      } else await loadArticles();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update News."); }
    finally { setSaving(false); }
  }

  async function removeFeed(feed: NewsFeed) {
    if (!window.confirm(`Unsubscribe from “${feed.title}” and delete its stored articles? This cannot be undone.`)) return;
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
        setDialog(null);
        if (feedId && !dialog.id) await saveSelection([...selected, feedId]);
        else if (boardFilter && tagsChanged) await loadArticles();
      } catch (failure) {
        if (added) setDialog(null);
        const message = failure instanceof Error ? failure.message : "Could not save RSS source.";
        setError(added ? `Source was added, but setup was incomplete: ${message} Edit the source to finish.` : message);
      } finally { setSaving(false); }
    }
  }

  if (loading) return <div className="news-access">Checking your account…</div>;
  if (authError) return <div className="news-access"><p className="news-error" role="alert">{authError}</p><button type="button" onClick={retryAuth}>Retry account check</button></div>;
  if (!isAdmin) {
    return <div className="news-layout">
      <aside className="news-sidebar" id="page-sidebar" aria-label="News navigation">
        <div className="news-sidebar-heading"><h2>Watchboards</h2></div>
        <div className="news-category-row"><button type="button" className="active"><LayoutGrid size={16} /><span>All articles</span></button></div>
        <div className="news-sidebar-heading"><h2>Settings</h2></div>
        <div className="news-category-row"><button type="button" disabled><Rss size={16} /><span>RSS Sources</span></button></div>
        <div className="news-category-row"><button type="button" disabled><Tags size={16} /><span>Tags</span></button></div>
      </aside>
      <section className="news-content">
        <header className="news-heading"><div><p className="section-label">PERSONAL WORKSPACE</p><h1>News</h1><p>Your selected RSS sources, powered by FreshRSS.</p></div></header>
        {publicArticlesError && <p className="news-error" role="alert">Articles are temporarily unavailable.</p>}
        {publicArticlesBusy && <p className="news-empty">Loading articles…</p>}
        {!publicArticlesBusy && !publicArticlesError && !publicArticles.length && <p className="news-empty">No articles here yet.</p>}
        <div className="news-articles">{publicArticles.map((article) => <article className="news-article" key={article.id}>
          <div className="news-meta"><span>{article.source}</span>{article.published > 0 && <time dateTime={new Date(article.published * 1000).toISOString()}>{new Date(article.published * 1000).toLocaleDateString()}</time>}</div>
          <h2>{article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a> : article.title}</h2>
          {article.summary && <p>{article.summary}</p>}
        </article>)}</div>
        {(publicCursor || (publicArticlesBusy && publicArticles.length > 0)) && <button className="news-more" type="button" disabled={publicArticlesBusy} onClick={() => void loadPublicArticles(publicCursor)}>{publicArticlesBusy ? "Loading…" : "Load more"}</button>}
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
    <aside className="news-sidebar" id="page-sidebar" aria-label="News navigation">
      <div className="news-sidebar-heading"><h2>Watchboards</h2><button type="button" title="Create watchboard" aria-label="Create watchboard" disabled={!watchReady || saving} onClick={() => openDialog("board")}><Plus size={14} /></button></div>
      <div className="news-category-row"><button type="button" className={panel === "articles" && !boardFilter && !feedFilter ? "active" : ""} onClick={() => { chooseBoard(null); }}><LayoutGrid size={16} /><span>All articles</span></button></div>
      {watchboards.watchboards.map((board) => <div className="news-category-row" key={board.id}>
        <button type="button" className={boardFilter === board.id && panel === "articles" ? "active" : ""} onClick={() => chooseBoard(board.id)}><LayoutGrid size={16} /><span>{board.name} ({matches(board)})</span></button>
        <span className="news-category-actions"><button type="button" disabled={saving} title={`Edit ${board.name}`} aria-label={`Edit ${board.name}`} onClick={() => openDialog("board", board.id)}><Pencil size={12} /></button><button type="button" disabled={saving} title={`Delete ${board.name}`} aria-label={`Delete ${board.name}`} onClick={() => { if (window.confirm(`Delete watchboard “${board.name}”?`)) void mutateWatchboard({ action: "deleteWatchboard", id: board.id }); }}><Trash2 size={12} /></button></span>
      </div>)}
      <div className="news-sidebar-heading"><h2>Settings</h2></div>
      <div className="news-category-row"><button type="button" className={panel === "sources" ? "active" : ""} onClick={() => choosePanel("sources")}><Rss size={16} /><span>RSS Sources</span></button></div>
      <div className="news-category-row"><button type="button" className={panel === "tags" ? "active" : ""} onClick={() => choosePanel("tags")}><Tags size={16} /><span>Tags</span></button></div>
      {saving && <div className="news-source-status" role="status">Saving…</div>}
    </aside>
    <section className="news-content">
      <header className="news-heading"><div><p className="section-label">PERSONAL WORKSPACE</p><h1>{panel === "sources" ? "RSS Sources" : panel === "tags" ? "Tags" : activeBoard?.name || feeds.find((feed) => feed.id === feedFilter)?.title || "News"}</h1><p>{activeBoard ? `${matches(activeBoard)} matching sources` : panel === "sources" ? `${feeds.length} subscriptions · manage and tag your feeds` : panel === "tags" ? "Organize sources into watchboards." : "Your selected RSS sources, powered by FreshRSS."}</p></div>{panel !== "articles" && <div className="news-heading-actions">
        {panel === "sources" ? <button type="button" className="news-add-action" disabled={!ready || saving} onClick={() => openDialog("feed")}><Plus size={15} /> RSS Source</button> : <button type="button" className="news-add-action" disabled={saving || !watchReady} onClick={() => openDialog("tag")}><Plus size={15} /> Tag</button>}
      </div>}</header>
      {error && <p className="news-error" role="alert">{error}</p>}
      {panel === "sources" ? <><div className="news-table-controls"><label>Search sources <input type="search" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Filter sources…" /></label></div><div className="news-table-scroll"><table className="news-table"><thead><tr><th>Source</th><th>Tags</th><th>In Articles</th><th>Actions</th></tr></thead><tbody>{filteredFeeds.map((feed) => <tr key={feed.id}><td><button type="button" className="news-link-button" onClick={() => { chooseBoard(null); setFeedFilter(feed.id); }}>{feed.title}</button></td><td><div className="news-tag-list">{watchboards.tags.filter((tag) => (watchboards.sourceTags[feed.id] || []).includes(tag.id)).map((tag) => <span key={tag.id} className="news-tag-choice">{tag.name}</span>)}{!(watchboards.sourceTags[feed.id] || []).length && <span className="news-muted">No tags</span>}</div></td><td><input type="checkbox" disabled={saving} checked={selected.includes(feed.id)} onChange={() => void toggleSource(feed.id)} aria-label={`Include ${feed.title} in Articles`} /></td><td><span className="news-inline-actions"><button type="button" disabled={saving} title={`Edit ${feed.title}`} aria-label={`Edit ${feed.title}`} onClick={() => openDialog("feed", feed.id)}><Pencil size={12} /></button><button type="button" disabled={saving} title={`Delete ${feed.title}`} aria-label={`Delete ${feed.title}`} onClick={() => void removeFeed(feed)}><Trash2 size={12} /></button></span></td></tr>)}</tbody></table></div>{!filteredFeeds.length && <p className="news-empty">No matching sources.</p>}</> : panel === "tags" ? <><p className="news-muted">Tags are assigned to RSS sources. A watchboard shows articles from sources matching all of its tags.</p><div className="news-settings-list">{watchboards.tags.map((tag) => <div key={tag.id} className="news-settings-row"><span>{tag.name} <small>({feeds.filter((feed) => (watchboards.sourceTags[feed.id] || []).includes(tag.id)).length} sources)</small></span><span className="news-inline-actions"><button type="button" disabled={saving} title={`Rename ${tag.name}`} aria-label={`Rename ${tag.name}`} onClick={() => openDialog("tag", tag.id)}><Pencil size={12} /></button><button type="button" disabled={saving} title={`Delete ${tag.name}`} aria-label={`Delete ${tag.name}`} onClick={() => { if (window.confirm(`Delete tag “${tag.name}” from all sources and watchboards?`)) void mutateWatchboard({ action: "deleteTag", id: tag.id }); }}><Trash2 size={12} /></button></span></div>)}{!watchboards.tags.length && <p className="news-empty">No tags yet. Add one to start grouping your sources.</p>}</div></> : <>
        {!ready && !error && <p className="news-empty">Loading your subscriptions…</p>}
        {ready && activeBoard && !matches(activeBoard) && <p className="news-empty">No sources match this watchboard. Assign its tags to sources under Settings → RSS Sources.</p>}
        {ready && !activeBoard && !feedFilter && !saved.length && <p className="news-empty">Select sources under Settings → RSS Sources to start reading.</p>}
        {ready && !visible.length && !busy && !error && (activeBoard ? matches(activeBoard) > 0 : saved.length > 0 || !!feedFilter) && <p className="news-empty">No articles here yet. Try loading more or choose other sources.</p>}
        <div className="news-articles">{visible.map((article) => <article className="news-article" key={article.id}><div className="news-meta"><span>{article.source}</span>{article.published > 0 && <time dateTime={new Date(article.published * 1000).toISOString()}>{new Date(article.published * 1000).toLocaleDateString()}</time>}</div><h2>{article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a> : article.title}</h2>{article.summary && <p>{article.summary}</p>}</article>)}</div>
        {ready && (activeBoard ? matches(activeBoard) > 0 : saved.length > 0 || !!feedFilter) && (cursor || busy) && <button className="news-more" type="button" disabled={busy || saving} onClick={() => void loadArticles(cursor)}>{busy ? "Loading…" : "Load more"}</button>}
      </>}
    </section>
    {dialog && <AccessibleDialog labelledBy="news-dialog-title" busy={saving} onClose={() => setDialog(null)}><header><h2 id="news-dialog-title">{dialog.id ? "Edit" : "Add"} {dialog.kind === "feed" ? "RSS source" : dialog.kind === "board" ? "watchboard" : dialog.kind}</h2><button type="button" disabled={saving} onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></header><form onSubmit={(event) => void submit(event)}>
      {dialog.kind === "feed" ? <><label>Website or RSS URL{dialog.id ? <input type="url" defaultValue={editedFeed?.url || ""} readOnly /> : <input name="url" type="url" placeholder="https://example.com/news" autoFocus required />}</label><label>Display name (optional)<input name="title" defaultValue={editedFeed?.title || ""} maxLength={200} autoFocus={!!dialog.id} /></label></> : <label>{dialog.kind === "tag" ? "Tag" : "Watchboard"} name<input name="name" defaultValue={editedTag?.name || editedBoard?.name || ""} maxLength={80} autoFocus required /></label>}
      {dialog.kind === "feed" && <details className="news-source-tags"><summary>Source tags{draftTags.length > 0 && <span>({draftTags.length} selected)</span>}<ChevronDown size={15} aria-hidden="true" /></summary><div className="news-source-tags-options">{popularTags.map(({ tag }) => <label key={tag.id}><input type="checkbox" checked={draftTags.includes(tag.id)} onChange={() => setDraftTags((old) => old.includes(tag.id) ? old.filter((id) => id !== tag.id) : [...old, tag.id])} />{tag.name}</label>)}{!popularTags.length && <p>Create tags under Settings → Tags first.</p>}</div></details>}
      {dialog.kind === "board" && <details className="news-source-tags"><summary>Matching tags (all){draftTags.length > 0 && <span>({draftTags.length} selected)</span>}<ChevronDown size={15} aria-hidden="true" /></summary><div className="news-source-tags-options">{watchboards.tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={draftTags.includes(tag.id)} onChange={() => setDraftTags((old) => old.includes(tag.id) ? old.filter((id) => id !== tag.id) : [...old, tag.id])} />{tag.name}</label>)}{!watchboards.tags.length && <p>Create tags under Settings → Tags first.</p>}</div></details>}
      {error && <p className="form-error" role="alert">{error}</p>}<footer><button type="button" disabled={saving} onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary" disabled={saving || (dialog.kind === "feed" && !watchReady)}>{saving ? "Saving…" : "Save"}</button></footer>
    </form></AccessibleDialog>}
  </div>;
}
