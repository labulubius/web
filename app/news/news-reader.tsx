"use client";

import { ChevronRight, Folder, FolderOpen, LayoutGrid, Newspaper, Pencil, Plus, RefreshCw, Rss, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSiteAuth } from "../site-auth";
import type { NewsArticle, NewsFeed } from "../lib/news-server-types";
import "./news.css";

type Category = { id: string; name: string };
type Dialog = { kind: "category" | "feed"; id?: string } | null;
type Directory = { feeds: NewsFeed[]; categories: Category[]; selected: string[] };

export function NewsReader() {
  const { supabase, loading, isAdmin } = useSiteAuth();
  const [feeds, setFeeds] = useState<NewsFeed[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>([]);

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
    setBusy(true);
    setError("");
    try {
      const data = await api(`?view=articles${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`) as { articles: NewsArticle[]; continuation: string | null };
      setArticles((previous) => nextCursor ? [...previous, ...data.articles] : data.articles);
      setCursor(data.continuation);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load articles.");
    } finally { setBusy(false); }
  }, [api]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await api("?view=feeds") as Directory;
          if (cancelled) return;
          setFeeds(data.feeds); setCategories(data.categories); setSelected(data.selected); setSaved(data.selected); setReady(true);
          await loadArticles();
        } catch (failure) {
          if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not load sources.");
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, loading, isAdmin, loadArticles]);

  // FreshRSS requires its default category internally; keep it out of the News
  // sidebar until a feed is actually assigned to it.
  const displayCategories = useMemo(() => categories.filter((category) =>
    category.name !== "Uncategorized" || feeds.some((feed) => feed.category === category.name)), [categories, feeds]);
  const groups = useMemo(() => displayCategories.map((category) => ({
    category,
    items: feeds.filter((feed) => feed.category === category.name),
  })), [feeds, displayCategories]);
  const activeName = categories.find((category) => category.id === categoryFilter)?.name;
  const visible = activeName ? articles.filter((article) => feeds.some((feed) => feed.id === article.feedId && feed.category === activeName)) : articles;

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

  async function mutate(action: Record<string, string>) {
    setSaving(true); setError("");
    try {
      const data = await api("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }) as Directory;
      setFeeds(data.feeds); setCategories(data.categories); setSelected(data.selected); setSaved(data.selected);
      if (categoryFilter && !data.categories.some((cat) => cat.id === categoryFilter)) setCategoryFilter(null);
      setDialog(null);
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
  async function removeCategory(cat: Category) {
    const count = feeds.filter((feed) => feed.category === cat.name).length;
    if (!window.confirm(`Delete “${cat.name}”, its ${count} subscriptions and their stored articles? This cannot be undone.`)) return;
    await mutate({ action: "deleteCategory", categoryId: cat.id });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    if (dialog.kind === "category") {
      await mutate({ action: dialog.id ? "renameCategory" : "createCategory", ...(dialog.id ? { categoryId: dialog.id } : {}), name: String(form.get("name") || "").trim() });
    } else {
      await mutate({ action: dialog.id ? "editFeed" : "addFeed", ...(dialog.id ? { feedId: dialog.id } : { url: String(form.get("url") || "").trim() }),
        ...(String(form.get("title") || "").trim() ? { title: String(form.get("title")).trim() } : {}), categoryId: String(form.get("category") || "") });
    }
  }

  if (loading) return <div className="news-access">Checking your account…</div>;
  if (!isAdmin) return <div className="news-access"><Newspaper size={30} /><h1>Private News</h1><p>Sign in with the site owner account to read News.</p></div>;

  const editedCategory = dialog?.kind === "category" ? categories.find((cat) => cat.id === dialog.id) : undefined;
  const editedFeed = dialog?.kind === "feed" ? feeds.find((feed) => feed.id === dialog.id) : undefined;
  return <div className="news-layout">
    <aside className="news-sidebar" id="page-sidebar" aria-label="News sources">
      <div className="news-sidebar-heading"><h2>Categories</h2><button onClick={() => setDialog({ kind: "category" })} disabled={!ready || saving} title="Add category" aria-label="Add category" type="button"><Plus size={14} /></button></div>
      <div className="news-category-row"><button className={`news-all${categoryFilter === null ? " active" : ""}`} onClick={() => setCategoryFilter(null)} type="button"><LayoutGrid size={16} /><span>All articles</span></button></div>
      <div className="news-source-list">
        {groups.map(({ category, items }) => <section key={category.id}>
          <div className="news-category-row"><button type="button" className={categoryFilter === category.id ? "active" : ""} aria-expanded={!collapsedCategories.includes(category.id)} aria-controls={`news-feeds-${category.id}`} onClick={() => { setCategoryFilter(category.id); setCollapsedCategories((previous) => previous.includes(category.id) ? previous.filter((id) => id !== category.id) : [...previous, category.id]); }}>{collapsedCategories.includes(category.id) ? <Folder size={16} /> : <FolderOpen size={16} />}<span>{category.name}</span><ChevronRight className={collapsedCategories.includes(category.id) ? "news-disclosure" : "news-disclosure expanded"} size={14} /></button>
            {category.name !== "Uncategorized" && <span className="news-category-actions"><button type="button" title={`Rename ${category.name}`} aria-label={`Rename ${category.name}`} onClick={() => setDialog({ kind: "category", id: category.id })}><Pencil size={12} /></button>
            <button type="button" title={`Delete ${category.name}`} aria-label={`Delete ${category.name}`} onClick={() => void removeCategory(category)}><Trash2 size={12} /></button></span>}
          </div>
          <div id={`news-feeds-${category.id}`} hidden={collapsedCategories.includes(category.id)}>
          {items.map((feed) => <div key={feed.id} className="news-source-row">
            <label className="news-source"><input type="checkbox" checked={selected.includes(feed.id)} disabled={saving} onChange={() => void toggleSource(feed.id)} /><Rss size={14} aria-hidden="true" /><span title={feed.title}>{feed.title}</span></label>
            <span className="news-feed-actions"><button type="button" title={`Edit ${feed.title}`} aria-label={`Edit ${feed.title}`} onClick={() => setDialog({ kind: "feed", id: feed.id })}><Pencil size={12} /></button>
            <button type="button" title={`Unsubscribe ${feed.title}`} aria-label={`Unsubscribe ${feed.title}`} onClick={() => void removeFeed(feed)}><Trash2 size={12} /></button></span>
          </div>)}
          </div>
        </section>)}
      </div>
      {ready && <div className="news-source-actions"><span>{selected.length} of {feeds.length} selected</span>{saving && <span role="status">Saving…</span>}</div>}
    </aside>
    <section className="news-content">
      <header className="news-heading"><div><p className="section-label">PERSONAL WORKSPACE</p><h1>{activeName || "News"}</h1><p>Your selected RSS sources, powered by FreshRSS.</p></div><div className="news-heading-actions"><button type="button" disabled={busy || !ready || saving} onClick={() => void loadArticles()} aria-label="Refresh articles" title="Refresh articles"><RefreshCw size={18} /></button><button className="news-add-action" type="button" disabled={!ready || saving || !displayCategories.length} title={!displayCategories.length ? "Create a category first" : "Add RSS"} onClick={() => setDialog({ kind: "feed" })}><Plus size={15} /> RSS</button></div></header>
      {error && <p className="news-error" role="alert">{error}</p>}
      {!ready && !error && <p className="news-empty">Loading your subscriptions…</p>}
      {ready && feeds.length === 0 && <div className="news-empty-state"><Rss size={48} strokeWidth={1.2} /><h2>No subscriptions yet</h2><p>{displayCategories.length ? "Use the RSS button above to add your first subscription." : "Create a category, then use the RSS button above to add a subscription."}</p></div>}
      {ready && feeds.length > 0 && !saved.length && <p className="news-empty">Select a source in the sidebar to start reading.</p>}
      {ready && !!saved.length && !visible.length && !busy && !error && <p className="news-empty">No articles here yet. Try loading more or choose other sources.</p>}
      <div className="news-articles">{visible.map((article) => <article className="news-article" key={article.id}>
        <div className="news-meta"><span>{article.source}</span>{article.published > 0 && <time dateTime={new Date(article.published * 1000).toISOString()}>{new Date(article.published * 1000).toLocaleDateString()}</time>}</div>
        <h2>{article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a> : article.title}</h2>
        {article.summary && <p>{article.summary}</p>}
      </article>)}</div>
      {ready && saved.length > 0 && (cursor || busy) && <button className="news-more" type="button" disabled={busy || saving} onClick={() => void loadArticles(cursor)}>{busy ? "Loading…" : "Load more"}</button>}
    </section>
    {dialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDialog(null); }}>
      <section className="breeze-dialog" role="dialog" aria-modal="true" aria-labelledby="news-dialog-title">
        <header><h2 id="news-dialog-title">{dialog.kind === "category" ? `${dialog.id ? "Rename" : "Add"} category` : `${dialog.id ? "Edit" : "Add"} RSS subscription`}</h2><button type="button" disabled={saving} onClick={() => setDialog(null)} aria-label="Close"><X size={17} /></button></header>
        <form onSubmit={(event) => void submit(event)}>
          {dialog.kind === "category" ? <label>Category name<input name="name" defaultValue={editedCategory?.name || ""} maxLength={100} autoFocus required /></label> : <>
            {!dialog.id && <label>RSS URL<input name="url" type="url" placeholder="https://example.com/feed.xml" autoFocus required /></label>}
            <label>Display name (optional)<input name="title" defaultValue={editedFeed?.title || ""} maxLength={200} /></label>
            <label>Category<select name="category" defaultValue={displayCategories.find((cat) => cat.name === editedFeed?.category)?.id || categoryFilter || displayCategories[0]?.id} required>{displayCategories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label>
          </>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer><button type="button" onClick={() => setDialog(null)} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving || (dialog.kind === "feed" && !displayCategories.length)}>{saving ? "Saving…" : "Save"}</button></footer>
          {dialog.kind === "feed" && !displayCategories.length && <p>Create a category first.</p>}
        </form>
      </section>
    </div>}
  </div>;
}
