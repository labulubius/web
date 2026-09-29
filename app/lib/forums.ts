import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import https from "node:https";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { publicForumAddress, type ForumSource } from "./forums-directory";
export type { ForumSource } from "./forums-directory";

export type ForumTopic = {
  id: string; title: string; url: string; author: string; replyCount: number; createdAt: string; bumpedAt: string;
  score?: number; summary?: string;
};
export type ForumPost = { id: string; username: string; createdAt: string; text: string; number: number; depth?: number; score?: number };
export type ForumThread = { title: string; url: string; posts: ForumPost[]; totalPosts: number; truncated?: boolean };

const responseCache = new Map<string, { expires: number; value: Promise<string> }>();
const ttl = 5 * 60_000;
const runFile = promisify(execFile);

function requestText(url: string): Promise<string> {
  const cached = responseCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (responseCache.size >= 250) responseCache.delete(responseCache.keys().next().value!);
  const value = pinnedText(url);
  responseCache.set(url, { expires: Date.now() + ttl, value });
  value.catch(() => { if (responseCache.get(url)?.value === value) responseCache.delete(url); });
  return value;
}

async function pinnedText(url: string): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.port || target.username || target.password) throw new Error("Invalid community URL.");
  const address = await publicForumAddress(target.hostname);
  return new Promise<string>((resolve, reject) => {
    const request = https.get(target, {
      headers: { Accept: "application/json, application/atom+xml, application/rss+xml, text/xml;q=0.9", "User-Agent": "Labulubius-Communities/1.0 (+https://labulubius.com/forums)" },
      timeout: 12000,
      lookup: (_hostname, options, callback) => {
        const family = address.includes(":") ? 6 : 4;
        if (typeof options !== "number" && options.all) callback(null, [{ address, family }]); else callback(null, address, family);
      },
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Community responded with HTTP ${response.statusCode}.`)); return; }
      let text = ""; response.setEncoding("utf8");
      response.on("data", (part: string) => { text += part; if (text.length > 2_000_000) request.destroy(new Error("Community response too large.")); });
      response.on("end", () => resolve(text)); response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Community timeout."))); request.on("error", reject);
  });
}

async function curlText(url: string): Promise<string> {
  const key = `curl:${url}`; const cached = responseCache.get(key); if (cached && cached.expires > Date.now()) return cached.value;
  const target = new URL(url); if (target.protocol !== "https:" || target.port || target.username || target.password) throw new Error("Invalid community URL.");
  const address = await publicForumAddress(target.hostname);
  const pinned = address.includes(":") ? `[${address}]` : address;
  const value = runFile("curl", ["--disable", "--silent", "--show-error", "--fail", "--max-time", "12", "--max-filesize", "2000000", "--noproxy", "*", "--resolve", `${target.hostname}:443:${pinned}`, "--user-agent", "Labulubius-Communities/1.0 (+https://labulubius.com/forums)", target.href], { maxBuffer: 2_000_000 }).then(({ stdout }) => stdout);
  responseCache.set(key, { expires: Date.now() + ttl, value }); value.catch(() => { if (responseCache.get(key)?.value === value) responseCache.delete(key); }); return value;
}

async function json<T>(url: string): Promise<T> { return JSON.parse(await requestText(url)) as T; }
function safeDate(value: unknown, unix = false): string {
  const date = unix && typeof value === "number" ? new Date(value * 1000) : new Date(typeof value === "string" || typeof value === "number" ? value : 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}
function safeUrl(value: unknown, fallback: string): string {
  try { const url = new URL(typeof value === "string" ? value : fallback, fallback); return ["http:", "https:"].includes(url.protocol) ? url.href : fallback; } catch { return fallback; }
}
export function postText(html: string): string {
  return html.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "").replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|blockquote|pre|h[1-6])\s*>/gi, "\n\n").replace(/<[^>]*>/g, "")
    .replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp|hellip|mdash|ndash);/gi, (entity, key: string) => {
      if (key.startsWith("#")) { const numeric = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10); return numeric > 0 && numeric <= 0x10ffff && !(numeric >= 0xd800 && numeric <= 0xdfff) ? String.fromCodePoint(numeric) : entity; }
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–" } as Record<string, string>)[key.toLowerCase()] ?? entity;
    }).replace(/\n{3,}/g, "\n\n").replace(/[^\S\n]+/g, " ").trim();
}
function excerpt(value: unknown): string { return postText(typeof value === "string" ? value : "").slice(0, 320); }
async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const index = next++; result[index] = await mapper(items[index], index); } }));
  return result;
}

async function discourseTopics(source: ForumSource): Promise<ForumTopic[]> {
  try {
    const result = await json<{ topic_list?: { topics?: Array<Record<string, unknown>> } }>(`${source.origin}${source.latest || "/latest.json"}`);
    return (result.topic_list?.topics || []).filter((topic) => topic.visible !== false && !topic.pinned && Number.isSafeInteger(topic.id)).slice(0, 30).map((topic) => {
      const id = String(topic.id); const slug = typeof topic.slug === "string" ? topic.slug : "topic"; const url = `${source.origin}/t/${encodeURIComponent(slug)}/${id}`;
      return { id, title: postText(String(topic.title || "Untitled")), url, author: "", replyCount: Number(topic.reply_count) || 0, createdAt: safeDate(topic.created_at), bumpedAt: safeDate(topic.bumped_at || topic.last_posted_at || topic.created_at), summary: excerpt(topic.excerpt) };
    });
  } catch {
    // Cloudflare-protected Discourse installations often leave their RSS feeds public.
    const parsed = xml.parse(await curlText(`${source.origin}/latest.rss`)) as { rss?: { channel?: Record<string, unknown> } };
    const items = list(parsed.rss?.channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
    return items.slice(0, 30).flatMap((item) => {
      const url = safeUrl(xmlText(item.link), source.origin!); const id = url.match(/\/t\/[^/]+\/(\d+)/)?.[1]; if (!id) return [];
      const date = safeDate(xmlText(item.pubDate));
      return [{ id, title: postText(xmlText(item.title) || "Untitled"), url, author: postText(xmlText(item["dc:creator"] || item.author)), replyCount: 0, createdAt: date, bumpedAt: date, summary: excerpt(xmlText(item.description)) }];
    });
  }
}

async function v2exTopics(): Promise<ForumTopic[]> {
  const topics = await json<Array<Record<string, unknown>>>("https://www.v2ex.com/api/topics/latest.json");
  return topics.slice(0, 30).map((topic) => {
    const id = String(topic.id); const member = topic.member as Record<string, unknown> | undefined;
    return { id, title: postText(String(topic.title || "Untitled")), url: safeUrl(topic.url, `https://www.v2ex.com/t/${id}`), author: String(member?.username || ""), replyCount: Number(topic.replies) || 0, createdAt: safeDate(topic.created, true), bumpedAt: safeDate(topic.last_touched || topic.last_modified || topic.created, true), summary: excerpt(topic.content_rendered || topic.content) };
  });
}

const hnViews = { top: "topstories", new: "newstories", best: "beststories", ask: "askstories", show: "showstories" } as const;
async function hackerNewsTopics(source: ForumSource): Promise<ForumTopic[]> {
  const ids = await json<number[]>(`https://hacker-news.firebaseio.com/v0/${hnViews[source.view || "top"]}.json`);
  const items = await mapLimit(ids.slice(0, 30), 8, (id) => json<Record<string, unknown> | null>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
  return items.filter((item): item is Record<string, unknown> => !!item && item.dead !== true && item.deleted !== true && typeof item.id === "number").map((item) => {
    const id = String(item.id); const comments = `https://news.ycombinator.com/item?id=${id}`;
    return { id, title: postText(String(item.title || "Untitled")), url: comments, author: String(item.by || ""), replyCount: Number(item.descendants) || 0, score: Number(item.score) || 0, createdAt: safeDate(item.time, true), bumpedAt: safeDate(item.time, true), summary: excerpt(item.text) };
  });
}

async function stackTopics(source: ForumSource): Promise<ForumTopic[]> {
  const query = new URLSearchParams({ site: source.site || "stackoverflow", sort: "activity", order: "desc", pagesize: "30" });
  if (source.tags) query.set("tagged", source.tags);
  const result = await json<{ items?: Array<Record<string, unknown>> }>(`https://api.stackexchange.com/2.3/questions?${query}`);
  return (result.items || []).map((item) => {
    const id = String(item.question_id); const owner = item.owner as Record<string, unknown> | undefined; const url = safeUrl(item.link, `https://${source.site}.com/questions/${id}`);
    return { id, title: postText(String(item.title || "Untitled")), url, author: postText(String(owner?.display_name || "")), replyCount: Number(item.answer_count) || 0, score: Number(item.score) || 0, createdAt: safeDate(item.creation_date, true), bumpedAt: safeDate(item.last_activity_date || item.creation_date, true) };
  });
}

async function redditTopics(source: ForumSource): Promise<ForumTopic[]> {
  const subreddit = source.subreddit || "programming"; const sort = source.sort || "hot";
  const result = await json<{ data?: { children?: Array<{ data?: Record<string, unknown> }> } }>(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?raw_json=1&limit=30`);
  return (result.data?.children || []).flatMap(({ data }) => {
    if (!data || data.stickied || data.over_18 || typeof data.id !== "string") return [];
    const url = `https://www.reddit.com${String(data.permalink || `/r/${subreddit}/comments/${data.id}`)}`;
    return [{ id: data.id, title: postText(String(data.title || "Untitled")), url, author: String(data.author || ""), replyCount: Number(data.num_comments) || 0, score: Number(data.score) || 0, createdAt: safeDate(data.created_utc, true), bumpedAt: safeDate(data.created_utc, true), summary: excerpt(data.selftext) }];
  });
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false, trimValues: true });
function list<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function xmlText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") { const record = value as Record<string, unknown>; return String(record["#text"] || record["__cdata"] || record["@_href"] || ""); }
  return "";
}
function rssId(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 24); }
async function rssTopics(source: ForumSource): Promise<ForumTopic[]> {
  const parsed = xml.parse(await requestText(source.feedUrl!)) as Record<string, unknown>;
  const channel = (parsed.rss as { channel?: Record<string, unknown> } | undefined)?.channel;
  const rssItems = list(channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const feed = parsed.feed as Record<string, unknown> | undefined;
  const atomItems = list(feed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return [...rssItems, ...atomItems].slice(0, 30).flatMap((item) => {
    const links = list(item.link as unknown); const rawLink = links.map(xmlText).find(Boolean) || ""; const url = safeUrl(rawLink, source.feedUrl!);
    const key = xmlText(item.guid || item.id) || url; if (!key) return [];
    const date = xmlText(item.pubDate || item.updated || item.published); const author = xmlText(item.author || item.creator || item["dc:creator"]);
    return [{ id: rssId(key), title: postText(xmlText(item.title) || "Untitled"), url, author: postText(author), replyCount: 0, createdAt: safeDate(date), bumpedAt: safeDate(date), summary: excerpt(xmlText(item.description || item.summary || item.content)) }];
  });
}

export async function latestTopics(source: ForumSource): Promise<ForumTopic[]> {
  if (process.env.VERCEL) {
    const response = await fetch(`https://drive.labulubius.com/api/forums?view=topics&source=${encodeURIComponent(source.id)}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Community source unavailable.");
    return response.json() as Promise<ForumTopic[]>;
  }
  if (source.kind === "discourse") return discourseTopics(source);
  if (source.kind === "v2ex") return v2exTopics();
  if (source.kind === "hackernews") return hackerNewsTopics(source);
  if (source.kind === "stackexchange") return stackTopics(source);
  if (source.kind === "reddit") return redditTopics(source);
  return rssTopics(source);
}

async function discourseThread(source: ForumSource, id: string, page: number): Promise<ForumThread> {
  if (!/^\d{1,16}$/.test(id)) throw new Error("Invalid topic.");
  try {
    const thread = await json<Record<string, unknown>>(`${source.origin}/t/${id}.json`); const stream = thread.post_stream as { posts?: Array<Record<string, unknown>>; stream?: number[] } | undefined;
    const ids = Array.isArray(stream?.stream) ? stream.stream : []; const wanted = ids.slice((page - 1) * 20, page * 20);
    let posts = (stream?.posts || []).filter((post) => wanted.includes(Number(post.id)));
    if (posts.length < wanted.length && wanted.length) { const query = new URLSearchParams(); wanted.forEach((postId) => query.append("post_ids[]", String(postId))); posts = (await json<{ post_stream?: { posts?: Array<Record<string, unknown>> } }>(`${source.origin}/t/${id}/posts.json?${query}`)).post_stream?.posts || []; }
    posts.sort((a, b) => Number(a.post_number) - Number(b.post_number));
    return { title: postText(String(thread.title || "Discussion")), url: `${source.origin}/t/${id}`, totalPosts: ids.length, posts: posts.map((post) => ({ id: String(post.id), username: String(post.username || ""), createdAt: safeDate(post.created_at), text: postText(String(post.cooked || "")), number: Number(post.post_number) || 1 })) };
  } catch {
    const parsed = xml.parse(await curlText(`${source.origin}/t/topic/${id}.rss`)) as { rss?: { channel?: Record<string, unknown> } };
    const channel = parsed.rss?.channel; const items = list(channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined).reverse();
    const posts = items.map((item, index) => ({ id: `${id}-${index + 1}`, username: postText(xmlText(item["dc:creator"] || item.author)), createdAt: safeDate(xmlText(item.pubDate)), text: postText(xmlText(item.description || item["content:encoded"])), number: index + 1 }));
    return { title: postText(xmlText(channel?.title) || "Discussion"), url: `${source.origin}/t/topic/${id}`, totalPosts: posts.length, posts };
  }
}

async function v2exThread(id: string): Promise<ForumThread> {
  if (!/^\d{1,16}$/.test(id)) throw new Error("Invalid topic.");
  const [topics, replies] = await Promise.all([json<Array<Record<string, unknown>>>(`https://www.v2ex.com/api/topics/show.json?id=${id}`), json<Array<Record<string, unknown>>>(`https://www.v2ex.com/api/replies/show.json?topic_id=${id}`)]); const topic = topics[0]; if (!topic) throw new Error("Topic not found.");
  const member = topic.member as Record<string, unknown> | undefined; const original: ForumPost = { id: `topic-${id}`, username: String(member?.username || ""), createdAt: safeDate(topic.created, true), text: postText(String(topic.content_rendered || topic.content || "")), number: 1 };
  return { title: postText(String(topic.title || "Discussion")), url: safeUrl(topic.url, `https://www.v2ex.com/t/${id}`), totalPosts: replies.length + 1, posts: [original, ...replies.map((reply, index) => { const author = reply.member as Record<string, unknown> | undefined; return { id: String(reply.id), username: String(author?.username || ""), createdAt: safeDate(reply.created, true), text: postText(String(reply.content_rendered || reply.content || "")), number: index + 2 }; })] };
}

async function hnThread(id: string): Promise<ForumThread> {
  if (!/^\d{1,16}$/.test(id)) throw new Error("Invalid item."); const root = await json<Record<string, unknown> | null>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`); if (!root) throw new Error("Item not found.");
  const kidIds = Array.isArray(root.kids) ? (root.kids as number[]).slice(0, 40) : []; const comments = await mapLimit(kidIds, 8, (kid) => json<Record<string, unknown> | null>(`https://hacker-news.firebaseio.com/v0/item/${kid}.json`));
  const posts: ForumPost[] = [{ id, username: String(root.by || ""), createdAt: safeDate(root.time, true), text: postText(String(root.text || "Open the linked article to read the full story.")), number: 1, score: Number(root.score) || 0 }];
  comments.filter((item): item is Record<string, unknown> => !!item && item.deleted !== true && item.dead !== true).forEach((item, index) => posts.push({ id: String(item.id), username: String(item.by || ""), createdAt: safeDate(item.time, true), text: postText(String(item.text || "")), number: index + 2 }));
  return { title: postText(String(root.title || "Hacker News discussion")), url: `https://news.ycombinator.com/item?id=${id}`, posts, totalPosts: (Number(root.descendants) || kidIds.length) + 1, truncated: kidIds.length < (Number(root.descendants) || 0) };
}

async function stackThread(source: ForumSource, id: string): Promise<ForumThread> {
  if (!/^\d{1,16}$/.test(id)) throw new Error("Invalid question."); const common = `site=${encodeURIComponent(source.site || "stackoverflow")}&filter=withbody`;
  const [questions, answers] = await Promise.all([json<{ items?: Array<Record<string, unknown>> }>(`https://api.stackexchange.com/2.3/questions/${id}?${common}`), json<{ items?: Array<Record<string, unknown>> }>(`https://api.stackexchange.com/2.3/questions/${id}/answers?${common}&sort=creation&order=asc&pagesize=30`)]); const question = questions.items?.[0]; if (!question) throw new Error("Question not found.");
  const all = [question, ...(answers.items || [])]; return { title: postText(String(question.title || "Question")), url: safeUrl(question.link, `https://${source.site}.com/questions/${id}`), totalPosts: 1 + Number(question.answer_count || 0), posts: all.map((item, index) => { const owner = item.owner as Record<string, unknown> | undefined; return { id: String(item.answer_id || item.question_id), username: postText(String(owner?.display_name || "")), createdAt: safeDate(item.creation_date, true), text: postText(String(item.body || "")), number: index + 1, score: Number(item.score) || 0 }; }), truncated: Number(question.answer_count || 0) > (answers.items?.length || 0) };
}

async function redditThread(source: ForumSource, id: string): Promise<ForumThread> {
  if (!/^[a-z0-9]{3,12}$/i.test(id)) throw new Error("Invalid post."); const result = await json<Array<{ data?: { children?: Array<{ kind?: string; data?: Record<string, unknown> }> } }>>(`https://www.reddit.com/r/${encodeURIComponent(source.subreddit || "programming")}/comments/${id}.json?raw_json=1&limit=40`); const root = result[0]?.data?.children?.[0]?.data; if (!root || root.over_18) throw new Error("Post not found."); const replies = result[1]?.data?.children || [];
  const posts: ForumPost[] = [{ id, username: String(root.author || ""), createdAt: safeDate(root.created_utc, true), text: postText(String(root.selftext || "Open the original post to view its content.")), number: 1, score: Number(root.score) || 0 }];
  replies.forEach((reply, index) => { const item = reply.data; if (reply.kind === "t1" && item && typeof item.id === "string") posts.push({ id: item.id, username: String(item.author || ""), createdAt: safeDate(item.created_utc, true), text: postText(String(item.body || "")), number: index + 2, score: Number(item.score) || 0 }); });
  return { title: postText(String(root.title || "Reddit discussion")), url: `https://www.reddit.com${String(root.permalink || `/comments/${id}`)}`, posts, totalPosts: 1 + Number(root.num_comments || 0), truncated: replies.length < Number(root.num_comments || 0) };
}

async function rssThread(source: ForumSource, id: string): Promise<ForumThread> {
  const topic = (await rssTopics(source)).find((item) => item.id === id); if (!topic) throw new Error("Feed item not found.");
  return { title: topic.title, url: topic.url, totalPosts: 1, posts: [{ id, username: topic.author, createdAt: topic.createdAt, text: topic.summary || "Open the original item to continue reading.", number: 1 }] };
}

export async function forumThread(source: ForumSource, id: string, page = 1): Promise<ForumThread> {
  if (process.env.VERCEL) {
    const query = new URLSearchParams({ view: "thread", source: source.id, id, page: String(page) });
    const response = await fetch(`https://drive.labulubius.com/api/forums?${query}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Discussion unavailable.");
    return response.json() as Promise<ForumThread>;
  }
  if (source.kind === "discourse") return discourseThread(source, id, page);
  if (source.kind === "v2ex") return v2exThread(id);
  if (source.kind === "hackernews") return hnThread(id);
  if (source.kind === "stackexchange") return stackThread(source, id);
  if (source.kind === "reddit") return redditThread(source, id);
  return rssThread(source, id);
}
