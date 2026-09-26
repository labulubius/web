import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, MessagesSquare } from "lucide-react";
import { SiteShell } from "../site-shell";
import { ForumsInteraction } from "./forums-interaction";
import { ForumsSidebar } from "./forums-sidebar";
import { latestTopics, type ForumTopic, type ForumSource } from "../lib/forums";
import { loadForumDirectory } from "../lib/forums-directory";
import "./forums.css";

export const metadata: Metadata = { title: "Forums" };
export const dynamic = "force-dynamic";

type ListedTopic = { topic: ForumTopic; source: ForumSource };

export default async function ForumsPage({ searchParams }: PageProps<"/forums">) {
  let directory;
  try { directory = await loadForumDirectory(); }
  catch { return <SiteShell active="/forums" title="Forums"><p className="forums-warning">Forum sources are temporarily unavailable.</p></SiteShell>; }
  const { category: requested } = await searchParams;
  const categoryId = typeof requested === "string" && directory.categories.some((category) => category.id === requested) ? requested : null;
  const sources = directory.sources.filter((source) => source.selected && (!categoryId || source.categoryId === categoryId));
  const results = await Promise.allSettled(sources.map(async (source) => ({ source, topics: await latestTopics(source) })));
  const topics: ListedTopic[] = results.flatMap((result) => result.status === "fulfilled"
    ? result.value.topics.map((topic) => ({ topic, source: result.value.source })) : []);
  topics.sort((a, b) => Date.parse(b.topic.bumped_at) - Date.parse(a.topic.bumped_at));
  const failed = results.flatMap((result, index) => result.status === "rejected" ? [sources[index].name] : []);

  return <SiteShell active="/forums" title="Forums">
    <div className="forums-layout">
      <ForumsSidebar directory={directory} activeCategory={categoryId} />
      <ForumsInteraction className="forums-content">
        <header className="forums-heading"><div><p className="section-label">COMMUNITIES</p><h1>{directory.categories.find((category) => category.id === categoryId)?.name ?? "Forums"}</h1><p>Recent discussions across the web · updated about every 5 minutes</p></div><MessagesSquare size={25} aria-hidden="true" /></header>
        {failed.length > 0 && <p className="forums-warning" role="status">Could not load: {failed.join(", ")}. Try again later.</p>}
        {topics.length === 0 && <p className="forums-empty">{sources.length ? "No discussions available right now." : "Select a forum source in the sidebar to see discussions."}</p>}
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
