"use client";

import { Newspaper, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSiteAuth } from "../site-auth";
import type { NewsArticle, NewsFeed } from "../lib/news-server-types";
import "./news.css";

export function NewsReader() {
  const { supabase, loading, isAdmin } = useSiteAuth();
  const [feeds, setFeeds] = useState<NewsFeed[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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
          const data = await api("?view=feeds") as { feeds: NewsFeed[]; selected: string[] };
          if (cancelled) return;
          setFeeds(data.feeds);
          setSelected(data.selected);
          setSaved(data.selected);
          setReady(true);
          await loadArticles();
        } catch (failure) {
          if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not load sources.");
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, loading, isAdmin, loadArticles]);

  const categories = useMemo(() => {
    const groups = new Map<string, NewsFeed[]>();
    for (const feed of feeds.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()) || item.category.toLowerCase().includes(search.toLowerCase()))) {
      groups.set(feed.category, [...(groups.get(feed.category) || []), feed]);
    }
    return groups;
  }, [feeds, search]);
  const dirty = selected.length !== saved.length || selected.some((id) => !saved.includes(id));

  async function save() {
    setSaving(true);
    setError("");
    try {
      const data = await api("", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected }) }) as { selected: string[] };
      setSaved(data.selected);
      await loadArticles();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save sources.");
    } finally { setSaving(false); }
  }

  function toggle(id: string) {
    setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  }

  if (loading) return <div className="news-access">Checking your account…</div>;
  if (!isAdmin) return <div className="news-access"><Newspaper size={30} /><h1>Private News</h1><p>Sign in with the site owner account to read News.</p></div>;

  return <div className="news-layout">
    <aside className="news-sidebar" id="page-sidebar" aria-label="News sources">
      <h2>Sources</h2>
      <p>Choose which FreshRSS subscriptions appear here.</p>
      <label className="news-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a source" aria-label="Find a source" /></label>
      <div className="news-source-list">
        {[...categories.entries()].map(([name, list]) => <section key={name}>
          <h3>{name}</h3>
          {list.map((feed) => <label key={feed.id} className="news-source">
            <input type="checkbox" checked={selected.includes(feed.id)} onChange={() => toggle(feed.id)} />
            <span title={feed.title}>{feed.title}</span>
          </label>)}
        </section>)}
      </div>
      {ready && <div className="news-source-actions"><span>{selected.length} of {feeds.length} selected</span><button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save selection"}</button></div>}
    </aside>
    <section className="news-content">
      <header className="news-heading"><div><p className="section-label">PERSONAL WORKSPACE</p><h1>News</h1><p>Your selected RSS sources, powered by FreshRSS.</p></div><button type="button" disabled={busy || !ready || dirty} onClick={() => void loadArticles()} aria-label="Refresh articles" title="Refresh articles"><RefreshCw size={18} /></button></header>
      {error && <p className="news-error" role="alert">{error}</p>}
      {dirty && <p className="news-hint">Save your source selection to update the articles.</p>}
      {!ready && !error && <p className="news-empty">Loading your subscriptions…</p>}
      {ready && !saved.length && <p className="news-empty">Select sources in the sidebar, then save your selection to start reading.</p>}
      {ready && !!saved.length && !articles.length && !busy && !error && <p className="news-empty">No articles on this page. Try loading more or choose other sources.</p>}
      <div className="news-articles">{articles.map((article) => <article className="news-article" key={article.id}>
        <div className="news-meta"><span>{article.source}</span>{article.published > 0 && <time dateTime={new Date(article.published * 1000).toISOString()}>{new Date(article.published * 1000).toLocaleDateString()}</time>}</div>
        <h2>{article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a> : article.title}</h2>
        {article.summary && <p>{article.summary}</p>}
      </article>)}</div>
      {ready && saved.length > 0 && (cursor || busy) && <button className="news-more" type="button" disabled={busy || dirty} onClick={() => void loadArticles(cursor)}>{busy ? "Loading…" : "Load more"}</button>}
    </section>
  </div>;
}
