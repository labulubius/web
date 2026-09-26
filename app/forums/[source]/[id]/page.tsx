import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "../../../site-shell";
import { ForumsInteraction } from "../../forums-interaction";
import { forumThread, postText, threadPosts } from "../../../lib/forums";
import { loadForumDirectory } from "../../../lib/forums-directory";
import "../../forums.css";

export const metadata: Metadata = { title: "Discussion · Forums" };
const pageSize = 20;

export default async function DiscussionPage({ params, searchParams }: PageProps<"/forums/[source]/[id]">) {
  const { source: sourceId, id: rawId } = await params;
  const source = (await loadForumDirectory()).sources.find((item) => item.id === sourceId && item.selected);
  if (!source || !/^[1-9]\d{0,11}$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) notFound();
  const id = Number(rawId);
  const { page: rawPage } = await searchParams;
  const page = typeof rawPage === "string" && /^[1-9]\d{0,3}$/.test(rawPage) ? Number(rawPage) : 1;
  let thread;
  try { thread = await forumThread(source, id); }
  catch { return <SiteShell active="/forums" title="Forums"><ForumsInteraction as="div" className="forums-detail"><Link href="/forums">← Forums</Link><p className="forums-warning">This discussion could not be loaded right now. <a href={`${source.origin}/t/${id}`}>Open the original ↗</a></p></ForumsInteraction></SiteShell>; }
  const ids = thread.post_stream.stream;
  const pages = Math.ceil(ids.length / pageSize);
  if (page > pages || pages === 0) notFound();
  let posts = page === 1 ? thread.post_stream.posts.filter((post) => ids.slice(0, pageSize).includes(post.id)) : [];
  if (page !== 1 || posts.length < Math.min(pageSize, ids.length)) {
    try { posts = await threadPosts(source, id, ids.slice((page - 1) * pageSize, page * pageSize)); }
    catch { posts = []; }
  }
  posts.sort((a, b) => a.post_number - b.post_number);
  const original = `${source.origin}/t/${id}`;
  return <SiteShell active="/forums" title="Forums">
    <ForumsInteraction as="div" className="forums-detail">
      <Link className="forums-back" href="/forums">← All forums</Link>
      <p className="section-label">{source.name.toUpperCase()}</p>
      <h1>{thread.title}</h1>
      <p className="forums-detail-meta">{ids.length} posts · page {page} of {pages} · <a href={original} target="_blank" rel="noopener noreferrer">Read on {source.name} ↗</a></p>
      {posts.length === 0 && <p className="forums-warning">Replies are temporarily unavailable. Please read the original discussion.</p>}
      {posts.map((post) => <article className="forums-post" key={post.id}>
        <div className="forums-post-meta"><strong>{post.username}</strong><time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time><a href={`${original}/${post.post_number}`} target="_blank" rel="noopener noreferrer">#{post.post_number} ↗</a></div>
        <p>{postText(post.cooked)}</p>
      </article>)}
      <nav className="forums-pagination" aria-label="Discussion pages">
        {page > 1 && <Link href={`/forums/${sourceId}/${id}?page=${page - 1}`}>← Previous 20</Link>}
        {page < pages && <Link href={`/forums/${sourceId}/${id}?page=${page + 1}`}>Next 20 →</Link>}
      </nav>
      <p className="forums-note">Text-only preview; images, formatting and interactive content are available on the original forum. Replies and edits may appear after the next refresh.</p>
    </ForumsInteraction>
  </SiteShell>;
}
