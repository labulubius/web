import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "../../../site-shell";
import { forumThread } from "../../../lib/forums";
import { loadForumDirectory } from "../../../lib/forums-directory";
import "../../forums.css";

export const metadata: Metadata = { title: "Discussion · Communities" };
const pageSize = 20;

export default async function DiscussionPage({ params, searchParams }: PageProps<"/forums/[source]/[id]">) {
  const { source: sourceId, id } = await params;
  const source = (await loadForumDirectory()).sources.find((item) => item.id === sourceId);
  if (!source || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) notFound();
  const { page: rawPage } = await searchParams;
  const requestedPage = typeof rawPage === "string" && /^[1-9]\d{0,3}$/.test(rawPage) ? Number(rawPage) : 1;
  const page = source.kind === "discourse" ? requestedPage : 1;
  let thread;
  try { thread = await forumThread(source, id, page); }
  catch { return <SiteShell active="/forums" title="Communities"><div className="forums-detail"><Link href="/forums">← Communities</Link><p className="forums-warning">This discussion could not be loaded right now. The provider may be rate limiting requests.</p></div></SiteShell>; }
  const pages = source.kind === "discourse" ? Math.max(1, Math.ceil(thread.totalPosts / pageSize)) : 1;
  if (page > pages) notFound();
  return <SiteShell active="/forums" title="Communities">
    <div className="forums-detail">
      <Link className="forums-back" href="/forums">← All discussions</Link>
      <p className="section-label">{source.name.toUpperCase()}</p>
      <h1>{thread.title}</h1>
      <p className="forums-detail-meta">{thread.totalPosts} {thread.totalPosts === 1 ? "post" : "posts"}{pages > 1 && ` · page ${page} of ${pages}`} · <a href={thread.url} target="_blank" rel="noopener noreferrer">Read on {source.name} ↗</a></p>
      {thread.posts.length === 0 && <p className="forums-warning">Replies are temporarily unavailable. Please read the original discussion.</p>}
      {thread.posts.map((post) => <article className="forums-post" key={post.id} style={post.depth ? { marginLeft: `${Math.min(post.depth, 6) * 14}px` } : undefined}>
        <div className="forums-post-meta"><strong>{post.username || "Anonymous"}</strong><time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time>{typeof post.score === "number" && <span>{post.score} points</span>}<span>#{post.number}</span></div>
        <p>{post.text || "This post has no text content."}</p>
      </article>)}
      {thread.truncated && <p className="forums-note">Only a preview of replies is shown. Open the original discussion to read everything.</p>}
      {pages > 1 && <nav className="forums-pagination" aria-label="Discussion pages">{page > 1 && <Link href={`/forums/${sourceId}/${id}?page=${page - 1}`}>← Previous 20</Link>}{page < pages && <Link href={`/forums/${sourceId}/${id}?page=${page + 1}`}>Next 20 →</Link>}</nav>}
      <p className="forums-note">Text-only preview; images, formatting and interactive content remain available on the original community.</p>
    </div>
  </SiteShell>;
}
