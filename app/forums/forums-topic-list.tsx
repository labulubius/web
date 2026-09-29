"use client";

import { useState } from "react";
import { MessageCircle, TrendingUp } from "lucide-react";
import type { ForumListedTopic, ForumTopicPage } from "../lib/forums";

const providerNames = { discourse: "Discourse", v2ex: "V2EX", hackernews: "Hacker News", stackexchange: "Stack Exchange", reddit: "Reddit", rss: "RSS" } as const;

function mergeTopics(current: ForumListedTopic[], incoming: ForumListedTopic[]) {
  const merged = new Map(current.map((item) => [`${item.source.id}:${item.topic.id}`, item]));
  for (const item of incoming) merged.set(`${item.source.id}:${item.topic.id}`, item);
  return [...merged.values()].sort((a, b) => Date.parse(b.topic.bumpedAt) - Date.parse(a.topic.bumpedAt) || `${a.source.id}:${a.topic.id}`.localeCompare(`${b.source.id}:${b.topic.id}`));
}

export function ForumsTopicList({ initial, sourceId, categoryId, hasSources }: { initial: ForumTopicPage; sourceId: string | null; categoryId: string | null; hasSources: boolean }) {
  const [topics, setTopics] = useState(initial.topics);
  const [continuation, setContinuation] = useState(initial.continuation);
  const [failed, setFailed] = useState(initial.failed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadMore() {
    if (continuation === null || loading) return;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ view: "aggregate", cursor: continuation });
      if (sourceId) query.set("source", sourceId);
      if (categoryId) query.set("category", categoryId);
      const response = await fetch(`/api/forums?${query}`);
      if (!response.ok) throw new Error("Could not load more discussions.");
      const page = await response.json() as ForumTopicPage;
      setTopics((current) => mergeTopics(current, page.topics));
      setFailed((current) => [...new Set([...current, ...page.failed])]);
      setContinuation(page.continuation === continuation ? null : page.continuation);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load more discussions."); }
    finally { setLoading(false); }
  }

  return <>
    {failed.length > 0 && <p className="forums-warning" role="status">Could not load: {failed.join(", ")}. Other communities are still shown.</p>}
    {topics.length === 0 && <p className="forums-empty">{hasSources ? "No discussions available right now." : "Select a community source under Settings to see discussions."}</p>}
    <div className="forums-topics">
      {topics.map(({ topic, source }) => <article className="forums-topic" key={`${source.id}-${topic.id}`}>
        <div className="forums-topic-meta"><span>{source.name}</span><small>{providerNames[source.kind]}</small>{topic.author && <small>by {topic.author}</small>}<time dateTime={topic.bumpedAt}>{new Date(topic.bumpedAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</time></div>
        <h2><a href={topic.url} target="_blank" rel="noopener noreferrer">{topic.title}</a></h2>
        {topic.summary && <p className="forums-topic-summary">{topic.summary}</p>}
        <div className="forums-topic-foot"><span><MessageCircle size={14} aria-hidden="true" /> {topic.replyCount} {topic.replyCount === 1 ? "reply" : "replies"}</span>{typeof topic.score === "number" && <span><TrendingUp size={14} aria-hidden="true" /> {topic.score}</span>}<a href={topic.url} target="_blank" rel="noopener noreferrer">Original discussion ↗</a></div>
      </article>)}
    </div>
    {error && <p className="forums-warning" role="alert">{error}</p>}
    {continuation !== null && <div className="forums-load-more"><button type="button" disabled={loading} onClick={loadMore}>{loading ? "Loading…" : "Load more"}</button></div>}
  </>;
}
