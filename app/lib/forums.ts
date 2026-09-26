import "server-only";

import https from "node:https";
import { publicForumAddress, type ForumSource } from "./forums-directory";
export type { ForumSource } from "./forums-directory";
export type ForumTopic = {
  id: number;
  title: string;
  slug: string;
  reply_count: number;
  posts_count: number;
  created_at: string;
  bumped_at: string;
  closed: boolean;
  visible: boolean;
  pinned: boolean;
};
export type ForumPost = {
  id: number;
  username: string;
  created_at: string;
  cooked: string;
  post_number: number;
};
export type ForumThread = {
  id: number;
  title: string;
  slug: string;
  post_stream: { posts: ForumPost[]; stream: number[] };
};

// Resolve each configured hostname on every request, then pin the verified address
// for the TLS connection. Never follow redirects to an unchecked host.
const responseCache = new Map<string, { expires: number; value: Promise<unknown> }>();

async function discourseJson<T>(url: string): Promise<T> {
  const cached = responseCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value as Promise<T>;
  if (responseCache.size >= 100) responseCache.clear();
  const value = requestDiscourseJson<T>(url);
  responseCache.set(url, { expires: Date.now() + 300_000, value });
  value.catch(() => { if (responseCache.get(url)?.value === value) responseCache.delete(url); });
  return value;
}

async function requestDiscourseJson<T>(url: string): Promise<T> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.port || target.username || target.password) throw new Error("Invalid forum URL.");
  const address = await publicForumAddress(target.hostname);
  return new Promise<T>((resolve, reject) => {
    const request = https.get(target, {
      headers: { Accept: "application/json", "User-Agent": "Labulubius-Forums/1.0" },
      timeout: 10000,
      lookup: (_hostname, options, callback) => {
        const family = address.includes(":") ? 6 : 4;
        if (typeof options !== "number" && options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Forum responded with HTTP ${response.statusCode}.`)); return; }
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (part: string) => {
        text += part;
        if (text.length > 2_000_000) request.destroy(new Error("Forum response too large."));
      });
      response.on("end", () => { try { resolve(JSON.parse(text) as T); } catch { reject(new Error("Invalid forum response.")); } });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Forum timeout.")));
    request.on("error", reject);
  });
}

export async function latestTopics(source: ForumSource): Promise<ForumTopic[]> {
  const result = await discourseJson<{ topic_list?: { topics?: ForumTopic[] } }>(source.origin + source.latest);
  return (result.topic_list?.topics ?? []).filter((topic) => topic.visible && !topic.pinned && Number.isSafeInteger(topic.id));
}

export async function forumThread(source: ForumSource, id: number): Promise<ForumThread> {
  return discourseJson<ForumThread>(`${source.origin}/t/${id}.json`);
}

export async function threadPosts(source: ForumSource, id: number, ids: number[]): Promise<ForumPost[]> {
  const query = new URLSearchParams();
  for (const postId of ids) query.append("post_ids[]", String(postId));
  const result = await discourseJson<{ post_stream?: { posts?: ForumPost[] } }>(`${source.origin}/t/${id}/posts.json?${query}`);
  return result.post_stream?.posts ?? [];
}

// Discourse's cooked HTML is external content; render text, never inject HTML.
export function postText(html: string): string {
  return html.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|blockquote|pre|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp|hellip|mdash|ndash);/gi, (entity, key: string) => {
      if (key.startsWith("#")) {
        const numeric = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return numeric > 0 && numeric <= 0x10ffff && !(numeric >= 0xd800 && numeric <= 0xdfff) ? String.fromCodePoint(numeric) : entity;
      }
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–" } as Record<string, string>)[key.toLowerCase()] ?? entity;
    }).replace(/\n{3,}/g, "\n\n").trim();
}
