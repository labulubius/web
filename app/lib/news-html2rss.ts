import "server-only";

import { readLimitedNewsResource } from "./news-feed-proxy";
import { InvalidHtml2RssFeed, normalizeHtml2rssFeed } from "./news-html2rss-feed";
import type { ParsedWebSource } from "./news-web-source-feed";

// Browser wall 30s < gem 35s < web 40s < this client 43s.
const HTML2RSS_REQUEST_TIMEOUT_MS = 43_000;
const feedPathPattern = /^\/api\/v1\/feeds\/[A-Za-z0-9_.=-]+\.json$/;

type CreateResponse = {
  success?: unknown;
  data?: { feed?: { json_public_url?: unknown } };
};

export class Html2RssUnavailable extends Error {}

function configuration() {
  const token = process.env.HTML2RSS_ACCESS_TOKEN;
  const configured = process.env.HTML2RSS_API_URL || "http://127.0.0.1:4000/api/v1";
  let api: URL;
  try { api = new URL(configured.endsWith("/") ? configured : `${configured}/`); }
  catch { throw new Html2RssUnavailable("html2rss is not configured."); }
  if (!token || token.length < 16 || api.protocol !== "http:" || api.hostname !== "127.0.0.1" || api.pathname !== "/api/v1/") {
    throw new Html2RssUnavailable("html2rss is not configured.");
  }
  return { api, token };
}

async function responseJson(response: Response) {
  const body = await readLimitedNewsResource(response);
  try { return JSON.parse(new TextDecoder().decode(body)) as unknown; }
  catch { throw new Html2RssUnavailable("html2rss returned invalid JSON."); }
}

async function readFeed(feedPath: string, sourceUrl: string, previous: ParsedWebSource | undefined, now: number) {
  if (!feedPathPattern.test(feedPath)) throw new Html2RssUnavailable("html2rss returned an invalid feed path.");
  const { api } = configuration();
  const endpoint = new URL(feedPath.replace(/^\/api\/v1\//, ""), api);
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(HTML2RSS_REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Html2RssUnavailable("html2rss could not refresh this page.");
  }
  try { return normalizeHtml2rssFeed(await responseJson(response), sourceUrl, now, previous); }
  catch (error) {
    if (error instanceof InvalidHtml2RssFeed) throw new Html2RssUnavailable(error.message);
    throw error;
  }
}

export async function createHtml2rssSource(sourceUrl: string, now = Date.now()) {
  const { api, token } = configuration();
  const response = await fetch(new URL("feeds", api), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: sourceUrl }),
    cache: "no-store",
    signal: AbortSignal.timeout(HTML2RSS_REQUEST_TIMEOUT_MS),
  });
  const payload = await responseJson(response) as CreateResponse;
  if (!response.ok || payload.success !== true) throw new Html2RssUnavailable("html2rss could not extract articles from this page.");
  const feedPath = payload.data?.feed?.json_public_url;
  if (typeof feedPath !== "string" || !feedPathPattern.test(feedPath)) throw new Html2RssUnavailable("html2rss returned an invalid feed path.");
  return { feedPath, source: await readFeed(feedPath, sourceUrl, undefined, now) };
}

export async function refreshHtml2rssSource(feedPath: string, sourceUrl: string, previous: ParsedWebSource, now = Date.now()) {
  return readFeed(feedPath, sourceUrl, previous, now);
}
