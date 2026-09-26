// Only configured public Discourse hosts are fetched. Never accept a URL from a request.
export const forumSources = [
  { id: "openai", name: "OpenAI Community", origin: "https://community.openai.com", latest: "/latest.json?status=open" },
  { id: "python", name: "Python Discussions", origin: "https://discuss.python.org", latest: "/latest.json" },
  { id: "discourse", name: "Discourse Meta", origin: "https://meta.discourse.org", latest: "/latest.json" },
] as const;

export type ForumSource = (typeof forumSources)[number];
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

export function forumSource(id: string) {
  return forumSources.find((source) => source.id === id);
}

async function discourseJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Forum responded with HTTP ${response.status}`);
  return response.json() as Promise<T>;
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
