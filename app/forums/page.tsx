import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, MessagesSquare } from "lucide-react";
import { SiteShell } from "../site-shell";
import { ForumsInteraction } from "./forums-interaction";
import { forumSources, latestTopics, type ForumTopic, type ForumSource } from "../lib/forums";
import "./forums.css";

export const metadata: Metadata = { title: "Forums" };

type ListedTopic = { topic: ForumTopic; source: ForumSource };

export default async function ForumsPage({ searchParams }: PageProps<"/forums">) {
  const { source: requested } = await searchParams;
  const sourceId = typeof requested === "string" && forumSources.some((source) => source.id === requested) ? requested : null;
  const sources = sourceId ? forumSources.filter((source) => source.id === sourceId) : forumSources;
  const results = await Promise.allSettled(sources.map(async (source) => ({ source, topics: await latestTopics(source) })));
  const topics: ListedTopic[] = results.flatMap((result) => result.status === "fulfilled"
    ? result.value.topics.map((topic) => ({ topic, source: result.value.source })) : []);
  topics.sort((a, b) => Date.parse(b.topic.bumped_at) - Date.parse(a.topic.bumped_at));
  const failed = results.flatMap((result, index) => result.status === "rejected" ? [sources[index].name] : []);

  return <SiteShell active="/forums" title="Forums">
    <div className="forums-layout">
      <aside className="forums-sidebar" aria-label="Forum sources">
        <h2>Sources</h2>
        <Link className={!sourceId ? "selected" : ""} href="/forums">All communities</Link>
        {forumSources.map((source) => <Link className={sourceId === source.id ? "selected" : ""} href={`/forums?source=${source.id}`} key={source.id}>{source.name}</Link>)}
        <p>Public conversations. Replies remain on their original sites.</p>
      </aside>
      <ForumsInteraction className="forums-content">
        <header className="forums-heading"><div><p className="section-label">COMMUNITIES</p><h1>Forums</h1><p>Recent discussions across the web · updated about every 5 minutes</p></div><MessagesSquare size={25} aria-hidden="true" /></header>
        {failed.length > 0 && <p className="forums-warning" role="status">Could not load: {failed.join(", ")}. Try again later.</p>}
        {topics.length === 0 && <p className="forums-empty">No discussions available right now.</p>}
        <div className="forums-topics">
          {topics.map(({ topic, source }) => <article className="forums-topic" key={`${source.id}-${topic.id}`}>
            <div className="forums-topic-meta"><span>{source.name}</span><time dateTime={topic.bumped_at}>{new Date(topic.bumped_at).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</time></div>
            <h2><Link href={`/forums/${source.id}/${topic.id}`}>{topic.title}</Link></h2>
            <div className="forums-topic-foot"><span><MessageCircle size={14} aria-hidden="true" /> {topic.reply_count} replies</span>{topic.closed && <span>Closed</span>}<a href={`${source.origin}/t/${topic.id}`} target="_blank" rel="noopener noreferrer">Original discussion ↗</a></div>
          </article>)}
        </div>
      </ForumsInteraction>
    </div>
  </SiteShell>;
}
