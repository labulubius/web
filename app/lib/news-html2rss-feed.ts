import type { ParsedWebSource, WebSourceItem } from "./news-web-source-feed";

const MAX_ITEMS = 100;

type JsonFeedItem = {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  summary?: unknown;
  content_text?: unknown;
  date_published?: unknown;
  date_modified?: unknown;
};

type JsonFeed = {
  title?: unknown;
  description?: unknown;
  items?: unknown;
};

export class InvalidHtml2RssFeed extends Error {}

function plainText(value: unknown, limit: number) {
  if (typeof value !== "string") return "";
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, String.fromCharCode(34)).replace(/&#0*39;|&apos;/gi, String.fromCharCode(39))
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

export function canonicalHtml2rssSourceUrl(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || value.length > 2048) return null;
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname || "/";
  return url.href;
}

function articleUrl(value: unknown, sourceUrl: string) {
  if (typeof value !== "string") return null;
  let url: URL;
  try { url = new URL(value, sourceUrl); }
  catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  url.hash = "";
  return url.href;
}

function publishedAt(item: JsonFeedItem, previous: Map<string, WebSourceItem>, id: string, now: number) {
  for (const value of [item.date_published, item.date_modified]) {
    if (typeof value !== "string") continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return { published: timestamp, publishedReliable: true };
  }
  const old = previous.get(id);
  return old ? { published: old.published, publishedReliable: old.publishedReliable !== false } : { published: now, publishedReliable: false };
}

export function normalizeHtml2rssFeed(value: unknown, sourceUrl: string, now = Date.now(), previous?: ParsedWebSource): ParsedWebSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidHtml2RssFeed("html2rss returned an invalid feed.");
  const feed = value as JsonFeed;
  if (!Array.isArray(feed.items)) throw new InvalidHtml2RssFeed("html2rss returned an invalid feed.");
  const prior = new Map((previous?.items || []).map((item) => [item.id, item]));
  const items = new Map<string, WebSourceItem>();
  for (const candidate of feed.items.slice(0, MAX_ITEMS)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as JsonFeedItem;
    const url = articleUrl(item.url, sourceUrl);
    const title = plainText(item.title, 300);
    if (!url || !title) continue;
    const id = url;
    const timing = publishedAt(item, prior, id, now);
    items.set(id, {
      id,
      title,
      url,
      ...timing,
      summary: plainText(item.summary || item.content_text, 1_000),
    });
  }
  if (!items.size) throw new InvalidHtml2RssFeed("html2rss found no usable article entries.");
  return {
    title: plainText(feed.title, 200) || new URL(sourceUrl).hostname,
    description: plainText(feed.description, 500),
    items: [...items.values()],
  };
}
