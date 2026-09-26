import "server-only";

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import type { NewsArticle, NewsFeed } from "./news-server-types";

export const privateNewsHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function newsAdmin(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return null;
  const role = await client.rpc("site_is_admin");
  return !role.error && role.data === true ? { client, user } : null;
}

let login: { token: string; expires: number } | undefined;
// The News API runs on the web server, next to the FreshRSS Docker port.
const apiRoot = process.env.FRESHRSS_API_URL || "http://127.0.0.1:8080/api/greader.php/";

async function freshToken() {
  if (login && login.expires > Date.now()) return login.token;
  const user = process.env.FRESHRSS_API_USER;
  const password = process.env.FRESHRSS_API_PASSWORD;
  if (!user || !password) throw new Error("FreshRSS API credentials are not configured.");
  const response = await fetch(`${apiRoot}accounts/ClientLogin`, {
    method: "POST", body: new URLSearchParams({ Email: user, Passwd: password }),
    cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("FreshRSS API login failed.");
  const text = await response.text();
  const token = text.match(/^Auth=(.+)$/m)?.[1]?.trim();
  if (!token) throw new Error("FreshRSS did not provide an API token.");
  login = { token, expires: Date.now() + 10 * 60 * 1000 };
  return token;
}

export async function freshGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, apiRoot);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("output", "json");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await freshToken();
    const response = await fetch(url, { headers: { Authorization: `GoogleLogin auth=${token}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (response.status === 401 && attempt === 0) { login = undefined; continue; }
    if (!response.ok) throw new Error(`FreshRSS request failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  }
  throw new Error("FreshRSS authentication failed.");
}

export async function freshPost(path: string, params: Record<string, string>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await freshToken();
    const response = await fetch(new URL(path, apiRoot), {
      method: "POST", headers: { Authorization: `GoogleLogin auth=${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 && attempt === 0) { login = undefined; continue; }
    if (!response.ok || (await response.text()).trim() !== "OK") throw new Error(`FreshRSS update failed (${response.status}).`);
    return;
  }
  throw new Error("FreshRSS authentication failed.");
}

export async function freshEditToken(): Promise<string> {
  // This endpoint returns plain text, unlike the JSON tag/list endpoint.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await freshToken();
    const response = await fetch(new URL("reader/api/0/token", apiRoot), {
      headers: { Authorization: `GoogleLogin auth=${token}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 && attempt === 0) { login = undefined; continue; }
    if (!response.ok) throw new Error("FreshRSS edit token request failed.");
    const editToken = (await response.text()).trim();
    if (!editToken || editToken.length > 512) throw new Error("Invalid FreshRSS edit token.");
    return editToken;
  }
  throw new Error("FreshRSS authentication failed.");
}

export async function newsCategories(): Promise<{ id: string; name: string }[]> {
  const data = await freshGet("reader/api/0/tag/list") as { tags?: { id?: string; type?: string }[] };
  if (!Array.isArray(data.tags)) throw new Error("Invalid FreshRSS categories response.");
  return data.tags.filter((tag) => tag.type === "folder" && typeof tag.id === "string" && tag.id.startsWith("user/-/label/"))
    .map((tag) => ({ id: tag.id!, name: tag.id!.slice("user/-/label/".length) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function newsFeeds(): Promise<NewsFeed[]> {
  const data = await freshGet("reader/api/0/subscription/list") as {
    subscriptions?: { id?: string; title?: string; categories?: { label?: string }[] }[];
  };
  if (!Array.isArray(data.subscriptions)) throw new Error("Invalid FreshRSS subscriptions response.");
  return data.subscriptions.filter((feed) => typeof feed.id === "string").map((feed) => ({
    id: feed.id!, title: feed.title || feed.id!, category: feed.categories?.[0]?.label || "Uncategorized",
  })).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

function plainText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (value) =>
    ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[value] || value)
    .replace(/\s+/g, " ").trim().slice(0, 360);
}

function unexpiredIds(items: { id?: string }[]): Promise<Set<string>> {
  const ids = items.flatMap((item) => {
    const hex = item.id?.match(/\/item\/([0-9a-f]{1,16})$/i)?.[1];
    return hex ? [BigInt(`0x${hex}`).toString()] : [];
  });
  if (!ids.length) return Promise.resolve(new Set());
  // FreshRSS is local to the web server. Query only numeric GReader IDs; fail closed
  // if the retention database cannot be checked rather than exposing expired data.
  return new Promise((resolve, reject) => {
    const sql = `SELECT entry_id FROM public.news_entry_receipt WHERE received_at > NOW() - INTERVAL '5 days' AND entry_id IN (${ids.join(",")});`;
    execFile("docker", ["exec", "freshrss-postgres", "sh", "-c", `psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c '${sql}'`],
      { timeout: 8000, maxBuffer: 65536 }, (error, stdout) => error ? reject(new Error("Article expiration check failed.")) : resolve(new Set(stdout.trim().split("\n"))));
  });
}

export async function newsArticles(selected: string[], cursor: string | null) {
  if (!selected.length) return { articles: [] as NewsArticle[], continuation: null as string | null };
  // Filter on the server: never trust the browser to provide a private feed URL or a cached selection.
  const allowed = new Set(selected);
  const data = await freshGet("reader/api/0/stream/contents/reading-list", { n: "100", ...(cursor ? { c: cursor } : {}) }) as {
    items?: { id?: string; title?: string; origin?: { streamId?: string; title?: string }; published?: number;
      canonical?: { href?: string }[]; alternate?: { href?: string }[]; summary?: { content?: string }; content?: { content?: string } }[];
    continuation?: string;
  };
  if (!Array.isArray(data.items)) throw new Error("Invalid FreshRSS articles response.");
  const current = await unexpiredIds(data.items);
  const articles = data.items.filter((item) => item.origin?.streamId && allowed.has(item.origin.streamId) &&
    current.has(BigInt(`0x${item.id?.match(/\/item\/([0-9a-f]{1,16})$/i)?.[1] || "0"}`).toString())).map((item) => {
    const href = item.canonical?.[0]?.href || item.alternate?.[0]?.href || "";
    let url = "";
    try { if (["http:", "https:"].includes(new URL(href).protocol)) url = href; } catch { /* no unsafe links */ }
    return {
      id: item.id || href, feedId: item.origin?.streamId || "", title: plainText(item.title || "Untitled"), url,
      source: item.origin?.title || "Unknown source", published: Number(item.published) || 0,
      summary: plainText(item.summary?.content || item.content?.content || ""),
    };
  });
  return { articles, continuation: data.continuation && /^\d{1,24}$/.test(data.continuation) ? data.continuation : null };
}
