import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { SiteShell } from "../site-shell";
import { forumTopicPage } from "../lib/forums";
import { loadForumDirectory } from "../lib/forums-directory";
import { ForumsSidebar } from "./forums-sidebar";
import { ForumsTopicList } from "./forums-topic-list";
import "./forums.css";

export const metadata: Metadata = { title: "Forums" };
export const dynamic = "force-dynamic";

export default async function ForumsPage({ searchParams }: PageProps<"/forums">) {
  let directory;
  try { directory = await loadForumDirectory(); }
  catch { return <SiteShell active="/forums" title="Forums"><p className="forums-warning">Forum sources are temporarily unavailable.</p></SiteShell>; }
  const { category: requested, source: requestedSource } = await searchParams;
  const sourceId = typeof requestedSource === "string" && directory.sources.some((source) => source.id === requestedSource) ? requestedSource : null;
  const categoryId = !sourceId && typeof requested === "string" && directory.categories.some((category) => category.id === requested) ? requested : null;
  const sources = directory.sources.filter((source) => sourceId ? source.id === sourceId : source.selected && (!categoryId || source.categoryId === categoryId));
  const heading = directory.sources.find((source) => source.id === sourceId)?.name ?? directory.categories.find((category) => category.id === categoryId)?.name ?? "All discussions";
  let page;
  try { page = await forumTopicPage(sourceId, categoryId); }
  catch { page = { topics: [], failed: sources.map((source) => source.name), continuation: null }; }

  return <SiteShell active="/forums" title="Forums" hasSidebar>
    <div className="forums-layout">
      <ForumsSidebar directory={directory} activeCategory={categoryId} activeSource={sourceId} />
      <section className="forums-content">
        <header className="forums-heading"><div><p className="section-label">FORUMS</p><h1>{heading}</h1><p>Discussions from forums and communities, ordered by posting date</p></div><MessagesSquare size={25} aria-hidden="true" /></header>
        <ForumsTopicList key={`${sourceId ?? "all"}:${categoryId ?? "all"}`} initial={page} sourceId={sourceId} categoryId={categoryId} hasSources={sources.length > 0} />
      </section>
    </div>
  </SiteShell>;
}
