import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, MessagesSquare, TrendingUp } from "lucide-react";
import { SiteShell } from "../site-shell";
import { ForumsSidebar } from "./forums-sidebar";
import { latestTopics, type ForumTopic, type ForumSource } from "../lib/forums";
import { loadForumDirectory } from "../lib/forums-directory";
import "./forums.css";

export const metadata: Metadata = { title: "Communities" };
export const dynamic = "force-dynamic";

type ListedTopic = { topic: ForumTopic; source: ForumSource };
const providerNames: Record<ForumSource["kind"], string> = { discourse: "Discourse", v2ex: "V2EX", hackernews: "Hacker News", stackexchange: "Stack Exchange", reddit: "Reddit", rss: "RSS" };

async function loadSources(sources: ForumSource[]) {
  const results = new Array<PromiseSettledResult<{ source: ForumSource; topics: ForumTopic[] }>>(sources.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, sources.length) }, async () => {
    while (next < sources.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: { source: sources[index], topics: await latestTopics(sources[index]) } }; }
      catch (reason) { console.error(`Community source failed: ${sources[index].name}`, reason instanceof Error ? reason.message : "Unknown error"); results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

export default async function ForumsPage({ searchParams }: PageProps<"/forums">) {
  let directory;
  try { directory = await loadForumDirectory(); }
  catch { return <SiteShell active="/forums" title="Communities"><p className="forums-warning">Community sources are temporarily unavailable.</p></SiteShell>; }
  const { category: requested, source: requestedSource } = await searchParams;
  const sourceId = typeof requestedSource === "string" && directory.sources.some((source) => source.id === requestedSource) ? requestedSource : null;
  const categoryId = !sourceId && typeof requested === "string" && directory.categories.some((category) => category.id === requested) ? requested : null;
  const sources = directory.sources.filter((source) => sourceId ? source.id === sourceId : source.selected && (!categoryId || source.categoryId === categoryId));
  const results = await loadSources(sources);
  const topics: ListedTopic[] = results.flatMap((result) => result.status === "fulfilled" ? result.value.topics.map((topic) => ({ topic, source: result.value.source })) : []);
  topics.sort((a, b) => Date.parse(b.topic.bumpedAt) - Date.parse(a.topic.bumpedAt) || a.topic.id.localeCompare(b.topic.id));
  const failed = results.flatMap((result, index) => result.status === "rejected" ? [sources[index].name] : []);
  const heading = directory.sources.find((source) => source.id === sourceId)?.name ?? directory.categories.find((category) => category.id === categoryId)?.name ?? "All discussions";

  return <SiteShell active="/forums" title="Communities">
    <div className="forums-layout">
      <ForumsSidebar directory={directory} activeCategory={categoryId} activeSource={sourceId} />
      <section className="forums-content">
        <header className="forums-heading"><div><p className="section-label">COMMUNITIES</p><h1>{heading}</h1><p>Discussions from forums and communities, ordered by recent activity</p></div><MessagesSquare size={25} aria-hidden="true" /></header>
        {failed.length > 0 && <p className="forums-warning" role="status">Could not load: {failed.join(", ")}. Other communities are still shown.</p>}
        {topics.length === 0 && <p className="forums-empty">{sources.length ? "No discussions available right now." : "Select a community source under Settings to see discussions."}</p>}
        <div className="forums-topics">
          {topics.map(({ topic, source }) => <article className="forums-topic" key={`${source.id}-${topic.id}`}>
            <div className="forums-topic-meta"><span>{source.name}</span><small>{providerNames[source.kind]}</small>{topic.author && <small>by {topic.author}</small>}<time dateTime={topic.bumpedAt}>{new Date(topic.bumpedAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</time></div>
            <h2><Link href={`/forums/${encodeURIComponent(source.id)}/${encodeURIComponent(topic.id)}`}>{topic.title}</Link></h2>
            {topic.summary && <p className="forums-topic-summary">{topic.summary}</p>}
            <div className="forums-topic-foot"><span><MessageCircle size={14} aria-hidden="true" /> {topic.replyCount} {topic.replyCount === 1 ? "reply" : "replies"}</span>{typeof topic.score === "number" && <span><TrendingUp size={14} aria-hidden="true" /> {topic.score}</span>}<a href={topic.url} target="_blank" rel="noopener noreferrer">Original discussion ↗</a></div>
          </article>)}
        </div>
      </section>
    </div>
  </SiteShell>;
}
