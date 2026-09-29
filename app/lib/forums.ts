import "server-only";

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import https from "node:https";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { loadForumDirectory, publicForumAddress, type ForumKind, type ForumSource } from "./forums-directory";
export type { ForumSource } from "./forums-directory";

export type ForumTopic = {
  id: string; title: string; url: string; author: string; replyCount: number; createdAt: string; bumpedAt: string;
  score?: number; summary?: string;
};
export type ForumListedTopic = { topic: ForumTopic; source: { id: string; name: string; kind: ForumKind } };
export type ForumTopicPage = { topics: ForumListedTopic[]; failed: string[]; continuation: string | null };

type ForumSnapshot = { key: string; expires: number; value: Promise<{ topics: ForumListedTopic[]; failed: string[] }> };
const responseCache = new Map<string, { expires: number; value: Promise<string> }>();
const aggregateCache = new Map<string, { expires: number; snapshot: string; value: Promise<{ topics: ForumListedTopic[]; failed: string[] }> }>();
const snapshotCache = new Map<string, ForumSnapshot>();
const ttl = 5 * 60_000;
const forumPageSize = 50;
const runFile = promisify(execFile);

function cacheText(key: string, value: Promise<string>) {
  if (responseCache.size >= 250) responseCache.delete(responseCache.keys().next().value!);
  responseCache.set(key, { expires: Date.now() + ttl, value });
  value.catch(() => { if (responseCache.get(key)?.value === value) responseCache.delete(key); });
  return value;
}
function requestText(url: string): Promise<string> {
  const cached = responseCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  return cacheText(url, pinnedText(url));
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
  return cacheText(key, value);
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

export function invalidateForumCaches() {
  responseCache.clear();
  aggregateCache.clear();
  snapshotCache.clear();
}

async function aggregateTopics(sourceId: string | null, categoryId: string | null, requestedSnapshot: string | null) {
  const directory = await loadForumDirectory();
  const sources = directory.sources.filter((source) => sourceId ? source.id === sourceId : source.selected && (!categoryId || source.categoryId === categoryId));
  const cacheKey = JSON.stringify({ sourceId, categoryId, sources });
  const oldSnapshot = requestedSnapshot ? snapshotCache.get(requestedSnapshot) : null;
  if (oldSnapshot && oldSnapshot.key === cacheKey && oldSnapshot.expires > Date.now()) return { snapshot: requestedSnapshot!, value: oldSnapshot.value };
  if (requestedSnapshot) throw new Error("Discussion page expired. Refresh to continue.");
  const cached = aggregateCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return { snapshot: cached.snapshot, value: cached.value };
  const value = (async () => {
    const results = new Array<PromiseSettledResult<{ source: ForumSource; topics: ForumTopic[] }>>(sources.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(5, sources.length) }, async () => {
      while (next < sources.length) {
        const index = next++;
        try { results[index] = { status: "fulfilled", value: { source: sources[index], topics: await latestTopics(sources[index]) } }; }
        catch (reason) { results[index] = { status: "rejected", reason }; }
      }
    }));
    const topics = results.flatMap((result) => result.status === "fulfilled" ? result.value.topics.map((topic) => ({ topic, source: { id: result.value.source.id, name: result.value.source.name, kind: result.value.source.kind } })) : []);
    topics.sort((a, b) => Date.parse(b.topic.createdAt) - Date.parse(a.topic.createdAt) || `${a.source.id}:${a.topic.id}`.localeCompare(`${b.source.id}:${b.topic.id}`));
    return { topics, failed: results.flatMap((result, index) => result.status === "rejected" ? [sources[index].name] : []) };
  })();
  const snapshot = randomUUID();
  aggregateCache.set(cacheKey, { expires: Date.now() + ttl, snapshot, value });
  snapshotCache.set(snapshot, { key: cacheKey, expires: Date.now() + 30 * 60_000, value });
  while (snapshotCache.size > 100) snapshotCache.delete(snapshotCache.keys().next().value!);
  value.catch(() => {
    if (aggregateCache.get(cacheKey)?.value === value) aggregateCache.delete(cacheKey);
    if (snapshotCache.get(snapshot)?.value === value) snapshotCache.delete(snapshot);
  });
  return { snapshot, value };
}

export async function forumTopicPage(sourceId: string | null, categoryId: string | null, cursor: string | null = null): Promise<ForumTopicPage> {
  if (process.env.VERCEL) {
    const query = new URLSearchParams({ view: "aggregate" });
    if (cursor) query.set("cursor", cursor);
    if (sourceId) query.set("source", sourceId);
    if (categoryId) query.set("category", categoryId);
    const response = await fetch(`https://drive.labulubius.com/api/forums?${query}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Communities unavailable.");
    return response.json() as Promise<ForumTopicPage>;
  }
  const match = cursor?.match(/^([0-9a-f-]{36})\.(\d{1,6})$/) ?? null;
  const offset = match ? Number(match[2]) : 0;
  const result = await aggregateTopics(sourceId, categoryId, match?.[1] ?? null);
  const aggregate = await result.value;
  const end = Math.min(aggregate.topics.length, offset + forumPageSize);
  return { topics: aggregate.topics.slice(offset, end), failed: aggregate.failed, continuation: end < aggregate.topics.length ? `${result.snapshot}.${end}` : null };
}
