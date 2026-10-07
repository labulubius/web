import "server-only";

import { execFile } from "node:child_process";
import { articleSummary } from "./news-article-summary";
import { normalizeNewsArticleUrl } from "./news-article-url";
import { originalNewsFeedUrl } from "./news-feed-proxy";
import type { NewsReaderBackend } from "./news-reader-backend";
import type { NewsArticle, NewsCategory, NewsFeed } from "./news-server-types";
import { originalWebSourceUrl } from "./news-web-source-token";

const labelPrefix = "user/-/label/";
const apiRoot = process.env.FRESHRSS_API_URL || "http://127.0.0.1:8080/api/greader.php/";
let login: { token: string; expires: number } | undefined;

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

async function freshGet(path: string, params: Record<string, string> = {}) {
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

async function freshPost(path: string, params: Record<string, string>) {
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

async function freshEditToken(): Promise<string> {
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

async function categories(): Promise<NewsCategory[]> {
  const data = await freshGet("reader/api/0/tag/list") as { tags?: { id?: string; type?: string }[] };
  if (!Array.isArray(data.tags)) throw new Error("Invalid FreshRSS categories response.");
  return data.tags.filter((tag) => tag.type === "folder" && typeof tag.id === "string" && tag.id.startsWith(labelPrefix))
    .map((tag) => ({ id: tag.id!, name: tag.id!.slice(labelPrefix.length) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function feeds(): Promise<NewsFeed[]> {
  const data = await freshGet("reader/api/0/subscription/list") as {
    subscriptions?: { id?: string; title?: string; url?: string; categories?: { label?: string }[] }[];
  };
  if (!Array.isArray(data.subscriptions)) throw new Error("Invalid FreshRSS subscriptions response.");
  return data.subscriptions.filter((feed) => typeof feed.id === "string").map((feed) => ({
    id: feed.id!, title: feed.title || feed.id!, category: feed.categories?.[0]?.label || "Uncategorized",
    url: originalWebSourceUrl(originalNewsFeedUrl(feed.url || "")),
  })).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

function plainText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (value) =>
    ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": String.fromCharCode(34), "&#39;": String.fromCharCode(39) })[value] || value)
    .replace(/\s+/g, " ").trim().slice(0, 360);
}

type DatabaseArticle = { id: string; title: string; url: string; published: number; summary: string; sourceId: number };

function queryFreshDatabase(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("docker", ["exec", "-i", "freshrss-postgres", "sh", "-c",
      "exec psql -X -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -At"],
    { timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(new Error("Article query failed.")) : resolve(stdout));
    child.stdin?.on("error", () => { /* process exit is handled by the callback */ });
    child.stdin?.end(sql + "\n");
  });
}

async function articles(selected: string[], cursor: string | null, allFeeds: NewsFeed[]) {
  const sourceTitles = new Map(allFeeds.flatMap((feed) => {
    const match = feed.id.match(/^feed\/(\d{1,10})$/);
    return match ? [[Number(match[1]), feed.title === feed.id ? "Untitled source" : feed.title] as const] : [];
  }));
  const feedIds = [...new Set(selected.flatMap((id) => {
    const match = id.match(/^feed\/(\d{1,10})$/);
    return match ? [Number(match[1])] : [];
  }))].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 500);
  if (!feedIds.length) return { articles: [] as NewsArticle[], continuation: null as string | null };
  const [cursorDate, cursorId] = cursor ? cursor.split(":") : [];
  const sql = `
SELECT json_build_object(
  'id', e.id::text,
  'title', e.title,
  'url', e.link,
  'published', e.date,
  'sourceId', e.id_feed,
  'summary', left(regexp_replace(regexp_replace(coalesce(e.content, ''), '<[^>]*>', ' ', 'g'), '\\s+', ' ', 'g'), 1000)
)::text
FROM public.freshrss_labulubius_entry e
WHERE e.id_feed IN (${feedIds.join(",")})
  AND e.date > extract(epoch FROM clock_timestamp() - interval '5 days')::bigint
  ${cursor ? `AND (e.date, e.id) < (${cursorDate}, ${cursorId})` : ""}
ORDER BY e.date DESC, e.id DESC
LIMIT 51;`;
  const output = await queryFreshDatabase(sql);
  const rows = output.trim() ? output.trim().split("\n").map((line) => JSON.parse(line) as DatabaseArticle) : [];
  const hasMore = rows.length > 50;
  const page = rows.slice(0, 50);
  const normalized = await Promise.all(page.map(async (item) => {
    const url = normalizeNewsArticleUrl(item.url);
    const summary = await articleSummary(url, plainText(item.summary || ""));
    return {
      id: item.id, title: plainText(item.title || "Untitled"), url,
      published: Number(item.published) || 0, summary, source: sourceTitles.get(Number(item.sourceId)) || "Unknown source",
    };
  }));
  const last = normalized.at(-1);
  return { articles: normalized, continuation: hasMore && last ? `${last.published}:${last.id}` : null };
}

// FreshRSS GReader does not create empty folders. Execute only constant PHP and pass
// the already validated category name over stdin, never through argv or shell interpolation.
function categoryCli(action: "create" | "delete", name: string) {
  const php = `require '/var/www/FreshRSS/cli/_cli.php'; cliInitUser('labulubius'); $name = htmlspecialchars(trim(stream_get_contents(STDIN)), ENT_COMPAT, 'UTF-8'); $dao = FreshRSS_Factory::createCategoryDao(); $cat = $dao->searchByName($name); if ('${action}' === 'create') { if ($cat !== null || !$dao->addCategory(['name' => $name])) exit(1); } else { if ($cat === null || $cat->id() <= 1) exit(1); $feeds = FreshRSS_Factory::createFeedDao()->listFeeds(); foreach ($feeds as $feed) { if ($feed->categoryId() === $cat->id() && !FreshRSS_feed_Controller::deleteFeed($feed->id())) exit(1); } if (!$dao->deleteCategory($cat->id())) exit(1); }`;
  return new Promise<void>((resolve, reject) => {
    const child = execFile("docker", ["exec", "-i", "freshrss", "php", "-r", php], { timeout: 30000, maxBuffer: 1024 },
      (error) => error ? reject(new Error("FreshRSS category update failed.")) : resolve());
    child.stdin?.on("error", () => { /* handled by process exit */ });
    child.stdin?.end(name);
  });
}

export const freshRssReaderBackend: NewsReaderBackend = {
  kind: "freshrss",
  categories,
  feeds,
  articles,
  createCategory: (name) => categoryCli("create", name),
  async renameCategory(category, name) {
    await freshPost("reader/api/0/rename-tag", { T: await freshEditToken(), s: category.id, dest: labelPrefix + name });
  },
  deleteCategory: (category) => categoryCli("delete", category.name),
  async subscribe(url, category, title) {
    await freshPost("reader/api/0/subscription/edit", { s: `feed/${url}`, ac: "subscribe", ...(category ? { a: category.id } : {}), ...(title ? { t: title } : {}) });
  },
  async editFeed(feed, title, category) {
    await freshPost("reader/api/0/subscription/edit", { s: feed.id, ac: "edit", ...(title ? { t: title } : {}), ...(category ? { a: category.id } : {}) });
  },
  async unsubscribe(feed) { await freshPost("reader/api/0/subscription/edit", { s: feed.id, ac: "unsubscribe" }); },
};
