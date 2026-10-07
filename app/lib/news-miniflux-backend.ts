import "server-only";

import { articleSummary } from "./news-article-summary";
import { normalizeNewsArticleUrl } from "./news-article-url";
import { originalNewsFeedUrl } from "./news-feed-proxy";
import type { NewsReaderBackend } from "./news-reader-backend";
import type { NewsArticle, NewsCategory, NewsFeed } from "./news-server-types";
import { originalWebSourceUrl } from "./news-web-source-token";

const root = process.env.MINIFLUX_API_URL || "http://127.0.0.1:8083/v1/";

function configuration() {
  const api = new URL(root.endsWith("/") ? root : `${root}/`);
  const token = process.env.MINIFLUX_API_TOKEN;
  if (api.protocol !== "http:" || api.hostname !== "127.0.0.1" || api.pathname !== "/v1/" || !token || token.length < 20) throw new Error("Miniflux API is not configured.");
  return { api, token };
}

async function request(path: string, method = "GET", body?: unknown) {
  const { api, token } = configuration();
  const response = await fetch(new URL(path, api), {
    method, headers: { "X-Auth-Token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Miniflux request failed (${response.status}).`); }
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
}

function numericId(value: string, prefix: "feed" | "category") {
  const match = value.match(new RegExp(`^${prefix}/(\\d{1,10})$`));
  const id = Number(match?.[1]);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Invalid ${prefix} ID.`);
  return id;
}

type MinifluxCategory = { id: number; title: string };
type MinifluxFeed = { id: number; title: string; feed_url: string; category: MinifluxCategory };
type MinifluxEntry = { id: number; title: string; url: string; content: string; published_at: string; feed_id: number; feed: MinifluxFeed };

async function categories(): Promise<NewsCategory[]> {
  const data = await request("categories") as MinifluxCategory[];
  if (!Array.isArray(data)) throw new Error("Invalid Miniflux categories response.");
  return data.filter((item) => item.title !== "Uncategorized").map((item) => ({ id: `category/${item.id}`, name: item.title })).sort((a,b) => a.name.localeCompare(b.name));
}

async function feeds(): Promise<NewsFeed[]> {
  const data = await request("feeds") as MinifluxFeed[];
  if (!Array.isArray(data)) throw new Error("Invalid Miniflux feeds response.");
  return data.map((feed) => ({ id: `feed/${feed.id}`, title: feed.title || `feed/${feed.id}`, category: feed.category?.title || "Uncategorized", url: originalWebSourceUrl(originalNewsFeedUrl(feed.feed_url || "")) }))
    .sort((a,b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

function plainText(html: string) { return html.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,360); }

async function articles(selected: string[], cursor: string | null, allFeeds: NewsFeed[]) {
  const selectedIds = new Set(selected.map((id) => numericId(id,"feed")));
  if (!selectedIds.size) return { articles: [] as NewsArticle[], continuation: null };
  const sourceTitles = new Map(allFeeds.map((feed) => [numericId(feed.id,"feed"), feed.title]));
  const now = new Date(); const tomorrow = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)/1000;
  const cutoff = Math.floor(Date.now()/1000)-5*24*60*60;
  const [cursorDate,cursorId] = cursor ? cursor.split(":").map(Number) : [Infinity,Infinity];
  const chosen: MinifluxEntry[] = [];
  for (let offset=0; chosen.length<51 && offset<5000; offset+=100) {
    const data = await request(`entries?published_after=${cutoff}&published_before=${tomorrow}&order=published_at&direction=desc&limit=100&offset=${offset}`) as { total:number; entries:MinifluxEntry[] };
    if (!Array.isArray(data.entries)) throw new Error("Invalid Miniflux entries response.");
    for (const entry of data.entries) {
      const published = Math.floor(Date.parse(entry.published_at)/1000);
      if (selectedIds.has(entry.feed_id) && (published<cursorDate || (published===cursorDate && entry.id<cursorId))) chosen.push(entry);
      if (chosen.length>=51) break;
    }
    if (offset+data.entries.length>=data.total || !data.entries.length) break;
  }
  const hasMore=chosen.length>50; const page=chosen.slice(0,50);
  const normalized=await Promise.all(page.map(async (entry) => {
    const url=normalizeNewsArticleUrl(entry.url); const published=Math.floor(Date.parse(entry.published_at)/1000);
    return { id:String(entry.id), title:plainText(entry.title||"Untitled"), url, published, summary:await articleSummary(url,plainText(entry.content||"")), source:sourceTitles.get(entry.feed_id)||"Unknown source" };
  }));
  const last=normalized.at(-1); return { articles:normalized, continuation:hasMore&&last?`${last.published}:${last.id}`:null };
}

async function defaultCategoryId() {
  const data=await request("categories") as MinifluxCategory[]; const found=data.find((item)=>item.title==="Uncategorized");
  if (!found) throw new Error("Miniflux default category is unavailable."); return found.id;
}

export const minifluxReaderBackend: NewsReaderBackend = {
  kind:"miniflux", categories, feeds, articles,
  async createCategory(name) { await request("categories","POST",{title:name}); },
  async renameCategory(category,name) { await request(`categories/${numericId(category.id,"category")}`,"PUT",{title:name}); },
  async deleteCategory(category) { await request(`categories/${numericId(category.id,"category")}`,"DELETE"); },
  async subscribe(url,category,title) {
    const categoryId=category?numericId(category.id,"category"):await defaultCategoryId();
    const created=await request("feeds","POST",{feed_url:url,category_id:categoryId}) as {feed_id?:number};
    if (!created?.feed_id) throw new Error("Miniflux did not create the feed.");
    if (title) await request(`feeds/${created.feed_id}`,"PUT",{title});
  },
  async editFeed(feed,title,category) { await request(`feeds/${numericId(feed.id,"feed")}`,"PUT",{...(title?{title}:{}),...(category?{category_id:numericId(category.id,"category")}:{})}); },
  async unsubscribe(feed) { await request(`feeds/${numericId(feed.id,"feed")}`,"DELETE"); },
};
